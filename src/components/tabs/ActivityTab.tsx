import { Clock, Download, ExternalLink, RefreshCw } from 'lucide-react'
import { useAccount } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { useUiStore } from '../../stores/ui'
import { BRIDGE_STATUS_LABEL, useBridgeDepositStore } from '../../stores/bridgeDeposit'
import { useFlowStore } from '../../stores/flow'
import { getCctpDestination } from '../../lib/cctp'
import { formatUsdcDollar } from '../../lib/decimals'
import { ARC_CCTP_DOMAIN } from '../../lib/contracts'
import { EventRow } from '../EventRow'
import { PendingCctpRow } from '../PendingCctpRow'
import type { PendingCctpItem } from '../PendingCctpRow'
import { exportCsv } from '../../lib/activity'
import type { ActivityEventType } from '../../lib/activity'
import type { BridgeDepositStatus } from '../../stores/bridgeDeposit'

/**
 * Filter taxonomy. Deposits = local on-chain deposit events + cross-chain
 * inbound (pending store). Withdrawals = local withdrawals + outbound CCTP
 * burns, and every CCTP row is labeled with its direction so a pending
 * cross-chain transfer is never confused with a local one.
 */
type ActivityFilter = ActivityEventType | 'all' | 'inflight' | 'deposits' | 'withdrawals'

const FILTER_OPTIONS: { label: string; value: ActivityFilter }[] = [
  { label: 'All',         value: 'all' },
  { label: 'In flight',   value: 'inflight' },
  { label: 'Deposits',    value: 'deposits' },
  { label: 'Withdrawals', value: 'withdrawals' },
  { label: 'Yield',       value: 'YieldClaimed' },
]

/** Which treasury events belong in which filter (All = no restriction). */
const EVENT_FILTER: Partial<Record<ActivityFilter, ActivityEventType[] | null>> = {
  all: null,
  inflight: [],
  deposits: ['DepositRecorded'],
  withdrawals: ['WithdrawalRequested', 'WithdrawalToWallet', 'WithdrawalExecuted', 'WithdrawalCancelled'],
  YieldClaimed: ['YieldClaimed'],
}

const OUT_STATUS = {
  waiting: { label: 'Waiting for Circle', tone: 'info' as const },
  ready:   { label: 'Ready to mint', tone: 'action' as const },
  minting: { label: 'Minting', tone: 'info' as const },
  error:   { label: 'Needs attention', tone: 'error' as const },
  done:    { label: 'Credited', tone: 'action' as const },
}

function bridgeStatusTone(status: BridgeDepositStatus): PendingCctpItem['tone'] {
  if (status === 'ready') return 'action'
  if (status === 'error') return 'error'
  return 'info'
}

function bridgeAmount(amount: string): bigint {
  try {
    return amount ? BigInt(amount) : 0n
  } catch {
    return 0n
  }
}

/**
 * Pending transfers come from persisted client-side state, so they exist
 * before the Arc logs do (a source burn is not in Arc logs until the
 * mint/deposit lands). Both halves are filtered to the connected wallet.
 */
function buildPendingItems(
  address: string,
  filter: ActivityFilter,
): PendingCctpItem[] {
  const items: PendingCctpItem[] = []

  // Inbound: source-chain burn -> Arc mint. "In flight" hides completed ones;
  // Deposits/All keep them as "Credited" rows (they have no chain event of
  // their own because the app mints to the wallet and calls deposit()).
  if (filter === 'all' || filter === 'inflight' || filter === 'deposits') {
    for (const record of useBridgeDepositStore.getState().recent) {
      if (filter === 'inflight' && record.status === 'done') continue
      if (record.owner.toLowerCase() !== address.toLowerCase()) continue
      items.push({
        id: `in-${record.burnHash}`,
        direction: 'in',
        sourceDomain: record.sourceDomain,
        destinationDomain: ARC_CCTP_DOMAIN,
        amount: record.amount,
        burnHash: record.burnHash,
        mintHash: '',
        statusLabel: BRIDGE_STATUS_LABEL[record.status],
        tone: bridgeStatusTone(record.status),
        timestamp: record.createdAt,
      })
    }
  }

  // Outbound: Arc burn -> destination mint. Completed ones already exist as
  // WithdrawalRequested chain events, so only unfinished ones are shown here.
  if (filter === 'all' || filter === 'inflight' || filter === 'withdrawals') {
    for (const record of useFlowStore.getState().cctpHistory) {
      if (record.status === 'done') continue
      if (record.owner.toLowerCase() !== address.toLowerCase()) continue
      const labeled = OUT_STATUS[record.status] ?? { label: 'In progress', tone: 'info' as const }
      items.push({
        id: `out-${record.burnHash}`,
        direction: 'out',
        sourceDomain: ARC_CCTP_DOMAIN,
        destinationDomain: record.destinationDomain,
        amount: record.amount,
        burnHash: record.burnHash,
        mintHash: record.mintHash,
        statusLabel: labeled.label,
        tone: labeled.tone,
        timestamp: record.updatedAt,
      })
    }
  }

  return items.sort((a, b) => b.timestamp - a.timestamp)
}

