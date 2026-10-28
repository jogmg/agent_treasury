import {
  AlertCircle,
  Check,
  ChevronDown,
  Loader2,
  PencilLine,
  Plus,
  RotateCw,
  Send,
  Sparkles,
  Trash2,
  Undo2,
  Wallet,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, useSwitchChain } from "wagmi";
import { useHermesChat } from "../hooks/useHermesChat";
import { useHermesIntentExecution } from "../hooks/useHermesIntentExecution";
import { getCctpDestination } from "../lib/cctp";
import { ARC_CHAIN, ARC_CHAIN_ID } from "../lib/contracts";
import { formatUsdc } from "../lib/decimals";
import { type HermesIntent } from "../lib/hermes";
import { useFlowStore } from "../stores/flow";
import { useUiStore } from "../stores/ui";
import { ArcMark } from "./ArcMark";
import { CctpCompletionCard } from "./CctpCompletionCard";
import { HermesCctpDepositCard } from "./HermesCctpDepositCard";

const SUGGESTIONS = [
  "How much USDC do I have?",
  "Put 10 USDC to work",
  "Deposit 5 USDC from Base",
  "Withdraw everything",
];

function intentDescription(intent: HermesIntent): string {
  const amount = `${formatUsdc(BigInt(intent.amount), 6).replace(
    /\.?0+$/,
    ""
  )} USDC`;
  if (intent.kind === "deposit")
    return `Deposit ${amount} into the Arc treasury vault`;
  if (intent.kind === "withdrawLocal")
    return `Withdraw ${
      intent.isMax ? "all available" : amount
    } to your Arc wallet`;
  const destination =
    intent.destinationDomain === null
      ? "destination chain"
      : getCctpDestination(intent.destinationDomain)?.name ??
        `domain ${intent.destinationDomain}`;
  return `Bridge ${amount} from Arc to ${destination}`;
}

