import { Clock, Download, ExternalLink, RefreshCw } from 'lucide-react'
import { useAccount } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { useUiStore } from '../../stores/ui'
import { useBridgeDepositStore } from '../../stores/bridgeDeposit'
import { getCctpDestination } from '../../lib/cctp'
import { formatUsdcDollar } from '../../lib/decimals'
import { EventRow } from '../EventRow'
import { exportCsv } from '../../lib/activity'
import type { ActivityEventType } from '../../lib/activity'
import type { BridgeDepositStatus } from '../../stores/bridgeDeposit'

const FILTER_OPTIONS: { label: string; value: ActivityEventType | 'all' }[] = [
  { label: 'All',       value: 'all' },
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

function bridgeAmount(amount: string): bigint {
  try {
    return amount ? BigInt(amount) : 0n
  } catch {
    return 0n
  }
}

export function ActivityTab() {
  const { address } = useAccount()
  const queryClient = useQueryClient()
  const { activityEvents, activityFilter, activityLoading, setFilter, setTab } = useUiStore()
  const bridge = useBridgeDepositStore()

  const bridgeSource = getCctpDestination(bridge.sourceDomain)
  const bridgeOwnerMatches = Boolean(
    address && bridge.owner && address.toLowerCase() === bridge.owner.toLowerCase(),
  )
  const showBridge =
    bridgeOwnerMatches && bridge.status !== 'idle' && bridge.status !== 'done'
  const pendingAmount = bridgeAmount(bridge.amount)

  const filtered = activityFilter === 'all'
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

  if (!address) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
        <p className="text-slate-400">Connect your wallet to view activity.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {showBridge && (
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
          {filtered.length > 0 && (
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

      {/* Table */}
      {activityLoading && filtered.length === 0 ? (
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