export function ActivityTab() {
  const { address } = useAccount()
  const queryClient = useQueryClient()
  const { activityEvents, activityFilter, activityLoading, setFilter, setTab } = useUiStore()
  const bridge = useBridgeDepositStore()
  const flow = useFlowStore()

  const filter = activityFilter
  const pendingItems = address ? buildPendingItems(address, filter) : []
  const inflightCount = address ? buildPendingItems(address, 'inflight').length : 0

  const allowedTypes = EVENT_FILTER[filter]
  const filtered = allowedTypes
    ? activityEvents.filter((e) => allowedTypes.includes(e.type))
    : activityEvents

  const bridgeSource = getCctpDestination(bridge.sourceDomain)
  const bridgeOwnerMatches = Boolean(
    address && bridge.owner && address.toLowerCase() === bridge.owner.toLowerCase(),
  )
  const showBridge = bridgeOwnerMatches && bridge.status !== 'idle' && bridge.status !== 'done'
  const pendingAmount = bridgeAmount(bridge.amount)

  function handleCsv() {
    const csv = exportCsv(filtered)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'agent-treasury-activity.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function resumePending(item: PendingCctpItem) {
    if (item.direction === 'in') {
      const record = bridge.recent.find((r) => `in-${r.burnHash}` === item.id)
      if (record) bridge.restoreBridgeDeposit(record)
      setTab('deposit')
      return
    }
    const record = flow.cctpHistory.find((r) => `out-${r.burnHash}` === item.id)
    if (record) {
      // Restore the flow the same way the Withdraw tab's paste-hash recovery
      // does: waiting re-triggers the Iris poll + already-minted detection.
      flow.setCctp({
        cctpStep: 'success',
        cctpHash: record.burnHash,
        cctpOwner: record.owner,
        cctpError: '',
        cctpCompletionStatus: 'waiting',
        cctpDestinationDomain: record.destinationDomain,
        cctpAmount: record.amount,
        cctpRecipient: record.recipient,
        cctpMessage: '',
        cctpAttestation: '',
        cctpMintHash: '',
        cctpCompletionError: '',
      })
    }
    setTab('withdraw')
  }

  if (!address) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
        <p className="text-slate-400">Connect your wallet to view activity.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {showBridge && filter !== 'inflight' && (
        <div
          role="status"
          className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4"
        >
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-white">Cross-chain deposit in progress</p>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
                  {BRIDGE_STATUS_LABEL[bridge.status]}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                {pendingAmount > 0n ? formatUsdcDollar(pendingAmount) : 'USDC'} from{' '}
                {bridgeSource?.name ?? 'the source chain'}. The burn is on the source chain; it will
                appear in Arc activity only after Circle attests and the Arc mint/deposit completes.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {bridge.burnHash && bridgeSource && (
                  <a
                    href={`${bridgeSource.explorer}/tx/${bridge.burnHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-emerald-400 underline hover:text-emerald-300"
                  >
                    View source burn <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setTab('deposit')}
                  className="text-xs text-slate-400 underline hover:text-slate-200"
                >
                  View bridge progress
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 overflow-x-auto">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition ${
                filter === opt.value
                  ? 'bg-emerald-500 text-black'
                  : 'border border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {opt.label}
              {opt.value === 'inflight' && inflightCount > 0 && ` (${inflightCount})`}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => { void queryClient.invalidateQueries({ queryKey: ['activity', address] }) }}
            className="flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
          >
            <RefreshCw className={`h-3 w-3 ${activityLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {filter !== 'inflight' && filtered.length > 0 && (
            <button
              onClick={handleCsv}
              className="flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
            >
              <Download className="h-3 w-3" />
              CSV
            </button>
          )}
        </div>
      </div>

      {/* Table. Pending rows (persisted client-side state) render first so an
          in-flight transfer is visible even though Arc has no log for it yet. */}
      {filter === 'inflight' ? (
        pendingItems.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-slate-500">No transfers in flight.</p>
            <p className="text-xs text-slate-600">
              Cross-chain CCTP deposits and withdrawals in progress appear here with their burn tx
              hash.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/60">
            {pendingItems.map((item) => (
              <PendingCctpRow key={item.id} item={item} onResume={resumePending} />
            ))}
          </div>
        )
      ) : activityLoading && filtered.length === 0 && pendingItems.length === 0 ? (
        <div className="flex h-40 items-center justify-center">
          <p className="text-sm text-slate-500">Scanning event logs…</p>
        </div>
      ) : filtered.length === 0 && pendingItems.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-slate-500">No events found.</p>
          <p className="text-xs text-slate-600">Make a deposit to see activity here.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/60">
          {pendingItems.map((item) => (
            <PendingCctpRow key={item.id} item={item} onResume={resumePending} />
          ))}
          {pendingItems.length > 0 && filtered.length > 0 && (
            <div className="bg-slate-950/60 px-4 py-1.5 text-[10px] uppercase tracking-wider text-slate-600">
              On-chain events
            </div>
          )}
          {filtered.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  )
}