export function HermesDock() {
  const {
    sessions,
    activeId,
    messages,
    busy,
    error,
    send,
    resend,
    revert,
    undoRevert,
    canUndoRevert,
    newSession,
    selectSession,
    deleteSession,
    updateIntent,
  } = useHermesChat();
  const { execution, execute } = useHermesIntentExecution();
  const cctpHash = useFlowStore((state) => state.cctpHash);
  const cctpStep = useFlowStore((state) => state.cctpStep);
  const cctpCompletionStatus = useFlowStore(
    (state) => state.cctpCompletionStatus
  );
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const setTab = useUiStore((state) => state.setTab);
  const setReviewIntent = useUiStore((state) => state.setReviewIntent);
  const [input, setInput] = useState("");
  const [sessionMenu, setSessionMenu] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sessionButtonRef = useRef<HTMLButtonElement>(null);
  const sessionMenuRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wrongChain = isConnected && chainId !== ARC_CHAIN_ID;
  const executionBusy = Boolean(
    execution.step && execution.step !== "Transaction confirmed on Arc"
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, busy, execution]);

  useEffect(() => {
    if (!sessionMenu) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !sessionButtonRef.current?.contains(target) &&
        !sessionMenuRef.current?.contains(target)
      ) {
        setSessionMenu(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSessionMenu(null);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [sessionMenu]);

  function toggleSessionMenu() {
    if (sessionMenu) {
      setSessionMenu(null);
      return;
    }
    const bounds = sessionButtonRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const width = Math.min(320, window.innerWidth - 24);
    const height = Math.min(360, window.innerHeight - 24);
    setSessionMenu({
      left: Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)),
      top: Math.max(
        12,
        Math.min(bounds.bottom + 8, window.innerHeight - height - 12)
      ),
      width,
    });
  }

  async function submit() {
    const text = input.trim();
    if (!text || busy || !isConnected || wrongChain) return;
    setInput("");
    await send(text);
  }

  async function continueIntent(intent: HermesIntent) {
    const result = await execute(intent, (submitted) =>
      updateIntent(intent.id, submitted)
    );
    if (result) updateIntent(intent.id, result);
  }

  function openActivity() {
    setReviewIntent(null);
    setTab("activity");
  }

  return (
    <section
      aria-label="Treasury workspace"
      className="glimmer-chat-frame mx-auto flex h-full min-h-[31rem] max-h-screen w-full max-w-[940px] flex-col overflow-hidden rounded-[24px] border border-white/15 bg-[#0A0E11]/55 shadow-[0_32px_100px_rgba(0,0,0,0.28)] backdrop-blur-2xl"
    >
      <header className="flex min-h-[58px] items-center justify-between gap-3 border-b border-white/10 px-4 sm:px-6">
        <button
          ref={sessionButtonRef}
          type="button"
          aria-label="Choose conversation"
          aria-haspopup="listbox"
          aria-expanded={Boolean(sessionMenu)}
          onClick={toggleSessionMenu}
          className="flex min-w-0 max-w-[58vw] items-center gap-2 rounded-xl border border-transparent px-2.5 py-2 text-left transition hover:border-white/10 hover:bg-white/[0.05] sm:max-w-sm"
        >
          <span className="truncate text-sm font-medium text-white">
            {sessions.find((session) => session.id === activeId)?.title ??
              "New conversation"}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-white/50 transition-transform ${
              sessionMenu ? "rotate-180" : ""
            }`}
          />
        </button>
        {sessionMenu &&
          createPortal(
            <div
              ref={sessionMenuRef}
              role="listbox"
              aria-label="Conversations"
              className="glimmer-glass fixed z-[70] max-h-[min(360px,calc(100dvh-24px))] overflow-y-auto rounded-2xl p-2 shadow-2xl"
              style={{
                left: sessionMenu.left,
                top: sessionMenu.top,
                width: sessionMenu.width,
              }}
            >
              <div className="flex items-center justify-between px-2 pb-2 pt-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
                  Conversations
                </span>
                <span className="font-mono text-[10px] text-white/30">
                  {sessions.length}
                </span>
              </div>
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  role="option"
                  aria-selected={session.id === activeId}
                  onClick={() => {
                    selectSession(session.id);
                    setSessionMenu(null);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                    session.id === activeId
                      ? "bg-[#4F75A0]/25 text-white"
                      : "text-white/65 hover:bg-white/[0.07] hover:text-white"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {session.title}
                  </span>
                  {session.id === activeId && (
                    <Check className="h-4 w-4 shrink-0 text-[#96ADC8]" />
                  )}
                </button>
              ))}
            </div>,
            document.body
          )}
        <div className="flex shrink-0 items-center gap-1">
          <span className="hidden items-center gap-2 pr-2 text-[11px] text-white/50 sm:flex">
            {/* <span
              className={`h-1.5 w-1.5 rounded-full ${
                isConnected ? "bg-[#96ADC8]" : "bg-white/25"
              }`}
            /> */}
            {isConnected ? (
              wrongChain ? (
                <>
                  <ArcMark size={14} />
                  Switch to {ARC_CHAIN.name}
                </>
              ) : (
                <>
                  <ArcMark size={14} />
                  {ARC_CHAIN.name}
                </>
              )
            ) : (
              "Not connected"
            )}
          </span>
          <button
            type="button"
            onClick={newSession}
            disabled={busy}
            aria-label="New conversation"
            title="New conversation"
            className="flex h-9 w-9 items-center justify-center rounded-full text-white/65 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
          </button>
          {sessions.length > 1 && (
            <button
              type="button"
              onClick={() => deleteSession(activeId)}
              aria-label="Delete current conversation"
              title="Delete conversation"
              className="flex h-9 w-9 items-center justify-center rounded-full text-white/45 transition hover:bg-red-400/10 hover:text-red-200"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      <div
        className="scrollbar-none flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-7"
        aria-live="polite"
      >
        {!isConnected && (
          <div className="glimmer-glass mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl px-6 py-10 text-center">
            <Wallet className="h-7 w-7 text-[#96ADC8]" />
            <p className="text-sm text-slate-300">
              Connect your wallet to start a private conversation.
            </p>
            <p className="text-xs text-slate-500">
              Your chat history and intent drafts are scoped to this wallet.
            </p>
          </div>
        )}

        {isConnected && messages.length === 0 && (
          <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center py-8 sm:py-12">
            <div className="mb-8 text-center">
              <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.08] text-[#96ADC8] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                <Sparkles className="h-6 w-6" />
              </div>
              <p className="font-display text-2xl font-semibold text-white sm:text-3xl">
                What would you like to do?
              </p>
              <p className="mt-2 text-sm text-white/55">
                Your treasury, ready when you are.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setInput(suggestion);
                    inputRef.current?.focus();
                  }}
                  disabled={busy || wrongChain}
                  className="glimmer-glass rounded-xl px-4 py-3 text-left text-sm text-white/75 transition hover:border-white/30 hover:bg-white/[0.12] hover:text-white disabled:opacity-40"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <article
            key={`${activeId}-${index}`}
            className={`mx-auto flex w-full max-w-3xl gap-3 ${
              message.role === "user" ? "flex-row-reverse" : ""
            }`}
          >
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center ${
                message.role === "assistant"
                  ? "bg-[#4F75A0]/20 text-[#96ADC8]"
                  : "bg-white/10 text-white/65"
              }`}
            >
              {message.role === "assistant" ? (
                <Sparkles className="h-4 w-4" />
              ) : (
                <Wallet className="h-4 w-4" />
              )}
            </div>
            <div
              className={`min-w-0 max-w-[90%] ${
                message.role === "user" ? "text-right" : ""
              }`}
            >
              {message.role === "user" && (
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/40">
                  You
                </p>
              )}
              <div
                className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  message.role === "user"
                    ? "inline-block border border-white/10 bg-[#4F75A0]/25 text-white"
                    : "glimmer-response border border-white/10 bg-white/[0.055] text-slate-100"
                }`}
              >
                {message.content}
              </div>
              {message.role === "user" && (
                <div className="mt-1.5 flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => void resend(index)}
                    disabled={busy || wrongChain}
                    title="Resend this prompt and discard later turns"
                    aria-label="Resend this prompt"
                    className="inline-flex items-center gap-1 px-2 py-1 text-[10px] text-slate-500 transition hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <RotateCw className="h-3 w-3" />
                    Resend
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const prompt = revert(index);
                      if (prompt === null) return;
                      setInput(prompt);
                      inputRef.current?.focus();
                    }}
                    disabled={busy}
                    title="Edit this prompt and remove later turns"
                    aria-label="Edit this prompt and remove later turns"
                    className="inline-flex items-center gap-1 px-2 py-1 text-[10px] text-slate-500 transition hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <PencilLine className="h-3 w-3" />
                    Edit from here
                  </button>
                </div>
              )}
              {message.role === "assistant" && message.cctpDeposit && (
                <HermesCctpDepositCard
                  handoff={message.cctpDeposit}
                  actionId={
                    message.cctpDeposit.actionId ?? `${activeId}:${index}`
                  }
                />
              )}
              {message.role === "assistant" && message.intent && (
                <div className="glimmer-glass mt-3 rounded-2xl p-4 text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200">
                        Action prepared
                      </p>
                      <p className="mt-1.5 text-sm text-white">
                        {intentDescription(message.intent)}
                      </p>
                      {message.intent.mintRecipient && (
                        <p className="mt-1 break-all font-mono text-[11px] text-slate-400">
                          Recipient: {message.intent.mintRecipient}
                        </p>
                      )}
                      {message.intent.simulation.warning ===
                        "approval_required" && (
                        <p className="mt-2 text-xs text-amber-300">
                          USDC approval will be requested first, then the
                          deposit.
                        </p>
                      )}
                      {message.intent.status === "submitted" &&
                        message.intent.txHash && (
                          <p className="mt-2 inline-flex items-center gap-1 text-xs text-sky-300">
                            <Loader2 className="h-3.5 w-3.5" />
                            Submitted · waiting for confirmation
                          </p>
                        )}
                      {message.intent.status === "confirmed" &&
                        message.intent.txHash && (
                          <p className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-300">
                            <Check className="h-3.5 w-3.5" />
                            Confirmed on Arc
                          </p>
                        )}
                    </div>
                  </div>
                  {execution.intentId === message.intent.id &&
                    execution.step && (
                      <p
                        className="mt-3 flex items-center gap-2 text-xs text-sky-200"
                        role="status"
                      >
                        {execution.step === "Transaction confirmed on Arc" ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        )}
                        {execution.step}
                      </p>
                    )}
                  {execution.intentId === message.intent.id &&
                    execution.error && (
                      <p
                        className="mt-3 border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200"
                        role="alert"
                      >
                        {execution.error}
                      </p>
                    )}
                  {message.intent.status === "draft" && (
                    <button
                      type="button"
                      onClick={() => void continueIntent(message.intent!)}
                      disabled={busy || executionBusy || !isConnected}
                      className="glimmer-primary-cta mt-4 inline-flex items-center gap-2"
                    >
                      <Wallet className="h-4 w-4" />
                      Continue in wallet
                    </button>
                  )}
                  {message.intent.status === "confirmed" && (
                    <button
                      type="button"
                      disabled
                      className="glimmer-primary-cta mt-4 inline-flex cursor-default items-center gap-2 opacity-70"
                    >
                      <Check className="h-4 w-4" />
                      Action completed
                    </button>
                  )}
                  {message.intent.kind === "cctpWithdraw" &&
                    ["submitted", "confirmed"].includes(
                      message.intent.status
                    ) && (
                      <button
                        type="button"
                        onClick={openActivity}
                        className="mt-3 text-xs font-medium text-emerald-300 underline underline-offset-4"
                      >
                        Track transfer in Activity
                      </button>
                    )}
                  {message.intent.kind === "cctpWithdraw" &&
                    ["submitted", "confirmed"].includes(
                      message.intent.status
                    ) &&
                    cctpHash === message.intent.txHash &&
                    cctpStep === "success" &&
                    cctpCompletionStatus !== "idle" && (
                      <CctpCompletionCard burnTx={cctpHash} />
                    )}
                </div>
              )}
              {message.role === "assistant" && message.actionError && (
                <p className="mt-2 border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
                  {message.actionError}
                </p>
              )}
            </div>
          </article>
        ))}

        {busy && (
          <div className="mx-auto flex max-w-3xl items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Working through your request…
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="mx-auto flex max-w-3xl items-start gap-2 border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {wrongChain && (
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <span>
              Switch to{" "}
              <span className="inline-flex items-center gap-1 align-middle">
                <ArcMark size={14} />
                {ARC_CHAIN.name}
              </span>{" "}
              to chat and sign treasury actions.
            </span>
            <button
              type="button"
              onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}
              disabled={switching}
              className="shrink-0 font-semibold underline"
            >
              {switching ? "Switching…" : "Switch network"}
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {canUndoRevert && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-800 bg-slate-900/60 px-4 py-2 sm:px-8">
          <p className="text-xs text-slate-400">
            Later messages are temporarily removed while you edit this prompt.
          </p>
          <button
            type="button"
            onClick={() => {
              if (undoRevert()) setInput("");
            }}
            disabled={busy}
            className="inline-flex shrink-0 items-center gap-1.5 px-2 py-1 text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/10 disabled:opacity-40"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Restore conversation
          </button>
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="border-t border-white/10 bg-white/[0.025] px-4 py-3 sm:px-8"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-white/15 bg-[#0A0E11]/55 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl focus-within:border-[#96ADC8]/55">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            rows={2}
            maxLength={4_000}
            aria-label="Message"
            disabled={!isConnected || busy || wrongChain}
            placeholder={
              isConnected
                ? "Ask or describe what you need…"
                : "Connect a wallet to start"
            }
            className="textarea-scrollbar-none max-h-40 min-h-12 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-white placeholder:text-white/35 focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={
              !isConnected || busy || wrongChain || input.trim().length === 0
            }
            aria-label="Send message"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#96ADC8]/80 hover:bg-[#96ADC8] text-[#0A0E11] transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-white/35">
          Your wallet reviews and signs every transaction.
        </p>
      </form>
    </section>
  );
}
