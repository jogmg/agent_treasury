import { AlertTriangle, Sparkles, X } from 'lucide-react'
import { formatUsdc, shortAddr } from '../lib/decimals'
import { getCctpDestination } from '../lib/cctp'
import type { HermesIntent } from '../lib/hermes'

function amountLabel(intent: HermesIntent): string {
  const raw = BigInt(intent.amount)
  const formatted = formatUsdc(raw, 6).replace(/\.?0+$/, '')
  return `${formatted || '0'} USDC`
}

function titleFor(intent: HermesIntent): string {
  if (intent.kind === 'deposit') return 'Deposit draft'
  if (intent.kind === 'withdrawLocal') return 'Withdrawal draft'
  return 'CCTP withdrawal draft'
}

export function IntentReviewCard({
  intent,
  onDismiss,
}: {
  intent: HermesIntent
  onDismiss?: () => void
}) {
  const destination =
    intent.destinationDomain === null
      ? null
      : getCctpDestination(intent.destinationDomain)

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30">
            <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
          </div>
          <div>
            <p className="text-sm font-semibold text-emerald-100">{titleFor(intent)}</p>
            <p className="mt-0.5 text-xs text-emerald-300/70">
              Prepared by Hermes · unsigned · expiring draft
            </p>
          </div>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss draft"
            className="rounded-lg p-1 text-emerald-300/60 transition hover:bg-emerald-500/10 hover:text-emerald-200"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-slate-500">Amount</dt>
        <dd className="font-mono tabular-nums text-slate-200">
          {intent.isMax ? 'All available · ' : ''}
          {amountLabel(intent)}
        </dd>

        <dt className="text-slate-500">Route</dt>
        <dd className="text-slate-300">
          {intent.kind === 'deposit'
            ? 'Wallet → Arc treasury'
            : intent.kind === 'withdrawLocal'
              ? 'Arc treasury → connected wallet'
              : `Arc → ${destination?.name ?? `domain ${intent.destinationDomain}`}`}
        </dd>

        {intent.mintRecipient && (
          <>
            <dt className="text-slate-500">Recipient</dt>
            <dd className="font-mono text-slate-300" title={intent.mintRecipient}>
              {shortAddr(intent.mintRecipient)}
            </dd>
          </>
        )}

        <dt className="text-slate-500">Expires</dt>
        <dd className="text-slate-400">
          {new Date(intent.expiresAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </dd>
      </dl>

      {intent.isMax && intent.kind === 'withdrawLocal' && (
        <p className="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-sky-300">
          Use <span className="font-semibold">Withdraw All</span> to use the contract&apos;s
          max sentinel. The amount above is the balance when Hermes prepared the draft.
        </p>
      )}

      {intent.simulation.warning === 'approval_required' && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-amber-300">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          This deposit needs a one-time USDC approval before the deposit transaction.
        </p>
      )}

      {!intent.simulation.ok && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-red-300">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {intent.simulation.error ?? 'This draft could not be simulated.'}
        </p>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
        Hermes never signs. Confirm the values above, then sign the transaction in your own wallet.
      </p>
    </div>
  )
}
