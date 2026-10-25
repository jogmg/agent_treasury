import { useEffect, useRef, useState } from "react";
import { ConnectKitButton } from "connectkit";
import {
  AlertCircle,
  Check,
  Loader2,
  MessageSquarePlus,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Wallet,
} from "lucide-react";
import { useAccount, useSwitchChain } from "wagmi";
import { useHermesChat } from "../hooks/useHermesChat";
import { useHermesIntentExecution } from "../hooks/useHermesIntentExecution";
import { useFlowStore } from "../stores/flow";
import { CctpCompletionCard } from "./CctpCompletionCard";
import { ARC_CHAIN, ARC_CHAIN_ID } from "../lib/contracts";
import { type HermesIntent } from "../lib/hermes";
import { formatUsdc } from "../lib/decimals";
import { getCctpDestination } from "../lib/cctp";
import { useUiStore } from "../stores/ui";

const SUGGESTIONS = [
  "How much USDC do I have?",
  "Send 10 USDC to Base",
  "Put 25 USDC to work",
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
  const { address } = useAccount();
  const {
    sessions,
    activeId,
    messages,
    busy,
    error,
    send,
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wrongChain = isConnected && chainId !== ARC_CHAIN_ID;
  const executionBusy = Boolean(
    execution.step && execution.step !== "Transaction confirmed on Arc"
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, busy, execution]);

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
      aria-label="Hermes assistant"
      className="mx-auto flex h-[calc(100dvh-13rem)] min-h-[32rem] max-w-7xl overflow-hidden border border-slate-800 bg-[#0b1120] shadow-2xl shadow-black/20 sm:h-[calc(100dvh-12rem)]"
    >
      <aside className="flex w-16 shrink-0 flex-col border-r border-slate-800 bg-[#080d19] sm:w-64">
        <div className="flex items-center justify-center border-b border-slate-800 p-3 sm:justify-between sm:px-4 sm:py-4">
          <div className="hidden items-center gap-2 sm:flex">
            <div className="flex h-8 w-8 items-center justify-center bg-emerald-500/15 text-emerald-300">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white">Hermes</h1>
              <p className="text-[10px] text-slate-500">Treasury assistant</p>
            </div>
          </div>
          <Sparkles className="h-5 w-5 text-emerald-400 sm:hidden" />
          <button
            type="button"
            onClick={newSession}
            disabled={busy}
            aria-label="New conversation"
            title="New conversation"
            className="flex h-9 w-9 items-center justify-center border border-slate-700 text-slate-300 transition hover:border-emerald-500/50 hover:text-emerald-300 disabled:opacity-40 sm:w-auto sm:px-2"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden text-xs font-medium sm:ml-1 sm:inline">
              New chat
            </span>
          </button>
        </div>

        <div
          className="scrollbar-none flex-1 space-y-1 overflow-y-auto p-2"
          aria-label="Chat sessions"
        >
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`group flex items-center gap-1 ${
                session.id === activeId
                  ? "bg-slate-800/80"
                  : "hover:bg-slate-900"
              }`}
            >
              <button
                type="button"
                onClick={() => selectSession(session.id)}
                title={session.title}
                aria-current={session.id === activeId ? "page" : undefined}
                className={`flex min-w-0 flex-1 items-center justify-center gap-2 px-2 py-2.5 text-left text-xs sm:justify-start ${
                  session.id === activeId
                    ? "text-emerald-200"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <MessageSquarePlus className="h-4 w-4 shrink-0" />
                <span className="hidden truncate sm:block">
                  {session.title}
                </span>
              </button>
              <button
                type="button"
                onClick={() => deleteSession(session.id)}
                aria-label={`Delete ${session.title}`}
                title="Delete conversation"
                className="hidden p-2 text-slate-600 hover:text-red-300 group-hover:block"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-800 p-2 sm:p-3">
          {isConnected ? (
            <div className="flex items-center justify-center gap-2 sm:justify-start">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="hidden truncate font-mono text-[10px] text-slate-400 sm:block">
                {address}
              </span>
              <span className="sr-only">Wallet connected</span>
            </div>
          ) : (
            <div className="flex justify-center sm:block">
              <ConnectKitButton />
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:px-6">
          <div>
            <h2 className="text-sm font-semibold text-white">
              {sessions.find((session) => session.id === activeId)?.title ??
                "New conversation"}
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Wallet-confirmed transactions · Hermes never signs
            </p>
          </div>
          <div className="text-right text-[10px] text-slate-500">
            {isConnected
              ? wrongChain
                ? `Switch to ${ARC_CHAIN.name}`
                : ARC_CHAIN.name
              : "Wallet disconnected"}
          </div>
        </header>

        <div
          className="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-7"
          aria-live="polite"
        >
          {!isConnected && (
            <div className="mx-auto flex max-w-md flex-col items-center gap-3 border border-slate-800 bg-slate-900/60 px-6 py-10 text-center">
              <Wallet className="h-7 w-7 text-slate-500" />
              <p className="text-sm text-slate-300">
                Connect your wallet to start a private conversation.
              </p>
              <p className="text-xs text-slate-500">
                Your chat history and intent drafts are scoped to this wallet.
              </p>
              <ConnectKitButton />
            </div>
          )}

          {isConnected && messages.length === 0 && (
            <div className="mx-auto max-w-2xl py-6 sm:py-12">
              <div className="mb-7 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center bg-emerald-500/10 text-emerald-300">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-white">
                    What would you like to do?
                  </p>
                  <p className="text-sm text-slate-500">
                    Ask a question or describe a treasury action.
                  </p>
                </div>
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
                    className="border border-slate-800 bg-slate-900/60 px-4 py-3 text-left text-sm text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-200 disabled:opacity-40"
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
                    ? "bg-emerald-500/10 text-emerald-300"
                    : "bg-slate-800 text-slate-300"
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
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {message.role === "assistant" ? "Hermes" : "You"}
                </p>
                <div
                  className={`whitespace-pre-wrap break-words px-4 py-3 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "inline-block bg-emerald-500/15 text-emerald-50"
                      : "border border-slate-800 bg-slate-900/60 text-slate-200"
                  }`}
                >
                  {message.content}
                </div>
                {message.role === "assistant" && message.intent && (
                  <div className="mt-3 border border-emerald-500/30 bg-emerald-500/[0.04] p-4 text-left">
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
                        className="mt-4 inline-flex items-center gap-2 bg-emerald-400 px-4 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Wallet className="h-4 w-4" />
                        Continue in wallet
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
              Hermes is reading the treasury…
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
                Switch to {ARC_CHAIN.name} to chat and sign treasury actions.
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

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="border-t border-slate-800 bg-[#0a0f1c] px-4 py-3 sm:px-8"
        >
          <div className="mx-auto flex max-w-3xl items-end gap-2 border border-slate-700 bg-slate-950/70 p-2 focus-within:border-emerald-500/50">
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
              aria-label="Message Hermes"
              disabled={!isConnected || busy || wrongChain}
              placeholder={
                isConnected ? "Message Hermes…" : "Connect a wallet to start"
              }
              className="max-h-40 min-h-12 flex-1 resize-y bg-transparent px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={
                !isConnected || busy || wrongChain || input.trim().length === 0
              }
              aria-label="Send message"
              className="flex h-10 w-10 shrink-0 items-center justify-center bg-emerald-400 text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-[10px] text-slate-600">
            Hermes prepares the action. Your connected wallet shows and signs
            every transaction.
          </p>
        </form>
      </div>
    </section>
  );
}
