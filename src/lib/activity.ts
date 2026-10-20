/**
 * Chunked event-log fetcher for AgentTreasury activity.
 * Scans backwards from latest in <=9,000-block chunks to tolerate RPC limits.
 */
import { createPublicClient, fallback, http, parseAbiItem, type Log, type AbiEvent } from 'viem'
import { arcTestnet } from 'viem/chains'
import { ARC_RPC_URLS, ARC_TREASURY_DEPLOY_BLOCK, ADDRESSES } from './contracts'

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
  timestamp?: number   // filled in by enrichment pass when available
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

export async function fetchActivityEvents(
  agentAddress?: string,
  fromBlock = ARC_TREASURY_DEPLOY_BLOCK,
): Promise<ActivityEvent[]> {
  const client = createPublicClient({
    chain: arcTestnet,
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
