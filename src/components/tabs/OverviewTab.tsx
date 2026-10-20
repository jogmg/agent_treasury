import { TrendingUp, Zap, Layers, ArrowRight, Info } from 'lucide-react'
import { useTreasuryStore } from '../../stores/treasury'
import { useUiStore } from '../../stores/ui'
import { useAccount } from 'wagmi'
import { StatCard } from '../StatCard'
import { EventRow } from '../EventRow'
import { formatUsdcDollar, formatApy, formatShares } from '../../lib/decimals'
import { VAULT_1_NAME } from '../../lib/contracts'

export function OverviewTab() {
  const { address } = useAccount()
  const { totalBalance, principal, vaultShares, vaultApy, pricePerShare, vaultShareDecimals, isFetching } = useTreasuryStore()
  const { activityEvents, setTab } = useUiStore()

  const accrued = totalBalance > principal ? totalBalance - principal : 0n
  const recentEvents = activityEvents.slice(0, 5)

  // pricePerShare is 1e18-scaled: value of vaultShares in USDC-6
  // shares are in vault native units; use pricePerShare for display
  const sharesValueRaw = vaultShares > 0n
    ? (vaultShares * pricePerShare) / BigInt('1000000000000000000')
    : 0n

  if (!address) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <Layers className="h-10 w-10 text-slate-600" />
        <p className="text-slate-400">Connect your wallet to view your treasury.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Hero balance */}
      <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-slate-900 to-slate-900 p-6">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Total Value</p>
        <p className="mt-2 font-mono text-4xl font-bold tabular-nums text-white">
          {isFetching && totalBalance === 0n ? '—' : formatUsdcDollar(totalBalance)}
        </p>
        <p className="mt-1 text-sm text-slate-500">Arc Testnet</p>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Principal"
          value={formatUsdcDollar(principal)}
          sub="deposited total"
          icon={<Layers className="h-4 w-4" />}
        />
        <StatCard
          label="Yield Earned"
          value={formatUsdcDollar(accrued)}
          sub="accrued since deposit"
          accent={accrued > 0n}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="APY"
          value={vaultApy > 0n ? formatApy(vaultApy) : '—'}
          sub={VAULT_1_NAME}
          icon={<Zap className="h-4 w-4" />}
        />
        <StatCard
          label="Vault Shares"
          value={formatShares(vaultShares, vaultShareDecimals, 4)}
          sub={`≈ ${formatUsdcDollar(sharesValueRaw)} USDC`}
        />
      </div>

      {/* Chain breakdown */}
      <div>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-500">Chain Breakdown</h2>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Arc Testnet</p>
              <p className="text-xs text-slate-500">Local deposits via deposit()</p>
            </div>
            <p className="font-mono text-sm tabular-nums text-emerald-300">
              {formatUsdcDollar(principal)}
            </p>
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-slate-800/60 p-3">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
            <p className="text-xs text-slate-500">
              Cross-chain balances from other domains require a server-side indexer with a Circle API key.
              This build shows Arc-local deposits only.
            </p>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Deposit',  tab: 'deposit'  },
          { label: 'Withdraw', tab: 'withdraw' },
          { label: 'Yield',    tab: 'yield'    },
          { label: 'Activity', tab: 'activity' },
        ].map(({ label, tab }) => (
          <button
            key={tab}
            onClick={() => setTab(tab as import('../../stores/ui').TabId)}
            className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm font-medium text-white transition hover:border-emerald-500/40 hover:bg-emerald-500/5"
          >
            {label}
            <ArrowRight className="h-4 w-4 text-slate-500" />
          </button>
        ))}
      </div>

      {/* Recent activity */}
      {recentEvents.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">Recent Activity</h2>
            <button
              onClick={() => setTab('activity')}
              className="text-xs text-emerald-400 hover:text-emerald-300"
            >
              View all
            </button>
          </div>
          <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/60">
            {recentEvents.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
