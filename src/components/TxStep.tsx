import { clsx } from 'clsx'
import { Check, Loader2, X, ExternalLink } from 'lucide-react'
import type { FlowStep } from '../stores/flow'
import { explorerTx } from '../lib/contracts'

interface Props {
  step: FlowStep
  hash?: string
  error?: string
  labels?: { pending?: string; confirming?: string; success?: string }
  onReset?: () => void
}

export function TxStep({ step, hash, error, labels, onReset }: Props) {
  if (step === 'idle') return null

  const isLoading = step === 'approving' || step === 'pending' || step === 'confirming'
  const isError   = step === 'error'
  const isSuccess = step === 'success'

  const message =
    step === 'approving'  ? 'Approving USDC…' :
    step === 'pending'    ? (labels?.pending    ?? 'Confirm in wallet…') :
    step === 'confirming' ? (labels?.confirming ?? 'Waiting for confirmation…') :
    step === 'success'    ? (labels?.success    ?? 'Transaction confirmed!') :
    (error ?? 'Transaction failed.')

  return (
    <div className={clsx(
      'mt-4 flex items-start gap-3 rounded-xl border p-4 text-sm',
      isLoading && 'border-slate-700 bg-slate-800/50 text-slate-300',
      isSuccess && 'border-emerald-500/30 bg-[#083D77]/10 text-emerald-300',
      isError   && 'border-red-500/30 bg-red-500/10 text-red-300',
    )}>
      <span className="mt-0.5 shrink-0">
        {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {isSuccess && <Check className="h-4 w-4" />}
        {isError   && <X    className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p>{message}</p>
        {hash && (
          <a
            href={explorerTx(hash)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
          >
            View on explorer <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {(isSuccess || isError) && onReset && (
        <button
          onClick={onReset}
          className="shrink-0 text-xs text-slate-500 hover:text-slate-300"
        >
          Dismiss
        </button>
      )}
    </div>
  )
}
