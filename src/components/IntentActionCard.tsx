import { ArrowRight, ExternalLink, Sparkles } from "lucide-react";
import { formatUsdc } from "../lib/decimals";
import { getCctpDestination } from "../lib/cctp";
import type { HermesIntent } from "../lib/hermes";

function amountLabel(intent: HermesIntent): string {
  const formatted = formatUsdc(BigInt(intent.amount), 6).replace(/\.?0+$/, "");
  return `${formatted || "0"} USDC`;
}

export function IntentActionCard({
  intent,
  onReview,
  onActivity,
}: {
  intent: HermesIntent;
  onReview: (intent: HermesIntent) => void;
  onActivity: () => void;
}) {
  const destination =
    intent.destinationDomain === null
      ? null
      : getCctpDestination(intent.destinationDomain);
  const reviewLabel =
    intent.kind === "deposit" ? "Review deposit" : "Review withdrawal";

  return (
    <div className="mt-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-200">
        <Sparkles className="h-3 w-3" />
        Unsigned draft
      </div>
      <p className="mt-1.5 font-mono text-sm tabular-nums text-white">
        {intent.isMax ? "All available · " : ""}
        {amountLabel(intent)}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-400">
        {intent.kind === "deposit"
          ? "Deposit into the Arc treasury vault"
          : intent.kind === "withdrawLocal"
          ? "Withdraw to your connected Arc wallet"
          : `Bridge from Arc to ${
              destination?.name ?? `domain ${intent.destinationDomain}`
            }`}
      </p>
      {intent.simulation.warning === "approval_required" && (
        <p className="mt-2 text-[10px] leading-relaxed text-amber-300">
          A one-time USDC approval is required first.
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onReview(intent)}
          className="glimmer-primary-cta inline-flex items-center gap-1"
        >
          {reviewLabel}
          <ArrowRight className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onActivity}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-200"
        >
          Activity
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
