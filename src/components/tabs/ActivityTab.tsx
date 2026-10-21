import { Clock, Download, ExternalLink, RefreshCw } from 'lucide-react'
import { useAccount } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { useUiStore } from '../../stores/ui'
import { useBridgeDepositStore } from '../../stores/bridgeDeposit'
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

const FILTER_OPTIONS: { label: string; value: ActivityEventType | 'all' | 'pending' }[] = [
  { label: 'All',       value: 'all' },
  { label: 'Pending',   value: 'pending' },
  { label: 'Deposits',  value: 'DepositRecorded' },
  { label: 'Withdrawals', value: 'WithdrawalToWallet' },
  { label: 'CCTP',      value: 'WithdrawalRequested' },
  { label: 'Yield',     value: 'YieldClaimed' },
]

const BRIDGE_STATUS_LABEL: Record<BridgeDepositStatus, string> = {
  idle: 'Idle',
  approving: 'Approving source',
  burning: 'Burning source',
  waiting: 'Waiting for Circle',
  ready: 'Ready to mint',
  minting: 'Minting on Arc',
  'arc-approving': 'Approving on Arc',
  depositing: 'Depositing',
  done: 'Credited',
  error: 'Needs attention',
}

const OUT_STATUS_LABEL: Record<string, { label: string; tone: PendingCctpItem['tone'] }> = {
  waiting: { label: 'Waiting for Circle', tone: 'info' },
  ready:   { label: 'Ready to mint', tone: 'action' },
  minting: { label: 'Minting', tone: 'info' },
  error:   { label: 'Needs attention', tone: 'error' },
  done:    { label: 'Credited', tone: 'action' },
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
 * Pending transfers are enriched from persisted client-side state, so they
 * exist before the Arc logs do (source burns are not in Arc logs until the
 * mint/deposit lands). Both halves are filtered to the connected wallet so
 * one browser does not show another wallet's transfers.
 */
function buildPendingItems(address: string): PendingCctpItem[] {
  const items: PendingCctpItem[] = []

  // Inbound: source-chain burn -> Arc mint (bridge deposit store)
  for (const record of useBridgeDepositStore.getState().recent) {
    if (record.status === 'done') continue
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

  // Outbound: Arc burn -> destination mint (flow store history)
  for (const record of useFlowStore.getState().cctpHistory) {
    if (record.status === 'done') continue
    if (record.owner.toLowerCase() !== address.toLowerCase()) continue
    const labeled = OUT_STATUS_LABEL[record.status] ?? { label: 'In progress', tone: 'info' as const }
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

  return items.sort((a, b) => b.timestamp - a.timestamp)
}

export function ActivityTab() {
  const { address } = useAccount()
  const queryClient = useQueryClient()
  const { activityEvents, activityFilter, activityLoading, setFilter, setTab } = useUiStore()
  const bridge = useBridgeDepositStore()
  const flow = useFlowStore()

  const showPendingOnly = activityFilter === 'pending'
  const pendingItems = address ? buildPendingItems(address) : []

  const bridgeSource = getCctpDestination(bridge.sourceDomain)
  const bridgeOwnerMatches = Boolean(
    address && bridge.owner && address.toLowerCase() === bridge.owner.toLowerCase(),
  )
  const showBridge =
    bridgeOwnerMatches && bridge.status !== 'idle' && bridge.status !== 'done'
  const pendingAmount = bridgeAmount(bridge.amount)

  const filtered = showPendingOnly || activityFilter === 'all'
    ? activityEvents
    : activityEvents.filter((e) => e.type === activityFilter)

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
      const record = bridge.recent.find(
        (r) => `in-${r.burnHash}` === item.id,
      )
      if (record) bridge.restoreBridgeDeposit(record)
      setTab('deposit')
      return
    }
    const record = flow.cctpHistory.find(
      (r) => `out-${r.burnHash}` === item.id,
    )
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
      {showBridge && !showPendingOnly && (
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
                activityFilter === opt.value
                  ? 'bg-emerald-500 text-black'
                  : 'border border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {opt.label}
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
          {!showPendingOnly && filtered.length > 0 && (
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

      {/* Pending cross-chain transfers (from persisted local state) */}
      {showPendingOnly ? (
        pendingItems.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-slate-500">No pending cross-chain transfers.</p>
            <p className="text-xs text-slate-600">
              CCTP deposits and withdrawals in flight appear here with their burn tx hash.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/60">
            {pendingItems.map((item) => (
              <PendingCctpRow key={item.id} item={item} onResume={resumePending} />
            ))}
          </div>
        )
      ) : activityLoading && filtered.length === 0 ? (
        <div className="flex h-40 items-center justify-center">
          <p className="text-sm text-slate-500">Scanning event logs…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-slate-500">No events found.</p>
          <p className="text-xs text-slate-600">Make a deposit to see activity here.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/60">
          {filtered.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  )
}
