/**
 * Pending cross-chain CCTP transfers builder. These rows use the same
 * ActivityRow presentation as treasury chain events so the Activity tab is
 * uniform; they render before the chain rows because a source burn does not
 * exist in Arc logs until the mint/deposit lands.
 */
import {
  ARC_CCTP_DOMAIN,
  explorerTx,
} from '../lib/contracts'
import { getCctpDestination } from '../lib/cctp'
import { formatUsdcDollar } from '../lib/decimals'
import type { ActivityLink, ActivityRowData } from './EventRow'

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
  completed?: boolean          // finished transfer: no Resume CTA
}

const KIND_LABEL: Record<PendingCctpItem['direction'], string> = {
  in: 'CCTP Deposit',
  out: 'CCTP Withdrawal',
}

const KIND_CLASS: Record<PendingCctpItem['direction'], string> = {
  in:  'bg-blue-500/15 text-blue-400 border-blue-500/20',
  out: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
}

/** Completed status badge: keeps the kind badge but flips it to a done tone. */
const COMPLETED_CLASS = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'

/**
 * Build the shared-shape row for a pending transfer. `onResume` receives the
 * item (only invoked from the non-completed CTA).
 */
export function pendingRowData(
  item: PendingCctpItem,
  onResume: (item: PendingCctpItem) => void,
): ActivityRowData {
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

  const links: ActivityLink[] = [{ href: burnHref, label: 'Burn tx' }]
  if (item.mintHash && mintHref) {
    links.push({ href: mintHref, label: 'Mint tx', className: 'text-blue-400 hover:text-blue-300' })
  }

  return {
    badgeLabel: KIND_LABEL[item.direction],
    badgeClass: item.completed ? COMPLETED_CLASS : KIND_CLASS[item.direction],
    title: `${amountLabel} · ${item.statusLabel} · ${sourceLabel} → ${destinationLabel}`,
    meta: new Date(item.timestamp).toLocaleString(),
    links,
    action: item.completed
      ? undefined
      : { label: 'Resume', onClick: () => onResume(item) },
  }
}
