import { useEffect, useMemo, useState } from "react";
import { TrendingUp, Info } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useAccount } from "wagmi";
import { useTreasuryStore } from "../../stores/treasury";
import { useUiStore } from "../../stores/ui";
import { useMinDeposit } from "../../hooks/useMinDeposit";
import { StatCard } from "../StatCard";
import {
  formatUsdcDollar,
  formatApy,
  formatUsdc,
  formatShares,
  projectYield,
} from "../../lib/decimals";
import {
  VAULT_1_NAME,
  VAULT_1_TIER,
  VAULT_1_APY_DISPLAY,
} from "../../lib/contracts";

/** Compact axis label. Always includes the time, not just the calendar date. */
function formatSnapshotTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Chart time windows; ms === null means "everything we have". */
const GROWTH_RANGES = [
  { label: "24h", ms: 24 * 60 * 60 * 1000 },
  { label: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
  { label: "All", ms: null },
] as const;

export function YieldTab() {
  const { address } = useAccount();
  const {
    totalBalance,
    principal,
    vaultShares,
    vaultApy,
    vaultTvl,
    pricePerShare,
    vaultShareDecimals,
  } = useTreasuryStore();
  const { growthHistory } = useUiStore();
  const [projDays, setProjDays] = useState(7);
  const [growthRangeIdx, setGrowthRangeIdx] = useState(
    GROWTH_RANGES.length - 1
  );

  // Snapshot "now" outside of render so impure Date.now() never runs in JSX.
  // Before the effect fires the cutoff is negative, i.e. everything shown.
  const [growthNow, setGrowthNow] = useState(0);
  useEffect(() => {
    setGrowthNow(Date.now());
  }, [growthRangeIdx]);

  const growthRange = GROWTH_RANGES[growthRangeIdx];
  const growthCutoff = growthRange.ms !== null ? growthNow - growthRange.ms : 0;
  const chartData = useMemo(
    () =>
      growthHistory
        .filter((s) => s.ts >= growthCutoff)
        .sort((a, b) => a.ts - b.ts)
        .map((s) => ({
          ts: s.ts,
          time: formatSnapshotTime(s.ts),
          value: Number(formatUsdc(s.value, 6)),
        })),
    // eslint comment not needed; deps cover the inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [growthHistory, growthCutoff]
  );

  const minDeposit = useMinDeposit();

  if (!address) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-slate-400">Connect your wallet to view yield.</p>
      </div>
    );
  }

  const sharesValue =
    vaultShares > 0n
      ? (vaultShares * pricePerShare) / BigInt("1000000000000000000")
      : 0n;
  const projected = projectYield(totalBalance, vaultApy, projDays);
  const projGain = projected > totalBalance ? projected - totalBalance : 0n;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Active vault card */}
      <div className="rounded-2xl border border-slate-700 bg-[#0A0E11]/55 p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Active Vault
            </p>
            <p className="mt-1 text-lg font-semibold text-white">
              {VAULT_1_NAME}
            </p>
          </div>
          <span className="rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-sm font-medium text-green-300">
            {vaultApy > 0n ? formatApy(vaultApy) : VAULT_1_APY_DISPLAY} APY
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-slate-500">Your Shares</p>
            <p className="mt-1 font-mono text-sm tabular-nums text-white">
              {formatShares(vaultShares, vaultShareDecimals, 4)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Share Value</p>
            <p className="mt-1 font-mono text-sm tabular-nums text-green-300">
              {formatUsdcDollar(sharesValue)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Vault TVL</p>
            <p className="mt-1 font-mono text-sm tabular-nums text-white">
              {formatUsdcDollar(vaultTvl)}
            </p>
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
          sub={
            totalBalance > principal
              ? `+${formatUsdc(totalBalance - principal, 4)} yield`
              : "No yield yet"
          }
          accent={totalBalance > principal}
        />
      </div>

      {/* APY calculator */}
      <div className="rounded-xl border border-slate-700 bg-[#0A0E11]/55 p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">
          Yield Projection (Compound)
        </h2>
        <div className="mb-4 flex gap-2">
          {[7, 30, 90, 365].map((d) => (
            <button
              key={d}
              onClick={() => setProjDays(d)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                projDays === d
                  ? "bg-[#083D77] text-white"
                  : "border border-slate-700 text-slate-400 hover:text-slate-200"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500">Projected value</p>
            <p className="mt-1 font-mono text-xl tabular-nums text-green-300">
              {formatUsdcDollar(projected)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Expected gain</p>
            <p className="mt-1 font-mono text-xl tabular-nums text-green-300">
              +{formatUsdc(projGain, 4)}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-600">
          Estimate based on the vault's cached APY; actual returns can change.
        </p>
      </div>

      {/* Strategy selector */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-white">Vault Tiers</h2>
        <div className="space-y-2">
          {/* Vault 1 — active */}
          <div className="flex items-center justify-between rounded-xl border border-slate-700 bg-[#0A0E11]/55 p-4">
            <div>
              <p className="text-sm font-medium text-white">{VAULT_1_NAME}</p>
              <p className="text-xs text-slate-500">
                {VAULT_1_TIER} —{" "}
                {minDeposit === undefined
                  ? "..."
                  : formatUsdcDollar(minDeposit)}{" "}
                min
              </p>
            </div>
            <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-300">
              Active
            </span>
          </div>
          {/* Vaults 2 & 3 — not deployed
          { ["USDC Steady", "USDC Growth"].map((name) => (
            <div
              key={name}
              className="flex items-center justify-between rounded-xl border border-slate-700 bg-[#0A0E11]/55 p-4 opacity-50"
            >
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
                  <Lock className="h-3.5 w-3.5" /> {name}
                </p>
                <p className="text-xs text-slate-600">
                  Not deployed on {ARC_CHAIN.name}
                </p>
              </div>
              <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-600">
                Unavailable
              </span>
            </div>
          ))} */}
        </div>
      </div>

      {/* Portfolio growth chart */}
      <div className="rounded-xl border border-slate-700 bg-[#0A0E11]/55 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">Portfolio Growth</h2>
          <div className="flex gap-1.5">
            {GROWTH_RANGES.map((range, i) => (
              <button
                key={range.label}
                onClick={() => setGrowthRangeIdx(i)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  growthRangeIdx === i
                    ? "bg-[#083D77] text-white"
                    : "border border-slate-700 text-slate-400 hover:text-slate-200"
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
        {chartData.length < 2 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-center">
            <Info className="h-5 w-5 text-slate-600" />
            <p className="text-xs text-slate-500">
              {growthRange.ms === null
                ? "Snapshots accumulate as you use the app. Come back after a few sessions to see your growth chart."
                : `No snapshots in the last ${growthRange.label} yet. Select All to see the full history.`}
            </p>
          </div>
        ) : (
          <div className="portfolio-growth-chart">
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="emeraldGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="time"
                  tick={{ fill: "#64748b", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={32}
                  interval="preserveStartEnd"
                />
                <YAxis hide domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{
                    background: "#0f172a",
                    border: "1px solid #1e293b",
                    borderRadius: "8px",
                    color: "#e2e8f0",
                    fontSize: "12px",
                  }}
                  cursor={{ stroke: "#334155", strokeWidth: 1 }}
                  labelFormatter={(label) =>
                    typeof label === "string" || typeof label === "number"
                      ? String(label)
                      : ""
                  }
                  formatter={(v: unknown) => [
                    `$${Number(v).toFixed(2)}`,
                    "Balance",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#emeraldGrad)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
