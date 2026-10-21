/**
 * A pending cross-chain CCTP transfer row for the Activity tab. Unlike chain
 * event rows these come from the persisted client-side stores, so they still
 * show after a reload — long before the mint/deposit appears in Arc logs.
 */
import { ExternalLink, MoveRight } from 'lucide-react'
import { getCctpDestination } from '../lib/cctp'
import { ARC_CCTP_DOMAIN, explorerTx } from '../lib/contracts'
import { formatUsdcDollar } from '../lib/decimals'

export interface PendingCctpItem {
  id: string                   // direction-prefixed burn hash
  direction: 'in' | 'out'
  sourceDomain: number
  destinationDomain: number
  amount: string               // raw 6-decimals, may be ''
  burnHash: string             // source-chain tx that burned the USDC
  mintHash: string             // destination-chain mint tx once known
  statusLabel: string
  tone: 'info' | 'action' | 'error'
  timestamp: number
}

const TONE_CLASSES: Record<PendingCctpItem['tone'], string> = {
  info:   'bg-amber-500/15 text-amber-400 border-amber-500/20',
  action: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  error:  'bg-red-500/15 text-red-400 border-red-500/20',
}

function hashLabel(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`
}

interface Props {
  item: PendingCctpItem
  onResume: (item: PendingCctpItem) => void
}

export function PendingCctpRow({ item, onResume }: Props) {
  const source = getCctpDestination(item.sourceDomain)
  const destination = getCctpDestination(item.destinationDomain)
  // Arc is not a CCTP destination entry (withdrawals to Arc domain 26 are
  // rejected), so name it directly and link Arc burns via the Arc explorer.
  const sourceLabel = item.sourceDomain === ARC_CCTP_DOMAIN
    ? 'Arc'
    : source?.name ?? `domain ${item.sourceDomain}`
  const destinationLabel = item.destinationDomain === ARC_CCTP_DOMAIN
    ? 'Arc'
    : destination?.name ?? `domain ${item.destinationDomain}`

  let amountLabel = 'USDC'
  try {
    const parsed = item.amount ? BigInt(item.amount) : 0n
    if (parsed > 0n) amountLabel = formatUsdcDollar(parsed)
  } catch {
    amountLabel = 'USDC'
  }

  // The burn is always on the source chain; the mint sits on the destination.
  const burnHref = source ? `${source.explorer}/tx/${item.burnHash}` : explorerTx(item.burnHash)
  const mintHref = item.mintHash && destination
    ? `${destination.explorer}/tx/${item.mintHash}`
    : ''

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${TONE_CLASSES[item.tone]}`}
        >
          {item.statusLabel}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-sm text-slate-300">
          {amountLabel}
          <span className="text-slate-600">·</span>
          {sourceLabel}
          <MoveRight className="h-3 w-3 shrink-0 text-slate-600" />
          {destinationLabel}
        </span>
        <button
          type="button"
          onClick={() => onResume(item)}
          className="shrink-0 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:border-emerald-500/40 hover:text-emerald-400"
        >
          Resume
        </button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-600">
        <span>{new Date(item.timestamp).toLocaleString()}</span>
        <a
          href={burnHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 font-mono text-emerald-400 hover:text-emerald-300"
        >
          {hashLabel(item.burnHash)} <ExternalLink className="h-3 w-3" />
        </a>
        {item.mintHash && mintHref && (
          <a
            href={mintHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-mono text-blue-400 hover:text-blue-300"
          >
            Mint {hashLabel(item.mintHash)} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  )
}
