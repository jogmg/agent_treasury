import { Layers, TrendingUp, Zap } from "lucide-react";
import { useAccount } from "wagmi";
import { ARC_CHAIN, VAULT_1_NAME } from "../../lib/contracts";
import { formatApy, formatShares, formatUsdcDollar } from "../../lib/decimals";
import { useTreasuryStore } from "../../stores/treasury";
import { useUiStore } from "../../stores/ui";
import { EventRow } from "../EventRow";
import { StatCard } from "../StatCard";
import { ArcMark } from "../ArcMark";

export function OverviewTab() {
  const { address } = useAccount();
  const {
    totalBalance,
    principal,
    vaultShares,
    vaultApy,
    pricePerShare,
    vaultShareDecimals,
    isFetching,
  } = useTreasuryStore();
  const { activityEvents, setTab } = useUiStore();

  const accrued = totalBalance > principal ? totalBalance - principal : 0n;
  const recentEvents = activityEvents.slice(0, 5);

  // pricePerShare is 1e18-scaled: value of vaultShares in USDC-6
  // shares are in vault native units; use pricePerShare for display
  const sharesValueRaw =
    vaultShares > 0n
      ? (vaultShares * pricePerShare) / BigInt("1000000000000000000")
      : 0n;

  if (!address) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <Layers className="h-10 w-10 text-slate-600" />
        <p className="text-slate-400">
          Connect your wallet to view your treasury.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero balance */}
      <div className="rounded-2xl border border-slate-700 bg-[#0A0E11]/55 p-6">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
          Total Value
        </p>
        <p className="mt-2 font-mono text-4xl font-bold tabular-nums text-white">
          {isFetching && totalBalance === 0n
            ? "—"
            : formatUsdcDollar(totalBalance)}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
          <ArcMark size={14} />
          {ARC_CHAIN.name}
        </p>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Principal"
          value={formatUsdcDollar(principal)}
          sub="Deposited total"
          icon={<Layers className="h-4 w-4" />}
        />
        <StatCard
          label="Yield Earned"
          value={formatUsdcDollar(accrued)}
          sub="Accrued since deposit"
          accent={accrued > 0n}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="APY"
          value={vaultApy > 0n ? formatApy(vaultApy) : "—"}
          sub={VAULT_1_NAME}
          icon={<Zap className="h-4 w-4" />}
        />
        <StatCard
          label="Vault Shares"
          value={formatShares(vaultShares, vaultShareDecimals, 4)}
          sub={`≈ ${formatUsdcDollar(sharesValueRaw)} USDC`}
        />
      </div>

      {/* Recent activity */}
      {recentEvents.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Recent Activity
            </h2>
            <button
              onClick={() => setTab("activity")}
              className="rounded-full px-3 py-1.5 font-medium tracking-wide text-white text-xs bg-emerald-500 hover:bg-emerald-500/80 transition"
            >
              View all
            </button>
          </div>
          <div className="divide-y divide-slate-800 rounded-xl border border-slate-700 bg-slate-900/60">
            {recentEvents.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
