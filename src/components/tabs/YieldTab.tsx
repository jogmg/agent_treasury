import { useState } from 'react'
import { TrendingUp, Info, Lock } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useAccount } from 'wagmi'
import { useTreasuryStore } from '../../stores/treasury'
import { useUiStore } from '../../stores/ui'
import { StatCard } from '../StatCard'
import { formatUsdcDollar, formatApy, formatUsdc, formatShares, projectYield } from '../../lib/decimals'
import { VAULT_1_NAME, VAULT_1_APY_DISPLAY } from '../../lib/contracts'

export function YieldTab() {
  const { address } = useAccount()
  const { totalBalance, principal, vaultShares, vaultApy, vaultTvl, pricePerShare, vaultShareDecimals } = useTreasuryStore()
  const { growthHistory } = useUiStore()
  const [projDays, setProjDays] = useState(30)

  if (!address) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-slate-400">Connect your wallet to view yield.</p>
      </div>
    )
  }

  const sharesValue = vaultShares > 0n
    ? (vaultShares * pricePerShare) / BigInt('1000000000000000000')
    : 0n
  const projected = projectYield(totalBalance, vaultApy, projDays)
  const projGain   = projected > totalBalance ? projected - totalBalance : 0n

  // Growth chart data
  const chartData = growthHistory.map((s) => ({
    time: new Date(s.ts).toLocaleDateString(),
    value: Number(formatUsdc(s.value, 2)),
  }))

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Active vault card */}
      <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-slate-900 to-slate-900 p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Active Vault</p>
            <p className="mt-1 text-lg font-semibold text-white">{VAULT_1_NAME}</p>
          </div>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-400">
            {vaultApy > 0n ? formatApy(vaultApy) : VAULT_1_APY_DISPLAY} APY
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-slate-500">Your Shares</p>
            <p className="mt-1 font-mono text-sm tabular-nums text-white">{formatShares(vaultShares, vaultShareDecimals, 4)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Share Value</p>
            <p className="mt-1 font-mono text-sm tabular-nums text-emerald-300">{formatUsdcDollar(sharesValue)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Vault TVL</p>
            <p className="mt-1 font-mono text-sm tabular-nums text-white">{formatUsdcDollar(vaultTvl)}</p>
          </div>
        </div>
      </div>

      {/* Yield overview */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Principal Deployed"
          value={formatUsdcDollar(principal)}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="Total Balance"
          value={formatUsdcDollar(totalBalance)}
          sub={totalBalance > principal ? `+${formatUsdc(totalBalance - principal, 4)} yield` : 'No yield yet'}
          accent={totalBalance > principal}
        />
      </div>

      {/* APY calculator */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">Yield Projection (Compound)</h2>
        <div className="mb-4 flex gap-2">
          {[7, 30, 90, 365].map((d) => (
            <button
              key={d}
              onClick={() => setProjDays(d)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                projDays === d
                  ? 'bg-emerald-500 text-black'
                  : 'border border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500">Projected value</p>
            <p className="mt-1 font-mono text-xl tabular-nums text-emerald-300">{formatUsdcDollar(projected)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Expected gain</p>
            <p className="mt-1 font-mono text-xl tabular-nums text-emerald-300">+{formatUsdc(projGain, 4)}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-600">
          Projection uses cached on-chain APY. Actual returns vary. Not financial advice.
        </p>
      </div>

      {/* Strategy selector */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-white">Vault Tiers</h2>
        <div className="space-y-2">
          {/* Vault 1 — active */}
          <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div>
              <p className="text-sm font-medium text-white">{VAULT_1_NAME}</p>
              <p className="text-xs text-slate-500">Conservative — 10 USDC min</p>
            </div>
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-400">Active</span>
          </div>
          {/* Vaults 2 & 3 — not deployed */}
          {['USDC Steady', 'USDC Growth'].map((name) => (
            <div key={name} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/40 p-4 opacity-50">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
                  <Lock className="h-3.5 w-3.5" /> {name}
                </p>
                <p className="text-xs text-slate-600">Not deployed on Arc Testnet</p>
              </div>
              <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-600">Unavailable</span>
            </div>
          ))}
        </div>
      </div>

      {/* Portfolio growth chart */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">Portfolio Growth</h2>
        {chartData.length < 2 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-center">
            <Info className="h-5 w-5 text-slate-600" />
            <p className="text-xs text-slate-500">
              Snapshots accumulate as you use the app. Come back after a few sessions to see your growth chart.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="emeraldGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#e2e8f0', fontSize: '12px' }}
                formatter={(v: unknown) => [`$${(v as number).toFixed(2)}`, 'Balance']}
              />
              <Area type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} fill="url(#emeraldGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
