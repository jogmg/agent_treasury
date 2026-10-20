import { Download, RefreshCw } from 'lucide-react'
import { useAccount } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { useUiStore } from '../../stores/ui'
import { EventRow } from '../EventRow'
import { exportCsv } from '../../lib/activity'
import type { ActivityEventType } from '../../lib/activity'

const FILTER_OPTIONS: { label: string; value: ActivityEventType | 'all' }[] = [
  { label: 'All',       value: 'all' },
  { label: 'Deposits',  value: 'DepositRecorded' },
  { label: 'Withdrawals', value: 'WithdrawalToWallet' },
  { label: 'CCTP',      value: 'WithdrawalRequested' },
  { label: 'Yield',     value: 'YieldClaimed' },
]

export function ActivityTab() {
  const { address } = useAccount()
  const queryClient = useQueryClient()
  const { activityEvents, activityFilter, activityLoading, setFilter } = useUiStore()

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
