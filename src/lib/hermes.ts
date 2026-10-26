/**
 * Browser client for the private Hermes BFF.
 *
 * The BFF owns the SIWE session cookie and the Hermes User API key. This file
 * must never contain a secret: everything here is shipped in the client bundle.
 */

export type IntentKind = "deposit" | "withdrawLocal" | "cctpWithdraw";
export type IntentStatus =
  | "draft"
  | "reviewed"
  | "submitted"
  | "confirmed"
  | "failed"
  | "expired";

export interface HermesIntent {
  id: string;
  wallet: `0x${string}`;
  kind: IntentKind;
  chainId: number;
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  amount: string;
  isMax: boolean;
  destinationDomain: number | null;
  mintRecipient: `0x${string}` | null;
  status: IntentStatus;
  simulation: {
    ok: boolean;
    warning?: "approval_required";
    error?: string;
  };
  txHash: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Present when Hermes prepared an unsigned draft for this turn. */
  intent?: HermesIntent;
  cctpDeposit?: CctpDepositHandoff;
  /** A safe explanation when the model proposed an action the BFF rejected. */
  actionError?: string;
}

export interface CctpDepositHandoff {
  kind: "cctpDeposit";
  amount: string;
  sourceDomain: number;
  actionId?: string;
}

export interface HermesSession {
  authenticated: boolean;
  wallet?: `0x${string}`;
  expiresAt?: string;
}

export interface SiweChallenge {
  message: string;
  nonce: string;
  expiresAt: string;
}

export interface ChatResponse {
  reply: string;
  model: string | null;
  usage: Record<string, unknown> | null;
  intent?: HermesIntent;
  cctpDeposit?: CctpDepositHandoff;
  actionError?: string;
}

export interface ChatJobAccepted {
  jobId: string;
  status: "pending" | "completed" | "failed";
}

export class HermesApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "HermesApiError";
  }
}

const configuredBase = (
  import.meta.env.VITE_BFF_URL as string | undefined
)?.trim();
export const BFF_BASE_URL = configuredBase
  ? configuredBase.replace(/\/+$/, "")
  : "";

export const MAX_CHAT_MESSAGES = 20;
export const MAX_CHAT_CONTENT = 4_000;
export const MAX_CHAT_TOTAL = 12_000;

function idempotencyKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("x-hermes-client", "web");
  if (init.body !== undefined) headers.set("content-type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${BFF_BASE_URL}${path}`, {
      ...init,
      headers,
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new HermesApiError(
      0,
      "network_error",
      "Could not reach the Hermes service. Check your connection and try again."
    );
  }

  const text = await response.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!response.ok) {
    const error =
      data && typeof data === "object"
        ? (data as { error?: { code?: unknown; message?: unknown } }).error
        : undefined;
    throw new HermesApiError(
      response.status,
      typeof error?.code === "string" ? error.code : "request_failed",
      typeof error?.message === "string"
        ? error.message
        : `Hermes request failed (${response.status}).`
    );
  }

  return data as T;
}

/** Keep the model context bounded and never send empty turns. */
export function trimChatMessages(messages: ChatMessage[]): ChatMessage[] {
  const recent = messages
    .filter((message) => message.content.trim().length > 0)
    .slice(-MAX_CHAT_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, MAX_CHAT_CONTENT),
    }));

  // Keep the newest turns under the BFF's total-context cap. Sending the
  // per-message max on every turn would otherwise exceed the server limit.
  const kept: ChatMessage[] = [];
  let total = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    if (!message) continue;
    if (kept.length > 0 && total + message.content.length > MAX_CHAT_TOTAL)
      break;
    kept.unshift(message);
    total += message.content.length;
  }
  return kept;
}

export function getHermesSession(): Promise<HermesSession> {
  return request<HermesSession>("/api/session");
}

export function requestSiweChallenge(
  address: `0x${string}`
): Promise<SiweChallenge> {
  return request<SiweChallenge>("/auth/siwe/nonce", {
    method: "POST",
    body: JSON.stringify({ address }),
  });
}

export function verifySiwe(
  message: string,
  signature: `0x${string}`
): Promise<HermesSession & { authenticated: true }> {
  return request<HermesSession & { authenticated: true }>("/auth/siwe/verify", {
    method: "POST",
    body: JSON.stringify({ message, signature }),
  });
}

export function logoutHermes(): Promise<void> {
  return request<void>("/auth/logout", { method: "POST" });
}

export function sendHermesChat(
  messages: ChatMessage[],
  conversationId?: string,
  signal?: AbortSignal
): Promise<ChatJobAccepted> {
  return request<ChatJobAccepted>("/api/chat", {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey() },
    signal,
    body: JSON.stringify({
      messages: trimChatMessages(messages),
      ...(conversationId ? { conversationId } : {}),
    }),
  });
}

export function getHermesChatJob(
  jobId: string,
  signal?: AbortSignal
): Promise<{
  status: "pending" | "completed";
  response?: ChatResponse;
}> {
  return request(`/api/chat/jobs/${encodeURIComponent(jobId)}`, { signal });
}

export function intentReviewTab(kind: IntentKind): "deposit" | "withdraw" {
  return kind === "deposit" ? "deposit" : "withdraw";
}

export async function createHermesIntent(
  kind: IntentKind,
  body: Record<string, unknown>
): Promise<HermesIntent> {
  const path =
    kind === "deposit"
      ? "/api/intents/deposit"
      : kind === "withdrawLocal"
      ? "/api/intents/withdraw-local"
      : "/api/intents/cctp-withdraw";
  const response = await request<{ intent: HermesIntent }>(path, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey() },
    body: JSON.stringify(body),
  });
  return response.intent;
}

export async function getHermesIntent(id: string): Promise<HermesIntent> {
  const response = await request<{ intent: HermesIntent }>(
    `/api/intents/${encodeURIComponent(id)}`
  );
  return response.intent;
}

export async function markHermesIntentSubmitted(
  id: string,
  txHash: string
): Promise<HermesIntent> {
  const response = await request<{ intent: HermesIntent }>(
    `/api/intents/${encodeURIComponent(id)}/tx`,
    {
      method: "PATCH",
      body: JSON.stringify({ txHash }),
    }
  );
  return response.intent;
}

export function isHermesApiError(error: unknown): error is HermesApiError {
  return error instanceof HermesApiError;
}
