/**
 * Unified activity row UI. Treasury chain events (EventRow) and client-side
 * pending CCTP transfers (pendingRowData in PendingCctpRow.tsx) both render
 * through ActivityRow so the Activity table looks uniform.
 */
import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { clsx } from "clsx";
import type { ActivityEvent, ActivityEventType } from "../lib/activity";
import { explorerTx } from "../lib/contracts";
import { formatUsdcDollar } from "../lib/decimals";
import { getCctpDestination, type CctpWithdrawalStatus } from "../lib/cctp";

type BadgeClass = Record<ActivityEventType, string>;

/** Date + time for expanded rows; events without an enriched time omit it. */
function formatEventTime(event: ActivityEvent): string {
  if (typeof event.timestamp !== "number" || event.timestamp <= 0) return "";
  return new Date(event.timestamp * 1000).toLocaleString();
}

export const TYPE_COLORS: BadgeClass = {
  DepositRecorded: "bg-green-500/15 text-green-300 border-green-500/25",
  WithdrawalToWallet: "bg-blue-500/15 text-blue-300 border-blue-500/25",
  WithdrawalRequested: "bg-purple-500/15 text-purple-300 border-purple-500/25",
  WithdrawalExecuted: "bg-sky-500/15 text-sky-300 border-sky-500/25",
  WithdrawalCancelled: "bg-red-500/15 text-red-300 border-red-500/25",
  YieldStrategyChanged: "bg-purple-500/15 text-purple-300 border-purple-500/25",
  Rebalanced: "bg-slate-500/15 text-slate-200 border-slate-500/25",
  YieldClaimed: "bg-[#083D77]/15 text-emerald-300 border-emerald-500/25",
  SpendingLimitSet: "bg-slate-500/15 text-slate-200 border-slate-500/25",
};

export const TYPE_LABELS: BadgeClass = {
  DepositRecorded: "Deposit",
  WithdrawalToWallet: "Local Withdraw",
  WithdrawalRequested: "CCTP Withdrawal",
  WithdrawalExecuted: "Withdrawal Executed",
  WithdrawalCancelled: "Withdrawal Cancelled",
  YieldStrategyChanged: "Strategy",
  Rebalanced: "Rebalance",
  YieldClaimed: "Yield",
  SpendingLimitSet: "Limit Set",
};

