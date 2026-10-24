import { useEffect, useRef, useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import {
  AlertCircle,
  Loader2,
  Send,
  Sparkles,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import { useAccount, useSwitchChain } from 'wagmi'
import { useHermesChat } from '../hooks/useHermesChat'
import { ARC_CHAIN, ARC_CHAIN_ID } from '../lib/contracts'

const SUGGESTIONS = [
  'How much USDC do I have?',
  'What happened recently?',
  'Is my treasury paused?',
]

export function HermesDock() {
  const { address } = useAccount()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="hermes-chat-panel"
        aria-label="Ask Hermes"
        className="fixed bottom-20 right-4 z-40 flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-200 shadow-lg shadow-emerald-950/30 backdrop-blur-md transition hover:bg-emerald-500/25"
      >
        <Sparkles className="h-4 w-4" />
        <span className="hidden sm:inline">Ask Hermes</span>
      </button>

      <HermesPanel
        key={address ?? 'disconnected'}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

function HermesPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()
  const { messages, busy, error, send, clear } = useHermesChat()
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const wrongChain = isConnected && chainId !== ARC_CHAIN_ID

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  useEffect(() => {
    if (!open) return
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, busy, open])

  async function submit() {
    const text = input.trim()
    if (!text || busy || !isConnected || wrongChain) return
    setInput('')
    await send(text)
  }

  if (!open) return null

  return (
    <section
      id="hermes-chat-panel"
      role="dialog"
      aria-label="Ask Hermes"
      className="fixed bottom-36 left-4 right-4 z-50 flex max-h-[min(34rem,calc(100dvh-10rem))] flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#0b1120] shadow-2xl shadow-black/50 sm:left-auto sm:w-[24rem]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30">
            <Sparkles className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Ask Hermes</h2>
            <p className="text-[11px] text-slate-500">Read-only · never signs</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={clear}
            disabled={messages.length === 0 || busy}
            aria-label="Clear chat"
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-800 hover:text-slate-300 disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Hermes"
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-800 hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {!isConnected && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-8 text-center">
            <Wallet className="h-7 w-7 text-slate-500" />
            <p className="text-sm text-slate-300">Connect your wallet to ask Hermes.</p>
            <p className="text-xs text-slate-500">
              Hermes needs a wallet-bound session so it never reads another account.
            </p>
            <ConnectKitButton />
          </div>
        )}

        {isConnected && messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">
              Ask about your treasury, activity, or a CCTP transfer. Hermes answers from
              live reads and never moves funds.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setInput(suggestion)
                    inputRef.current?.focus()
                  }}
                  disabled={busy || wrongChain}
                  className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-left text-xs text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-200 disabled:opacity-40"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className={
                message.role === 'user'
                  ? 'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-emerald-500/20 px-3 py-2 text-sm text-emerald-50'
                  : 'max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md border border-slate-800 bg-slate-900/80 px-3 py-2 text-sm leading-relaxed text-slate-200'
              }
            >
              {message.content}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Hermes is reading the treasury…
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {wrongChain && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <p>Switch to {ARC_CHAIN.name} before signing in.</p>
            <button
              type="button"
              onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}
              disabled={switching}
              className="mt-2 rounded-lg bg-amber-500/20 px-2.5 py-1 font-semibold text-amber-100 transition hover:bg-amber-500/30 disabled:opacity-50"
            >
              {switching ? 'Switching…' : `Switch to ${ARC_CHAIN.name}`}
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className="border-t border-slate-800 p-3"
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
            rows={2}
            maxLength={4_000}
            aria-label="Message Hermes"
            disabled={!isConnected || busy || wrongChain}
            placeholder={
              isConnected
                ? 'Ask about balances, activity, or a CCTP transfer…'
                : 'Connect a wallet to start'
            }
            className="min-h-[3.25rem] flex-1 resize-none rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500/50 focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!isConnected || busy || wrongChain || input.trim().length === 0}
            aria-label="Send message"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-600">
          Hermes can explain your treasury and point you to the right screen. It cannot
          sign or move funds. You always sign in your own wallet.
        </p>
      </form>
    </section>
  )
}
