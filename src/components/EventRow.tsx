/**
 * Unified activity row UI. Treasury chain events (EventRow) and client-side
 * pending CCTP transfers (pendingRowData in PendingCctpRow.tsx) both render
 * through ActivityRow so the Activity table looks uniform.
 */
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { clsx } from 'clsx'
import type { ActivityEvent, ActivityEventType } from '../lib/activity'
import { explorerTx } from '../lib/contracts'
import { formatUsdcDollar } from '../lib/decimals'
import { getCctpDestination } from '../lib/cctp'

type BadgeClass = Record<ActivityEventType, string>

export const TYPE_COLORS: BadgeClass = {
  DepositRecorded:      'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  WithdrawalToWallet:   'bg-blue-500/15 text-blue-400 border-blue-500/20',
  WithdrawalRequested:  'bg-purple-500/15 text-purple-400 border-purple-500/20',
  WithdrawalExecuted:   'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  WithdrawalCancelled:  'bg-red-500/15 text-red-400 border-red-500/20',
  YieldStrategyChanged: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
  Rebalanced:           'bg-slate-500/15 text-slate-400 border-slate-500/20',
  YieldClaimed:         'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  SpendingLimitSet:     'bg-slate-500/15 text-slate-400 border-slate-500/20',
}

export const TYPE_LABELS: BadgeClass = {
  DepositRecorded:      'Deposit',
  WithdrawalToWallet:   'Local Withdraw',
  WithdrawalRequested:  'CCTP Withdrawal',
  WithdrawalExecuted:   'Withdrawal Executed',
  WithdrawalCancelled:  'Withdrawal Cancelled',
  YieldStrategyChanged: 'Strategy',
  Rebalanced:           'Rebalance',
  YieldClaimed:         'Yield',
  SpendingLimitSet:     'Limit Set',
}

// Safe helpers — event args come back as Record<string, unknown> from viem
function argBigInt(a: Record<string, unknown>, key: string): bigint {
  const v = a[key]
  if (typeof v === 'bigint') return v
  if (typeof v === 'number' || typeof v === 'string') return BigInt(v)
  return 0n
}
function argStr(a: Record<string, unknown>, key: string): string {
  const v = a[key]
  if (typeof v === 'bigint' || typeof v === 'number') return String(v)
  if (typeof v === 'string') return v
  return ''
}

function describeEvent(e: ActivityEvent): string {
  const a = e.args
  switch (e.type) {
    case 'DepositRecorded': {
      const domain = Number(argStr(a, 'sourceDomain') || 0)
      const source = domain > 0 ? getCctpDestination(domain) : undefined
      return `${formatUsdcDollar(argBigInt(a, 'amount'))} deposited${source ? ` from ${source.name}` : ''}`
    }
    case 'WithdrawalToWallet':
      return `${formatUsdcDollar(argBigInt(a, 'amount'))} withdrawn to wallet`
    case 'WithdrawalRequested': {
      const domain = Number(argStr(a, 'destinationDomain'))
      const destination = Number.isFinite(domain) ? getCctpDestination(domain) : undefined
      const to = destination?.name ?? `domain ${domain}`
      return `${formatUsdcDollar(argBigInt(a, 'amount'))} burned via CCTP to ${to}`
    }
    case 'WithdrawalExecuted':   return `Withdrawal #${argStr(a, 'id')} executed`
    case 'WithdrawalCancelled':  return `Withdrawal #${argStr(a, 'id')} cancelled`
    case 'YieldStrategyChanged': return `Strategy \u2192 vault ${argStr(a, 'newVaultId')}`
    case 'Rebalanced':           return `Rebalanced vault ${argStr(a, 'vaultId')}`
    case 'YieldClaimed':         return `${formatUsdcDollar(argBigInt(a, 'amount'))} yield claimed`
    case 'SpendingLimitSet':     return `Daily ${formatUsdcDollar(argBigInt(a, 'dailyLimit'))}`
    default:                     return e.type
  }
}

export interface ActivityLink {
  href: string
  label: string
  className?: string
}

export interface ActivityRowAction {
  label: string
  onClick: () => void
}

export interface ActivityRowData {
  badgeLabel: string
  badgeClass: string
  title: string
  /** Left half of the expanded header (block number or timestamp). */
  meta?: string
  /** Explorer tx links shown in the expanded header. */
  links?: ActivityLink[]
  /** Extra human-readable lines inside the expanded panel. */
  description?: string
  /** Pretty-printed raw event args (chain rows only). */
  preJson?: string
  /** Optional right-side CTA (e.g. Resume) on the collapsed line. */
  action?: ActivityRowAction
}

/** Map a treasury chain event onto the shared row shape. */
export function eventRowData(e: ActivityEvent): ActivityRowData {
  const prettyArgs = JSON.stringify(
    Object.fromEntries(
      Object.entries(e.args).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]),
    ),
    null,
    2,
  )
  return {
    badgeLabel: TYPE_LABELS[e.type] ?? e.type,
    badgeClass: TYPE_COLORS[e.type] ?? 'bg-slate-700 text-slate-400 border-slate-700',
    title: describeEvent(e),
    meta: `Block ${e.blockNumber.toString()}`,
    links: e.txHash
      ? [{
          href: explorerTx(e.txHash),
          label: `${e.txHash.slice(0, 10)}…${e.txHash.slice(-6)}`,
          className: 'text-emerald-400 hover:text-emerald-300',
        }]
      : [],
    preJson: prettyArgs,
  }
}

export function ActivityRow({ data, compact }: { data: ActivityRowData; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const expandable = Boolean(data.meta || (data.links && data.links.length > 0) || data.preJson)

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className={clsx(
          'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
          data.badgeClass,
        )}>
          {data.badgeLabel}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-slate-300">{data.title}</span>
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
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            )}
          </div>
        )}
      </div>
      {expanded && expandable && (
        <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {data.meta && <span className="font-mono text-slate-500">{data.meta}</span>}
            <div className="flex flex-wrap items-center gap-3">
              {data.links?.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={clsx('flex items-center gap-1 font-mono', link.className ?? 'text-emerald-400 hover:text-emerald-300')}
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
          {data.description && (
            <p className="mt-2 leading-relaxed text-slate-400">{data.description}</p>
          )}
          {data.preJson && <pre className="mt-2 overflow-x-auto text-slate-500">{data.preJson}</pre>}
        </div>
      )}
    </div>
  )
}

interface Props {
  event: ActivityEvent
  compact?: boolean
}

export function EventRow({ event, compact }: Props) {
  return <ActivityRow data={eventRowData(event)} compact={compact} />
}