// Safe helpers — event args come back as Record<string, unknown> from viem
function argBigInt(a: Record<string, unknown>, key: string): bigint {
  const v = a[key];
  if (typeof v === "bigint") return v;
  if (typeof v === "number" || typeof v === "string") return BigInt(v);
  return 0n;
}
function argStr(a: Record<string, unknown>, key: string): string {
  const v = a[key];
  if (typeof v === "bigint" || typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  return "";
}

function describeEvent(
  e: ActivityEvent,
  cctpStatus?: CctpWithdrawalStatus
): string {
  const a = e.args;
  switch (e.type) {
    case "DepositRecorded": {
      const domain = Number(argStr(a, "sourceDomain") || 0);
      const source = domain > 0 ? getCctpDestination(domain) : undefined;
      return `${formatUsdcDollar(argBigInt(a, "amount"))} deposited${
        source ? ` from ${source.name}` : ""
      }`;
    }
    case "WithdrawalToWallet":
      return `${formatUsdcDollar(argBigInt(a, "amount"))} withdrawn to wallet`;
    case "WithdrawalRequested": {
      const domain =
        cctpStatus?.destinationDomain || Number(argStr(a, "destinationDomain"));
      const destination = Number.isFinite(domain)
        ? getCctpDestination(domain)
        : undefined;
      const to = destination?.name ?? `domain ${domain}`;
      const suffix = cctpStatus
        ? ` · ${CCTP_PHASE_LABEL[cctpStatus.phase]}`
        : "";
      return `${formatUsdcDollar(
        argBigInt(a, "amount")
      )} burned via CCTP to ${to}${suffix}`;
    }
    case "WithdrawalExecuted":
      return `Withdrawal #${argStr(a, "id")} executed`;
    case "WithdrawalCancelled":
      return `Withdrawal #${argStr(a, "id")} cancelled`;
    case "YieldStrategyChanged":
      return `Strategy \u2192 vault ${argStr(a, "newVaultId")}`;
    case "Rebalanced":
      return `Rebalanced vault ${argStr(a, "vaultId")}`;
    case "YieldClaimed":
      return `${formatUsdcDollar(argBigInt(a, "amount"))} yield claimed`;
    case "SpendingLimitSet":
      return `Daily ${formatUsdcDollar(argBigInt(a, "dailyLimit"))}`;
    default:
      return e.type;
  }
}

const CCTP_PHASE_LABEL: Record<CctpWithdrawalStatus["phase"], string> = {
  waiting: "Waiting for Circle",
  ready: "Attested — mint pending",
  done: "Minted",
  error: "Status unavailable",
};

function cctpDescription(status: CctpWithdrawalStatus): string {
  const destination = getCctpDestination(status.destinationDomain);
  const name = destination?.name ?? `domain ${status.destinationDomain}`;
  switch (status.phase) {
    case "waiting":
      return "Circle is attesting the Arc burn. The destination mint starts after the attestation is complete.";
    case "ready":
      return `Circle's attestation is complete. The mint on ${name} has not been indexed by the destination RPC yet.`;
    case "done":
      if (status.mintTxHash) return `Minted on ${name}.`;
      return `Delivered on ${name}; the destination RPC did not return the mint transaction hash yet.`;
    case "error":
      return status.error ?? "The destination status could not be checked.";
  }
}

export interface ActivityLink {
  href: string;
  label: string;
  className?: string;
}

export interface ActivityRowAction {
  label: string;
  onClick: () => void;
}

export interface ActivityRowData {
  badgeLabel: string;
  badgeClass: string;
  title: string;
  /** Left half of the expanded header (block number or timestamp). */
  meta?: string;
  /** Explorer tx links shown in the expanded header. */
  links?: ActivityLink[];
  /** Extra human-readable lines inside the expanded panel. */
  description?: string;
  /** Pretty-printed raw event args (chain rows only). */
  preJson?: string;
  /** Optional right-side CTA (e.g. Resume) on the collapsed line. */
  action?: ActivityRowAction;
}

/** What to call the tx on an explorer link, per kind of activity. */
const TX_LINK_LABEL: Record<ActivityEventType, string> = {
  DepositRecorded: "Deposit tx",
  WithdrawalToWallet: "Withdraw tx",
  WithdrawalRequested: "Burn tx",
  WithdrawalExecuted: "Execute tx",
  WithdrawalCancelled: "Cancel tx",
  YieldStrategyChanged: "Strategy tx",
  Rebalanced: "Rebalance tx",
  YieldClaimed: "Claim tx",
  SpendingLimitSet: "Limits tx",
};

/** Map a treasury chain event onto the shared row shape. */
export function eventRowData(
  e: ActivityEvent,
  options: {
    cctpStatus?: CctpWithdrawalStatus;
    cctpCompleted?: boolean;
    onResume?: () => void;
  } = {}
): ActivityRowData {
  const { cctpStatus, cctpCompleted, onResume } = options;
  const clock = formatEventTime(e);
  const prettyArgs = JSON.stringify(
    Object.fromEntries(
      Object.entries(e.args).map(([k, v]) => [
        k,
        typeof v === "bigint" ? v.toString() : v,
      ])
    ),
    null,
    2
  );

  const links: ActivityLink[] = e.txHash
    ? [
        {
          href: explorerTx(e.txHash),
          label: TX_LINK_LABEL[e.type] ?? "View tx",
          className: "text-slate-500",
        },
      ]
    : [];

  // Outbound CCTP: add the destination mint link discovered from
  // usedNonces + MessageReceived, not from AgentTreasury's legacy flags.
  if (e.type === "WithdrawalRequested" && cctpStatus?.mintTxHash) {
    const destination = getCctpDestination(cctpStatus.destinationDomain);
    links.push({
      href: destination
        ? `${destination.explorer}/tx/${cctpStatus.mintTxHash}`
        : explorerTx(cctpStatus.mintTxHash),
      label: "Mint tx",
      className: "text-blue-400 hover:text-blue-300",
    });
  }

  // No Resume until either the off-chain status or the persisted transfer
  // history gives us a real answer. Otherwise a completed withdrawal briefly
  // renders Resume while Iris/destination RPC is still being checked.
  const statusKnown = cctpStatus !== undefined || cctpCompleted !== undefined;
  const completed = cctpStatus?.phase === "done" || cctpCompleted === true;
  const action =
    e.type === "WithdrawalRequested" && onResume && statusKnown && !completed
      ? { label: "Resume", onClick: onResume }
      : undefined;

  return {
    badgeLabel: TYPE_LABELS[e.type] ?? e.type,
    badgeClass:
      TYPE_COLORS[e.type] ?? "bg-slate-700 text-slate-400 border-slate-700",
    title: describeEvent(e, cctpStatus),
    meta: clock
      ? `Block ${e.blockNumber.toString()} · ${clock}`
      : `Block ${e.blockNumber.toString()}`,
    links,
    description:
      e.type === "WithdrawalRequested" && cctpStatus
        ? cctpDescription(cctpStatus)
        : undefined,
    preJson: prettyArgs,
    action,
  };
}

export function ActivityRow({
  data,
  compact,
}: {
  data: ActivityRowData;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const expandable = Boolean(
    data.meta || (data.links && data.links.length > 0) || data.preJson
  );

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span
          className={clsx(
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            data.badgeClass
          )}
        >
          {data.badgeLabel}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-slate-300">
          {data.title}
        </span>
        {!compact && (
          <div className="flex shrink-0 items-center gap-2">
            {data.action && (
              <button
                onClick={data.action.onClick}
                className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:border-emerald-500/40 hover:text-emerald-400"
              >
                {data.action.label}
              </button>
            )}
            {expandable && (
              <button
                onClick={() => setExpanded((x) => !x)}
                className="text-slate-600 hover:text-slate-400"
              >
                {expanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        )}
      </div>
      {expanded && expandable && (
        <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {data.meta && (
              <span className="font-mono text-slate-500">{data.meta}</span>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {data.links?.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={clsx(
                    "flex items-center gap-1 font-medium",
                    link.className ?? "text-emerald-400 hover:text-emerald-300"
                  )}
                >
                  {link.label} <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          </div>
          {data.description && (
            <p className="mt-2 leading-relaxed text-slate-400">
              {data.description}
            </p>
          )}
          {data.preJson && (
            <pre className="mt-2 overflow-x-auto text-slate-500">
              {data.preJson}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  event: ActivityEvent;
  compact?: boolean;
  cctpStatus?: CctpWithdrawalStatus;
  /** Persisted history knows the transfer is done before the status query loads. */
  cctpCompleted?: boolean;
  onResume?: () => void;
}

export function EventRow({
  event,
  compact,
  cctpStatus,
  cctpCompleted,
  onResume,
}: Props) {
  return (
    <ActivityRow
      data={eventRowData(event, { cctpStatus, cctpCompleted, onResume })}
      compact={compact}
    />
  );
}
