/**
 * Chunked event-log fetcher for AgentTreasury activity.
 * Scans backwards from latest in <=9,000-block chunks to tolerate RPC limits.
 */
import { createPublicClient, http, parseAbiItem, type Log, type AbiEvent } from 'viem'
import { arcTestnet } from 'viem/chains'
import { ARC_TESTNET_RPC, ADDRESSES } from './contracts'

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
  maxBlocks = 90_000n,
): Promise<ActivityEvent[]> {
  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(ARC_TESTNET_RPC),
  })

  let toBlock: bigint
  try {
    toBlock = await client.getBlockNumber()
  } catch {
    return []
  }

  const fromBlock = toBlock > maxBlocks ? toBlock - maxBlocks : 0n
  const events: ActivityEvent[] = []

  // Scan backwards in CHUNK-sized windows
  let end = toBlock
  while (end >= fromBlock) {
    const start = end > CHUNK ? end - CHUNK : fromBlock

    await Promise.allSettled(
      Object.entries(EVENTS).map(async ([type, abi]) => {
        try {
          const logs = await client.getLogs({
            address: ADDRESSES.treasury,
            event: abi,
            fromBlock: start,
            toBlock: end,
          })
          for (const log of logs) {
            const ev = toActivityEvent(type as ActivityEventType, log)
            // Filter by agent if provided
            if (agentAddress) {
              const agentArg = (ev.args as { agent?: string }).agent
              if (agentArg && agentArg.toLowerCase() !== agentAddress.toLowerCase()) continue
            }
            events.push(ev)
          }
        } catch {
          // RPC limit hit on this chunk — skip silently
        }
      })
    )

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
