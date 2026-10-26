import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import {
  getHermesSession,
  getHermesChatJob,
  isHermesApiError,
  requestSiweChallenge,
  sendHermesChat,
  verifySiwe,
  type ChatMessage,
  type ChatResponse,
  type HermesIntent,
} from "../lib/hermes";

const MAX_SESSIONS = 30;
const MAX_STORED_MESSAGES = 80;

interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}

interface ChatState {
  sessions: ChatSession[];
  activeId: string;
}

export interface RevertSnapshot {
  sessionId: string;
  messages: ChatMessage[];
}

function newConversationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function storageKey(address?: string): string {
  return `agent-treasury-hermes-chat-v1:${
    address?.toLowerCase() ?? "disconnected"
  }`;
}

function newSession(): ChatSession {
  return {
    id: newConversationId(),
    title: "New conversation",
    updatedAt: Date.now(),
    messages: [],
  };
}

function isChatSession(value: unknown): value is ChatSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<ChatSession>;
  return (
    typeof session.id === "string" &&
    typeof session.title === "string" &&
    typeof session.updatedAt === "number" &&
    Array.isArray(session.messages)
  );
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ChatMessage>;
  return (
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string"
  );
}

function isHermesIntent(value: unknown): value is HermesIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as Partial<HermesIntent>;
  return (
    typeof intent.id === "string" &&
    /^int_[a-f0-9]{32}$/.test(intent.id) &&
    (intent.kind === "deposit" ||
      intent.kind === "withdrawLocal" ||
      intent.kind === "cctpWithdraw") &&
    typeof intent.wallet === "string" &&
    /^0x[0-9a-fA-F]{40}$/.test(intent.wallet) &&
    typeof intent.amount === "string" &&
    /^\d+$/.test(intent.amount) &&
    typeof intent.chainId === "number" &&
    typeof intent.to === "string" &&
    typeof intent.data === "string" &&
    typeof intent.value === "string" &&
    typeof intent.isMax === "boolean" &&
    typeof intent.expiresAt === "string" &&
    typeof intent.simulation === "object" &&
    intent.simulation !== null &&
    typeof intent.simulation.ok === "boolean"
  );
}

function isCctpDepositHandoff(
  value: unknown
): value is NonNullable<ChatMessage["cctpDeposit"]> {
  if (!value || typeof value !== "object") return false;
  const handoff = value as Partial<NonNullable<ChatMessage["cctpDeposit"]>>;
  return (
    handoff.kind === "cctpDeposit" &&
    typeof handoff.amount === "string" &&
    /^\d+(\.\d{1,6})?$/.test(handoff.amount) &&
    typeof handoff.sourceDomain === "number" &&
    Number.isInteger(handoff.sourceDomain)
  );
}

function loadChatState(address?: string): ChatState {
  let sessions: ChatSession[] = [];
  try {
    const raw =
      typeof localStorage === "undefined"
        ? null
        : localStorage.getItem(storageKey(address));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(parsed)) {
      sessions = parsed
        .filter(isChatSession)
        .map((item) => ({
          ...item,
          messages: item.messages
            .filter(isChatMessage)
            .map((message) => ({
              ...message,
              ...(isHermesIntent(message.intent)
                ? { intent: message.intent }
                : { intent: undefined }),
              ...(isCctpDepositHandoff(message.cctpDeposit)
                ? { cctpDeposit: message.cctpDeposit }
                : { cctpDeposit: undefined }),
            }))
            .slice(-MAX_STORED_MESSAGES),
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_SESSIONS);
    }
  } catch {
    sessions = [];
  }
  if (sessions.length === 0) {
    const session = newSession();
    return { sessions: [session], activeId: session.id };
  }
  let activeId = sessions[0]?.id ?? "";
  try {
    const savedId = localStorage.getItem(`${storageKey(address)}:active`);
    if (savedId && sessions.some((session) => session.id === savedId))
      activeId = savedId;
  } catch {
    // Keep the most recent session when storage is unavailable.
  }
  return { sessions, activeId };
}

function friendlyError(error: unknown): string {
  if (isHermesApiError(error)) {
    if (error.code === "chat_unconfigured")
      return "Hermes chat is not connected yet. The read-only treasury API is still available.";
    if (error.code === "rate_limited")
      return "You are sending messages too quickly. Try again in a moment.";
    if (error.code === "unauthorized")
      return "Your Hermes session expired. Send the message again to sign in.";
    if (error.status === 404)
      return "Hermes is not available on this deployment yet.";
    return error.message;
  }
  const message = error instanceof Error ? error.message : "";
  if (/reject|denied|cancel/i.test(message))
    return "Signature request cancelled.";
  return "Could not reach Hermes. Try again.";
}

function waitForNextChatPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 800);
    const abort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Chat request cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

