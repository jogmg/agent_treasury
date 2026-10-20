import { useState } from 'react'
import { ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import { clsx } from 'clsx'
import type { ActivityEvent, ActivityEventType } from '../lib/activity'
import { explorerTx } from '../lib/contracts'
import { formatUsdcDollar } from '../lib/decimals'

const TYPE_COLORS: Record<ActivityEventType, string> = {
  DepositRecorded:      'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  WithdrawalToWallet:   'bg-blue-500/15 text-blue-400 border-blue-500/20',
  WithdrawalRequested:  'bg-amber-500/15 text-amber-400 border-amber-500/20',
  WithdrawalExecuted:   'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  WithdrawalCancelled:  'bg-red-500/15 text-red-400 border-red-500/20',
  YieldStrategyChanged: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
  Rebalanced:           'bg-slate-500/15 text-slate-400 border-slate-500/20',
  YieldClaimed:         'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  SpendingLimitSet:     'bg-slate-500/15 text-slate-400 border-slate-500/20',
}

const TYPE_LABELS: Record<ActivityEventType, string> = {
  DepositRecorded:      'Deposit',
  WithdrawalToWallet:   'Withdraw',
  WithdrawalRequested:  'CCTP Request',
  WithdrawalExecuted:   'Executed',
  WithdrawalCancelled:  'Cancelled',
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
    case 'DepositRecorded':      return `${formatUsdcDollar(argBigInt(a, 'amount'))} deposited`
    case 'WithdrawalToWallet':   return `${formatUsdcDollar(argBigInt(a, 'amount'))} withdrawn to wallet`
    case 'WithdrawalRequested':  return `${formatUsdcDollar(argBigInt(a, 'amount'))} CCTP request #${argStr(a, 'id')}`
    case 'WithdrawalExecuted':   return `Withdrawal #${argStr(a, 'id')} executed`
    case 'WithdrawalCancelled':  return `Withdrawal #${argStr(a, 'id')} cancelled`
    case 'YieldStrategyChanged': return `Strategy \u2192 vault ${argStr(a, 'newVaultId')}`
    case 'Rebalanced':           return `Rebalanced vault ${argStr(a, 'vaultId')}`
    case 'YieldClaimed':         return `${formatUsdcDollar(argBigInt(a, 'amount'))} yield claimed`
    case 'SpendingLimitSet':     return `Daily ${formatUsdcDollar(argBigInt(a, 'dailyLimit'))}`
    default:                     return e.type
  }
}

interface Props {
  event: ActivityEvent
  compact?: boolean
}

export function EventRow({ event: e, compact }: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className={clsx(
          'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
          TYPE_COLORS[e.type] ?? 'bg-slate-700 text-slate-400',
        )}>
          {TYPE_LABELS[e.type] ?? e.type}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-slate-300">{describeEvent(e)}</span>
        {!compact && (
          <button
            onClick={() => setExpanded((x) => !x)}
            className="shrink-0 text-slate-600 hover:text-slate-400"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>
      {expanded && (
        <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-slate-500">Block {e.blockNumber.toString()}</span>
            {e.txHash && (
              <a
                href={explorerTx(e.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 font-mono text-emerald-400 hover:text-emerald-300"
              >
                {e.txHash.slice(0, 10)}…{e.txHash.slice(-6)}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <pre className="mt-2 overflow-x-auto text-slate-500">
            {JSON.stringify(
              Object.fromEntries(
                Object.entries(e.args).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])
              ),
              null,
              2,
            )}
          </pre>
        </div>
      )}
    </div>
  )
}
