/**
 * Chunked event-log fetcher for AgentTreasury activity.
 * Scans backwards from latest in <=9,000-block chunks to tolerate RPC limits.
 */
import { createPublicClient, fallback, http, parseAbiItem, type Log, type AbiEvent } from 'viem'
import { ARC_CHAIN, ARC_RPC_URLS, ARC_TREASURY_DEPLOY_BLOCK, ADDRESSES } from './contracts'

export type ActivityEventType =
  | 'DepositRecorded'
  | 'WithdrawalToWallet'
  | 'WithdrawalRequested'
  | 'WithdrawalExecuted'
  | 'WithdrawalCancelled'
  | 'YieldStrategyChanged'
  | 'Rebalanced'
  | 'YieldClaimed'
  | 'SpendingLimitSet'

export interface ActivityEvent {
  id: string           // `${txHash}-${logIndex}`
  type: ActivityEventType
  blockNumber: bigint
  txHash: string
  logIndex: number
  timestamp?: number   // block time in SECONDS (enriched; interpolated if an RPC hiccup)
  args: Record<string, unknown>
}

// Arc's public RPC rejects eth_getLogs ranges of 10k+ blocks; 9k is the
// largest range that works reliably.
const CHUNK = 9_000n

// Event signatures
const EVENTS: Record<ActivityEventType, AbiEvent> = {
  DepositRecorded:     parseAbiItem('event DepositRecorded(address indexed agent, uint256 amount, uint32 indexed sourceDomain, uint256 vaultId, uint256 shares)'),
  WithdrawalToWallet:  parseAbiItem('event WithdrawalToWallet(address indexed agent, uint256 amount, uint256 sharesBurned)'),
  WithdrawalRequested: parseAbiItem('event WithdrawalRequested(uint256 indexed id, address indexed agent, uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, bytes32 messageHash)'),
  WithdrawalExecuted:  parseAbiItem('event WithdrawalExecuted(uint256 indexed id, address indexed agent)'),
  WithdrawalCancelled: parseAbiItem('event WithdrawalCancelled(uint256 indexed id, address indexed agent)'),
  YieldStrategyChanged:parseAbiItem('event YieldStrategyChanged(address indexed agent, uint256 oldVaultId, uint256 indexed newVaultId)'),
  Rebalanced:          parseAbiItem('event Rebalanced(address indexed agent, uint256 indexed vaultId, uint256 shares)'),
  YieldClaimed:        parseAbiItem('event YieldClaimed(address indexed agent, uint256 amount)'),
  SpendingLimitSet:    parseAbiItem('event SpendingLimitSet(address indexed agent, uint256 dailyLimit, uint256 weeklyLimit)'),
}

const ALL_EVENTS = Object.values(EVENTS)
const EVENT_TYPES = new Set(Object.keys(EVENTS))

function toActivityEvent(type: ActivityEventType, log: Log): ActivityEvent {
  return {
    id: `${log.transactionHash}-${log.logIndex}`,
    type,
    blockNumber: log.blockNumber ?? 0n,
    txHash: log.transactionHash ?? '',
    logIndex: log.logIndex ?? 0,
    args: (log as { args?: Record<string, unknown> }).args ?? {},
  }
}

// Block timestamp enrichment, cached across refreshes (chain-wide cache grows
// one entry per event block, not per scan).
const blockTimeCache = new Map<bigint, number>()
const BLOCK_BATCH = 8

/** Linear interpolation between the nearest enriched blocks. */
function estimateBlockTime(block: bigint, anchors: [bigint, number][]): number {
  if (anchors.length === 0) return 0
  let low: [bigint, number] | undefined
  let high: [bigint, number] | undefined
  for (const anchor of anchors) {
    if (anchor[0] < block) low = anchor
    if (anchor[0] > block && !high) high = anchor
  }
  if (!low) return anchors[0][1]
  if (!high) return low[1]
  const blockDiff = Number(high[0] - low[0])
  if (blockDiff <= 0) return low[1]
  const ratio = Number(block - low[0]) / blockDiff
  return Math.round(low[1] + ratio * (high[1] - low[1]))
}

