import type { AbiEvent, Log } from 'viem'
import {
  ACTIVITY_EVENTS,
  ACTIVITY_EVENT_TYPES,
  type ActivityEventType,
} from './abis'
import { createArcClient } from './arc'
import type { HermesConfig } from './config'
import { json, type DbPool } from './db'

const CHUNK = 9_000n

export interface ActivityEvent {
  id: string
  type: ActivityEventType
  blockNumber: string
  txHash: string
  logIndex: number
  agent?: string
  timestamp?: string
  args: Record<string, unknown>
}

function toActivityEvent(type: ActivityEventType, log: Log): ActivityEvent {
  const args = ((log as { args?: Record<string, unknown> }).args ?? {}) as Record<
    string,
    unknown
  >
  const agent = typeof args.agent === 'string' ? args.agent : undefined
  return {
    id: `${log.transactionHash}-${log.logIndex}`,
    type,
    blockNumber: (log.blockNumber ?? 0n).toString(),
    txHash: log.transactionHash ?? '',
    logIndex: Number(log.logIndex ?? 0),
    agent,
    args,
  }
}

async function enrichTimes(
  client: ReturnType<typeof createArcClient>,
  events: ActivityEvent[],
): Promise<void> {
  const blocks = [...new Set(events.map((event) => event.blockNumber))]
  const times = new Map<string, string>()

  for (let index = 0; index < blocks.length; index += 8) {
    const slice = blocks.slice(index, index + 8)
    const results = await Promise.allSettled(
      slice.map((block) => client.getBlock({ blockNumber: BigInt(block) })),
    )
    results.forEach((result, resultIndex) => {
      if (result.status === 'fulfilled') {
        times.set(slice[resultIndex], new Date(Number(result.value.timestamp) * 1000).toISOString())
      }
    })
  }

  for (const event of events) {
    event.timestamp = times.get(event.blockNumber)
  }
}

export async function fetchActivityWindow(
  config: HermesConfig,
  fromBlock: bigint,
  toBlock: bigint,
  agent?: string,
): Promise<ActivityEvent[]> {
  if (toBlock < fromBlock) return []
  const client = createArcClient(config)
  const events: ActivityEvent[] = []

  let end = toBlock
  while (end >= fromBlock) {
    const start = end >= fromBlock + CHUNK - 1n ? end - CHUNK + 1n : fromBlock
    try {
      const logs = await client.getLogs({
        address: config.network.addresses.treasury,
        events: ACTIVITY_EVENTS as unknown as AbiEvent[],
        fromBlock: start,
        toBlock: end,
      })
      for (const log of logs) {
        const type = log.eventName
        if (!type || !ACTIVITY_EVENT_TYPES.has(type)) continue
        const event = toActivityEvent(type as ActivityEventType, log)
        if (agent && event.agent && event.agent.toLowerCase() !== agent.toLowerCase()) {
          continue
        }
        events.push(event)
      }
    } catch {
      // Arc's public RPC rejects large ranges. Skip this chunk and continue;
      // the monitor cursor will retry it on the next run.
    }
    if (start === fromBlock) break
    end = start - 1n
  }

  try {
    await enrichTimes(client, events)
  } catch {
    // Block timestamps are optional; block order remains authoritative.
  }

  return events.sort((a, b) => {
    const blockA = BigInt(a.blockNumber)
    const blockB = BigInt(b.blockNumber)
    if (blockA > blockB) return -1
    if (blockA < blockB) return 1
    return b.logIndex - a.logIndex
  })
}

export interface ScanResult {
  fromBlock: string
  toBlock: string
  latestBlock: string
  inserted: number
  caughtUp: boolean
}

export async function scanActivity(
  pool: DbPool,
  config: HermesConfig,
  maxChunks: number,
): Promise<ScanResult> {
  const client = createArcClient(config)
  const latest = await client.getBlockNumber()

  const cursorRow = await pool.query<{ value: string }>(
    'select value from monitor_cursor where key = $1',
    ['lastIndexedBlock'],
  )
  const cursor = cursorRow.rows[0]?.value
    ? BigInt(cursorRow.rows[0].value)
    : config.network.deployBlock

  if (cursor > latest) {
    return {
      fromBlock: cursor.toString(),
      toBlock: latest.toString(),
      latestBlock: latest.toString(),
      inserted: 0,
      caughtUp: true,
    }
  }

  let inserted = 0
  let current = cursor
  let chunks = 0

  while (current <= latest && chunks < maxChunks) {
    const end = current + CHUNK - 1n > latest ? latest : current + CHUNK - 1n
    let logs: Log[]
    try {
      logs = await client.getLogs({
        address: config.network.addresses.treasury,
        events: ACTIVITY_EVENTS as unknown as AbiEvent[],
        fromBlock: current,
        toBlock: end,
      })
    } catch (error) {
      throw new Error(
        `Arc getLogs failed for blocks ${current}-${end}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    const events: ActivityEvent[] = []
    for (const log of logs) {
      const type = (log as Log & { eventName?: string }).eventName
      if (!type || !ACTIVITY_EVENT_TYPES.has(type)) continue
      events.push(toActivityEvent(type as ActivityEventType, log))
    }
    await enrichTimes(client, events)

    for (const event of events) {
      const result = await pool.query(
        `insert into activity_events
           (id, event_type, block_number, tx_hash, log_index, agent_address, block_timestamp, args)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         on conflict (id) do nothing`,
        [
          event.id,
          event.type,
          event.blockNumber,
          event.txHash,
          event.logIndex,
          event.agent ?? null,
          event.timestamp ?? null,
          json(event.args),
        ],
      )
      inserted += result.rowCount ?? 0
    }

    current = end + 1n
    chunks += 1
    await pool.query(
      `insert into monitor_cursor (key, value, updated_at)
       values ('lastIndexedBlock', $1, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [current.toString()],
    )
  }

  return {
    fromBlock: cursor.toString(),
    toBlock: current > latest ? latest.toString() : (current - 1n).toString(),
    latestBlock: latest.toString(),
    inserted,
    caughtUp: current > latest,
  }
}

export interface ActivityQuery {
  agent?: string
  types?: string[]
  limit?: number
}

export async function queryActivity(
  pool: DbPool,
  query: ActivityQuery,
): Promise<ActivityEvent[]> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
  const params: unknown[] = []
  const where: string[] = []

  if (query.agent) {
    params.push(query.agent)
    where.push(`lower(agent_address) = lower($${params.length})`)
  }
  if (query.types && query.types.length > 0) {
    params.push(query.types)
    where.push(`event_type = any($${params.length}::text[])`)
  }
  params.push(limit)

  const result = await pool.query<{
    id: string
    event_type: ActivityEventType
    block_number: string
    tx_hash: string
    log_index: number
    agent_address: string | null
    block_timestamp: Date | null
    args: Record<string, unknown>
  }>(
    `select id, event_type, block_number, tx_hash, log_index, agent_address,
            block_timestamp, args
       from activity_events
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by block_number desc, log_index desc
      limit $${params.length}`,
    params,
  )

  return result.rows.map((row) => ({
    id: row.id,
    type: row.event_type,
    blockNumber: String(row.block_number),
    txHash: row.tx_hash,
    logIndex: row.log_index,
    agent: row.agent_address ?? undefined,
    timestamp: row.block_timestamp?.toISOString(),
    args: row.args,
  }))
}
