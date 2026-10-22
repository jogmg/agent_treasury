import { Clock, Download, ExternalLink, RefreshCw } from 'lucide-react'
import { useAccount } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { useUiStore } from '../../stores/ui'
import { BRIDGE_STATUS_LABEL, useBridgeDepositStore } from '../../stores/bridgeDeposit'
import { useFlowStore } from '../../stores/flow'
import { getCctpDestination, type CctpWithdrawalStatus } from '../../lib/cctp'
import { formatUsdcDollar } from '../../lib/decimals'
import { ARC_CCTP_DOMAIN } from '../../lib/contracts'
import { EventRow, ActivityRow } from '../EventRow'
import { pendingRowData } from '../PendingCctpRow'
import type { PendingCctpItem } from '../PendingCctpRow'
import { exportCsv } from '../../lib/activity'
import type { ActivityEvent, ActivityEventType } from '../../lib/activity'
import type { BridgeDepositStatus } from '../../stores/bridgeDeposit'
import { useCctpWithdrawalStatuses } from '../../hooks/useCctpWithdrawals'

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
  // In-flight outbound rows are WithdrawalRequested events whose off-chain
  // status is not done yet. The status map decides which ones to show.
  inflight: ['WithdrawalRequested'],
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

const PHASE_STATUS: Record<CctpWithdrawalStatus['phase'], { label: string; tone: PendingCctpItem['tone'] }> = {
  waiting: { label: 'Waiting for Circle', tone: 'info' },
  ready:   { label: 'Attested — mint pending', tone: 'action' },
  done:    { label: 'Minted', tone: 'action' },
  error:   { label: 'Status unavailable', tone: 'error' },
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

/** Chain rows carry an enriched block time (seconds); pending rows carry ms. */
function eventTimeMs(event: ActivityEvent): number {
  return typeof event.timestamp === 'number' && event.timestamp > 0
    ? event.timestamp * 1000
    : 0
}

interface DisplayRow {
  key: string
  item?: PendingCctpItem
  event?: ActivityEvent
}

/**
 * Pending transfers come from persisted client-side state, so they exist
 * before the Arc logs do (a source burn is not in Arc logs until the
 * mint/deposit lands). Both halves are filtered to the connected wallet.
 */
function buildPendingItems(
  address: string,
  filter: ActivityFilter,
  knownBurnHashes: Set<string>,
  statusMap: Record<string, CctpWithdrawalStatus>,
): PendingCctpItem[] {
  const items: PendingCctpItem[] = []

  // Inbound: source-chain burn -> Arc receiver/deposit. "In flight" hides
  // completed ones; Deposits/All keep them as "Credited" rows because the
  // source burn tx is not part of the Arc DepositRecorded event args.
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
        completed: record.status === 'done',
      })
    }
  }

  // Outbound: Arc burn -> destination mint. The WithdrawalRequested chain
  // event is the primary row now (enriched with the off-chain status). Only
  // fall back to the persisted client-side history when the log scan did not
  // return that burn, so the same transfer is never shown twice.
  if (filter === 'all' || filter === 'inflight' || filter === 'withdrawals') {
    for (const record of useFlowStore.getState().cctpHistory) {
      if (knownBurnHashes.has(record.burnHash.toLowerCase())) continue
      if (record.owner.toLowerCase() !== address.toLowerCase()) continue

      const status = statusMap[record.burnHash.toLowerCase()]
      const completed = status?.phase === 'done' || record.status === 'done'
      if (filter === 'inflight' && completed) continue

      const labeled = status
        ? PHASE_STATUS[status.phase]
        : OUT_STATUS[record.status] ?? { label: 'In progress', tone: 'info' as const }
      items.push({
        id: `out-${record.burnHash}`,
        direction: 'out',
        sourceDomain: ARC_CCTP_DOMAIN,
        destinationDomain: status?.destinationDomain ?? record.destinationDomain,
        amount: record.amount,
        burnHash: record.burnHash,
        mintHash: status?.mintTxHash ?? record.mintHash,
        statusLabel: labeled.label,
        tone: labeled.tone,
        timestamp: record.updatedAt,
        completed,
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
  // Local history can already prove completion while the Iris/destination
  // status map is still loading. Use it to suppress a false Resume CTA.
  const historyCompletion = new Map(
    flow.cctpHistory
      .filter((record) => address && record.owner.toLowerCase() === address.toLowerCase())
      .map(
        (record) => [record.burnHash.toLowerCase(), record.status === 'done'] as const,
      ),
  )

  const filter = activityFilter
  const chainBurnHashes = new Set(
    activityEvents
      .filter((event) => event.type === 'WithdrawalRequested')
      .map((event) => event.txHash.toLowerCase()),
  )
  const withdrawalBurnTxs = [
    ...chainBurnHashes,
    ...flow.cctpHistory.map((record) => record.burnHash.toLowerCase()),
  ]
  const { statuses: cctpStatuses } = useCctpWithdrawalStatuses(withdrawalBurnTxs)

  const pendingItems = address
    ? buildPendingItems(address, filter, chainBurnHashes, cctpStatuses)
    : []
  const inflightPending = address
    ? buildPendingItems(address, 'inflight', chainBurnHashes, cctpStatuses)
    : []

  const allowedTypes = EVENT_FILTER[filter]
  const filtered = allowedTypes
    ? activityEvents.filter((e) => allowedTypes.includes(e.type))
    : activityEvents

  // The chain row is the primary outbound representation. Its status comes
  // from Iris + the destination usedNonces/MessageReceived check, never from
  // the treasury's legacy executed flag.
  const inflightEvents = filter === 'inflight'
    ? filtered.filter((event) => cctpStatuses[event.txHash.toLowerCase()]?.phase !== 'done')
    : []
  const chainRows = filter === 'inflight' ? inflightEvents : filtered
  const inflightChainCount = activityEvents.filter(
    (event) => event.type === 'WithdrawalRequested' &&
      cctpStatuses[event.txHash.toLowerCase()]?.phase !== 'done',
  ).length
  const inflightCount = inflightPending.length + inflightChainCount

  // Chain events and in-flight rows are merged into one recency-sorted stream
  // whenever every chain event has a real block timestamp. If enrichment
  // failed, fall back to block-ordered chain rows after the pending ones.
  const eventsTimed = chainRows.length > 0
    ? chainRows.every((event) => event.timestamp !== undefined && event.timestamp > 0)
    : false

  function sortRows(rows: DisplayRow[]): DisplayRow[] {
    return rows.sort((a, b) => {
      const aTime = a.item ? a.item.timestamp : eventTimeMs(a.event!)
      const bTime = b.item ? b.item.timestamp : eventTimeMs(b.event!)
      if (aTime !== bTime) return bTime - aTime
      // Ties: chain rows fall back to block order (newest first).
      if (a.event && b.event) {
        return a.event.blockNumber > b.event.blockNumber ? -1
          : a.event.blockNumber < b.event.blockNumber ? 1 : 0
      }
      return 0
    })
  }

  let displayRows: DisplayRow[]
  if (filter === 'inflight') {
    displayRows = sortRows([
      ...pendingItems.map((item): DisplayRow => ({ key: item.id, item })),
      ...chainRows.map((event): DisplayRow => ({ key: `ev-${event.id}`, event })),
    ])
  } else if (eventsTimed) {
    displayRows = sortRows([
      ...pendingItems.map((item): DisplayRow => ({ key: item.id, item })),
      ...chainRows.map((event): DisplayRow => ({ key: `ev-${event.id}`, event })),
    ])
  } else {
    displayRows = [
      ...pendingItems.map((item): DisplayRow => ({ key: item.id, item })),
      ...chainRows.map((event): DisplayRow => ({ key: `ev-${event.id}`, event })),
    ]
  }

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

  function resumeWithdrawal(event: ActivityEvent) {
    if (!address) return
    const destinationDomain = Number(event.args.destinationDomain)
    const amount = event.args.amount
    const recipientWord = typeof event.args.mintRecipient === 'string'
      ? event.args.mintRecipient
      : ''
    const recipient = /^0x[0-9a-fA-F]{64}$/.test(recipientWord)
      ? `0x${recipientWord.slice(-40)}`
      : ''
    const amountText = typeof amount === 'bigint' || typeof amount === 'number'
      ? amount.toString()
      : typeof amount === 'string'
        ? amount
        : ''

    flow.setCctp({
      cctpStep: 'success',
      cctpHash: event.txHash,
      cctpOwner: address,
      cctpError: '',
      cctpCompletionStatus: 'waiting',
      cctpDestinationDomain: Number.isInteger(destinationDomain) ? destinationDomain : 0,
      cctpAmount: amountText,
      cctpRecipient: recipient,
      cctpMessage: '',
      cctpAttestation: '',
      cctpMintHash: '',
      cctpCompletionError: '',
    })
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
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ['activity', address] })
              void queryClient.invalidateQueries({ queryKey: ['cctp-withdrawals'] })
            }}
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

      {/* Table. In-flight rows use the same ActivityRow UI as chain events.
          Rows are merged and sorted most-recent first (by real block time for
          chain rows, capture time for in-flight transfers). */}
      {activityLoading && displayRows.length === 0 ? (
        <div className="flex h-40 items-center justify-center">
          <p className="text-sm text-slate-500">Scanning event logs…</p>
        </div>
      ) : displayRows.length === 0 && filter === 'inflight' ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-slate-500">No transfers in flight.</p>
          <p className="text-xs text-slate-600">
            Cross-chain CCTP deposits and withdrawals in progress appear here with their burn tx
            hash.
          </p>
        </div>
      ) : displayRows.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-slate-500">No events found.</p>
          <p className="text-xs text-slate-600">Make a deposit to see activity here.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/60">
          {displayRows.map((row) =>
            row.item ? (
              <ActivityRow
                key={row.key}
                data={pendingRowData(row.item, resumePending)}
              />
            ) : (
              <EventRow
                key={row.key}
                event={row.event!}
                cctpStatus={cctpStatuses[row.event!.txHash.toLowerCase()]}
                cctpCompleted={historyCompletion.get(row.event!.txHash.toLowerCase())}
                onResume={
                  row.event!.type === 'WithdrawalRequested'
                    ? () => resumeWithdrawal(row.event!)
                    : undefined
                }
              />
            ),
          )}
        </div>
      )}
    </div>
  )
}