async function enrichWithBlockTimes(
  client: ReturnType<typeof createPublicClient>,
  events: ActivityEvent[],
): Promise<void> {
  const missing = [...new Set(
    events
      .filter((e) => e.blockNumber > 0n && !blockTimeCache.has(e.blockNumber))
      .map((e) => e.blockNumber),
  )]

  // Small sequential batches to stay friendly to the public RPC.
  for (let i = 0; i < missing.length; i += BLOCK_BATCH) {
    const slice = missing.slice(i, i + BLOCK_BATCH)
    const results = await Promise.allSettled(
      slice.map((block) => client.getBlock({ blockNumber: block })),
    )
    results.forEach((result, j) => {
      if (result.status === 'fulfilled') {
        blockTimeCache.set(slice[j], Number(result.value.timestamp))
      }
    })
  }

  const anchors: [bigint, number][] = [...blockTimeCache.entries()]
    .filter(([block]) => events.some((e) => e.blockNumber === block))
    .sort((a, b) => (a[0] > b[0] ? 1 : a[0] < b[0] ? -1 : 0))

  for (const event of events) {
    if (event.blockNumber === 0n) continue
    const exact = blockTimeCache.get(event.blockNumber)
    event.timestamp = exact ?? estimateBlockTime(event.blockNumber, anchors)
  }
}

export async function fetchActivityEvents(
  agentAddress?: string,
  fromBlock = ARC_TREASURY_DEPLOY_BLOCK,
): Promise<ActivityEvent[]> {
  const client = createPublicClient({
    chain: ARC_CHAIN,
    transport: fallback(ARC_RPC_URLS.map((url) => http(url))),
  })

  let toBlock: bigint
  try {
    toBlock = await client.getBlockNumber()
  } catch {
    return []
  }

  if (toBlock < fromBlock) return []

  const events: ActivityEvent[] = []

  // Scan backwards in CHUNK-sized windows. One getLogs request per window
  // (all nine event signatures) instead of nine parallel requests keeps us
  // under the public RPC's request-rate limit.
  let end = toBlock
  while (end >= fromBlock) {
    const start = end >= fromBlock + CHUNK - 1n ? end - CHUNK + 1n : fromBlock

    try {
      const logs = await client.getLogs({
        address: ADDRESSES.treasury,
        events: ALL_EVENTS,
        fromBlock: start,
        toBlock: end,
      })

      for (const log of logs) {
        const type = log.eventName
        if (!type || !EVENT_TYPES.has(type)) continue

        const ev = toActivityEvent(type as ActivityEventType, log)
        if (agentAddress) {
          const agentArg = (ev.args as { agent?: string }).agent
          if (agentArg && agentArg.toLowerCase() !== agentAddress.toLowerCase()) continue
        }
        events.push(ev)
      }
    } catch {
      // RPC limit hit on this chunk — skip it and keep the rest.
    }

    if (start === fromBlock) break
    end = start - 1n
  }

  // Add block timestamps (cached; interpolated across the nearest blocks on
  // RPC hiccups) so the Activity tab can sort by real date/time.
  try {
    await enrichWithBlockTimes(client, events)
  } catch {
    // Timestamps stay undefined; the UI falls back to block ordering.
  }

  // Sort newest first
  return events.sort((a, b) =>
    a.blockNumber > b.blockNumber ? -1 : a.blockNumber < b.blockNumber ? 1 : b.logIndex - a.logIndex
  )
}

export function exportCsv(events: ActivityEvent[]): string {
  const header = 'type,blockNumber,txHash,logIndex,args'
  const rows = events.map(e =>
    `${e.type},${e.blockNumber},${e.txHash},${e.logIndex},"${JSON.stringify(e.args).replace(/"/g, '""')}"`
  )
  return [header, ...rows].join('\n')
}