export interface HermesChat {
  sessions: ChatSession[];
  activeId: string;
  messages: ChatMessage[];
  busy: boolean;
  error: string | null;
  send: (content: string) => Promise<void>;
  resend: (messageIndex: number) => Promise<void>;
  revert: (messageIndex: number) => string | null;
  undoRevert: () => boolean;
  canUndoRevert: boolean;
  newSession: () => void;
  selectSession: (id: string) => void;
  deleteSession: (id: string) => void;
  updateIntent: (id: string, intent: HermesIntent) => void;
}

export function messagesThroughUserPrompt(
  messages: ChatMessage[],
  messageIndex: number
): ChatMessage[] | null {
  if (
    !Number.isInteger(messageIndex) ||
    messageIndex < 0 ||
    messageIndex >= messages.length ||
    messages[messageIndex]?.role !== "user"
  ) {
    return null;
  }
  return messages.slice(0, messageIndex + 1);
}

export function messagesBeforeUserPrompt(
  messages: ChatMessage[],
  messageIndex: number
): ChatMessage[] | null {
  if (!messagesThroughUserPrompt(messages, messageIndex)) return null;
  return messages.slice(0, messageIndex);
}

export function createRevertSnapshot(
  sessionId: string,
  messages: ChatMessage[],
  messageIndex: number
): RevertSnapshot | null {
  if (!messagesBeforeUserPrompt(messages, messageIndex)) return null;
  return { sessionId, messages: [...messages] };
}

export function messagesFromRevertSnapshot(
  snapshot: RevertSnapshot | null,
  sessionId: string
): ChatMessage[] | null {
  return snapshot?.sessionId === sessionId ? [...snapshot.messages] : null;
}

export function useHermesChat(): HermesChat {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [chatState, setChatState] = useState(() => loadChatState(address));
  const [stateWallet, setStateWallet] = useState(address?.toLowerCase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revertSnapshot, setRevertSnapshot] = useState<RevertSnapshot | null>(
    null
  );
  const sessionWallet = useRef<string | null>(null);
  const chatRequest = useRef<AbortController | null>(null);
  const storageWallet = useRef(address?.toLowerCase());
  const busyRef = useRef(false);
  const walletMatches = stateWallet === address?.toLowerCase();
  const visibleSessions = walletMatches ? chatState.sessions : [];
  const activeId = walletMatches ? chatState.activeId : "";
  const activeSession = visibleSessions.find(
    (session) => session.id === activeId
  );
  const messages = activeSession?.messages ?? [];
  const canUndoRevert = revertSnapshot?.sessionId === activeId;

  useEffect(() => {
    const nextWallet = address?.toLowerCase();
    if (storageWallet.current === nextWallet) return;
    storageWallet.current = nextWallet;
    setStateWallet(nextWallet);
    setChatState(loadChatState(address));
    setError(null);
    sessionWallet.current = null;
    chatRequest.current?.abort();
    chatRequest.current = null;
  }, [address]);

  useEffect(() => {
    if (storageWallet.current !== address?.toLowerCase()) return;
    try {
      localStorage.setItem(
        storageKey(address),
        JSON.stringify(chatState.sessions)
      );
      localStorage.setItem(`${storageKey(address)}:active`, chatState.activeId);
    } catch {
      // Keep chat usable in private browsing or when local storage is full.
    }
  }, [address, chatState]);

  const ensureSession = useCallback(async (): Promise<`0x${string}`> => {
    if (!address) throw new Error("Connect a wallet first.");
    if (sessionWallet.current?.toLowerCase() === address.toLowerCase())
      return address;
    const existing = await getHermesSession();
    if (
      existing.authenticated &&
      existing.wallet?.toLowerCase() === address.toLowerCase()
    ) {
      sessionWallet.current = address;
      return address;
    }
    const challenge = await requestSiweChallenge(address);
    const signature = await signMessageAsync({ message: challenge.message });
    await verifySiwe(challenge.message, signature);
    sessionWallet.current = address;
    return address;
  }, [address, signMessageAsync]);

  const requestTurn = useCallback(
    async (
      sessionId: string,
      requestMessages: ChatMessage[]
    ): Promise<void> => {
      if (busyRef.current) return;
      if (!address) {
        setError("Connect a wallet to ask Hermes.");
        return;
      }
      if (stateWallet !== address.toLowerCase()) return;
      if (!chatState.sessions.some((item) => item.id === sessionId)) return;

      busyRef.current = true;
      const controller = new AbortController();
      chatRequest.current?.abort();
      chatRequest.current = controller;
      setBusy(true);
      setError(null);
      try {
        await ensureSession();
        const accepted = await sendHermesChat(
          requestMessages,
          sessionId,
          controller.signal
        );
        let response: ChatResponse | undefined;
        const deadline = Date.now() + 100_000;
        while (!response && Date.now() < deadline) {
          if (controller.signal.aborted) return;
          const job = await getHermesChatJob(accepted.jobId, controller.signal);
          if (job.status === "completed" && job.response) {
            response = job.response;
            break;
          }
          await waitForNextChatPoll(controller.signal);
        }
        if (!response) {
          throw new Error(
            "Hermes is still working. Try resending your prompt shortly."
          );
        }
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: response.reply,
          ...(response.intent ? { intent: response.intent } : {}),
          ...(response.cctpDeposit
            ? { cctpDeposit: response.cctpDeposit }
            : {}),
          ...(response.actionError
            ? { actionError: response.actionError }
            : {}),
        };
        setChatState((current) => ({
          ...current,
          sessions: current.sessions.map((item) =>
            item.id === sessionId
              ? {
                  ...item,
                  updatedAt: Date.now(),
                  messages: [...requestMessages, assistantMessage].slice(
                    -MAX_STORED_MESSAGES
                  ),
                }
              : item
          ),
        }));
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (isHermesApiError(cause) && cause.code === "unauthorized")
          sessionWallet.current = null;
        setError(friendlyError(cause));
      } finally {
        if (chatRequest.current === controller) chatRequest.current = null;
        busyRef.current = false;
        setBusy(false);
      }
    },
    [address, chatState.sessions, ensureSession, stateWallet]
  );

  const send = useCallback(
    async (content: string): Promise<void> => {
      const text = content.trim();
      if (!text || busyRef.current) return;
      if (!address) {
        setError("Connect a wallet to ask Hermes.");
        return;
      }
      if (stateWallet !== address.toLowerCase()) return;
      const session = chatState.sessions.find((item) => item.id === activeId);
      if (!session) return;

      const nextMessages = [
        ...session.messages,
        { role: "user" as const, content: text },
      ].slice(-MAX_STORED_MESSAGES);
      setRevertSnapshot(null);
      setChatState((current) => ({
        ...current,
        sessions: current.sessions.map((item) =>
          item.id === session.id
            ? {
                ...item,
                title: item.messages.some((message) => message.role === "user")
                  ? item.title
                  : text.slice(0, 48),
                updatedAt: Date.now(),
                messages: nextMessages,
              }
            : item
        ),
      }));
      await requestTurn(session.id, nextMessages);
    },
    [activeId, address, chatState.sessions, requestTurn, stateWallet]
  );

  const resend = useCallback(
    async (messageIndex: number): Promise<void> => {
      if (busyRef.current) return;
      const session = chatState.sessions.find((item) => item.id === activeId);
      if (!session) return;
      const retryMessages = messagesThroughUserPrompt(
        session.messages,
        messageIndex
      );
      if (!retryMessages) return;
      setRevertSnapshot(null);
      setChatState((current) => ({
        ...current,
        sessions: current.sessions.map((item) =>
          item.id === session.id
            ? { ...item, updatedAt: Date.now(), messages: retryMessages }
            : item
        ),
      }));
      await requestTurn(session.id, retryMessages);
    },
    [activeId, chatState.sessions, requestTurn]
  );

  const revert = useCallback(
    (messageIndex: number): string | null => {
      if (busyRef.current) return null;
      const session = chatState.sessions.find((item) => item.id === activeId);
      if (!session) return null;
      const prompt = session.messages[messageIndex];
      const earlierMessages = messagesBeforeUserPrompt(
        session.messages,
        messageIndex
      );
      if (!prompt || prompt.role !== "user" || !earlierMessages) return null;
      setRevertSnapshot(
        createRevertSnapshot(session.id, session.messages, messageIndex)
      );
      setChatState((current) => ({
        ...current,
        sessions: current.sessions.map((item) =>
          item.id === session.id
            ? { ...item, updatedAt: Date.now(), messages: earlierMessages }
            : item
        ),
      }));
      setError(null);
      return prompt.content;
    },
    [activeId, chatState.sessions]
  );

  const undoRevert = useCallback((): boolean => {
    if (busyRef.current) return false;
    const restoredMessages = messagesFromRevertSnapshot(
      revertSnapshot,
      activeId
    );
    if (!restoredMessages) return false;
    setChatState((current) => ({
      ...current,
      sessions: current.sessions.map((session) =>
        session.id === activeId
          ? { ...session, updatedAt: Date.now(), messages: restoredMessages }
          : session
      ),
    }));
    setRevertSnapshot(null);
    setError(null);
    return true;
  }, [activeId, revertSnapshot]);

  const createSession = useCallback(() => {
    setRevertSnapshot(null);
    const session = newSession();
    setChatState((current) => ({
      sessions: [session, ...current.sessions].slice(0, MAX_SESSIONS),
      activeId: session.id,
    }));
    setError(null);
  }, []);

  const selectSession = useCallback((id: string) => {
    setRevertSnapshot(null);
    setChatState((current) =>
      current.sessions.some((session) => session.id === id)
        ? { ...current, activeId: id }
        : current
    );
    setError(null);
  }, []);

  const deleteSession = useCallback((id: string) => {
    setRevertSnapshot(null);
    setChatState((current) => {
      const remaining = current.sessions.filter((session) => session.id !== id);
      const sessions = remaining.length > 0 ? remaining : [newSession()];
      return {
        sessions,
        activeId: current.activeId === id ? sessions[0].id : current.activeId,
      };
    });
    setError(null);
  }, []);

  const updateIntent = useCallback((id: string, intent: HermesIntent) => {
    setRevertSnapshot(null);
    setChatState((current) => ({
      ...current,
      sessions: current.sessions.map((session) => ({
        ...session,
        messages: session.messages.map((message) =>
          message.intent?.id === id ? { ...message, intent } : message
        ),
      })),
    }));
  }, []);

  return {
    sessions: visibleSessions,
    activeId,
    messages,
    busy,
    error,
    send,
    resend,
    revert,
    undoRevert,
    canUndoRevert,
    newSession: createSession,
    selectSession,
    deleteSession,
    updateIntent,
  };
}
