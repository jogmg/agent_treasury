import { createServer } from 'node:http'
import pino from 'pino'
import { readTreasuryState, readWithdrawal } from '../arc'
import { resolveCctpWithdrawal } from '../cctp'
import { loadConfig, type HermesConfig } from '../config'
import { createPool, json, type DbPool } from '../db'
import { scanActivity } from '../activity'
import {
  collectAlerts,
  type MonitorAlert,
  type TransferRow,
} from './rules'
import { deliverAlert, resolveStaleAlerts } from './notify'

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'hermes-monitor' },
})

interface HealthState {
  startedAt: string
  running: boolean
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastErrorAt: string | null
  lastError: string | null
}

const health: HealthState = {
  startedAt: new Date().toISOString(),
  running: false,
  lastRunAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
}

function startHealthServer(port: number, host: string) {
  const server = createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not_found' }))
      return
    }
    const failedAfterSuccess =
      health.lastErrorAt !== null &&
      (health.lastSuccessAt === null || health.lastErrorAt > health.lastSuccessAt)
    const body = {
      ok: !failedAfterSuccess,
      service: 'hermes-monitor',
      ...health,
    }
    res.writeHead(failedAfterSuccess ? 503 : 200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  server.listen(port, host, () => {
    logger.info({ port }, 'monitor health endpoint listening')
  })
  return server
}

interface TransferDbRow {
  id: string
  direction: 'in' | 'out'
  withdrawal_id: string | null
  burn_tx_hash: string
  burn_block: string
  source_domain: number
  destination_domain: number | null
  amount: string
  phase: 'waiting' | 'ready' | 'done' | 'error'
  nonce: string | null
  mint_tx_hash: string | null
  created_at: Date
  last_checked_at: Date | null
}

function toTransferRow(row: TransferDbRow): TransferRow {
  return {
    id: Number(row.id),
    direction: row.direction,
    withdrawalId: row.withdrawal_id === null ? null : Number(row.withdrawal_id),
    burnTxHash: row.burn_tx_hash,
    burnBlock: String(row.burn_block),
    sourceDomain: row.source_domain,
    destinationDomain: row.destination_domain,
    amount: row.amount,
    phase: row.phase,
    nonce: row.nonce,
    mintTxHash: row.mint_tx_hash,
    createdAt: row.created_at.toISOString(),
    lastCheckedAt: row.last_checked_at?.toISOString() ?? null,
  }
}

async function indexNewWithdrawalEvents(pool: DbPool, config: HermesConfig): Promise<number> {
  const result = await pool.query<{
    block_number: string
    block_timestamp: Date | null
    tx_hash: string
    agent_address: string | null
    args: Record<string, unknown>
  }>(
    `select e.block_number, e.block_timestamp, e.tx_hash, e.agent_address, e.args
       from activity_events e
      where e.event_type = 'WithdrawalRequested'
        and not exists (
          select 1 from transfers t
           where t.burn_tx_hash = e.tx_hash and t.direction = 'out'
        )
      order by e.block_number asc, e.log_index asc
      limit 500`,
  )

  let inserted = 0
  for (const row of result.rows) {
    const args = row.args
    const withdrawalId = args.id
    const amount = args.amount
    const destinationDomain = args.destinationDomain
    if (withdrawalId === undefined || amount === undefined || destinationDomain === undefined) {
      continue
    }
    const result = await pool.query(
      `insert into transfers
         (direction, withdrawal_id, burn_tx_hash, burn_block, source_domain,
          destination_domain, amount, phase, message_hash, created_at)
       values ('out', $1, $2, $3, $4, $5, $6, 'waiting', $7, coalesce($8::timestamptz, now()))
       on conflict (burn_tx_hash, direction) do nothing`,
      [
        String(withdrawalId),
        row.tx_hash,
        row.block_number,
        config.network.cctpDomain,
        Number(destinationDomain),
        String(amount),
        typeof args.messageHash === 'string' ? args.messageHash : null,
        row.block_timestamp?.toISOString() ?? null,
      ],
    )
    inserted += result.rowCount ?? 0
  }
  return inserted
}

async function recordSnapshot(
  pool: DbPool,
  config: HermesConfig,
  agent: `0x${string}`,
): Promise<Awaited<ReturnType<typeof readTreasuryState>>> {
  const state = await readTreasuryState(config, agent)
  if (
    state.asOfBlock === '0' ||
    state.principal === null ||
    state.totalBalance === null ||
    state.vaultShares === null ||
    state.idleUsdc === null ||
    state.paused === null ||
    state.keeper === null ||
    state.gatewayReceiver === null
  ) {
    throw new Error(
      `Incomplete Arc snapshot at block ${state.asOfBlock}; refusing to persist zero placeholders`,
    )
  }
  await pool.query(
    `insert into treasury_snapshots
       (chain_id, block_number, treasury_address, agent_address, principal,
        total_balance, vault_shares, idle_usdc, active_vault_id, paused,
        keeper, gateway_receiver)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (chain_id, block_number, treasury_address, agent_address) do nothing`,
    [
      state.chainId,
      state.asOfBlock,
      state.treasury,
      state.agent,
      state.principal ?? '0',
      state.totalBalance ?? '0',
      state.vaultShares ?? '0',
      state.idleUsdc ?? '0',
      state.activeVaultId,
      state.paused ?? false,
      state.keeper ?? '',
      state.gatewayReceiver ?? '',
    ],
  )
  return state
}

async function refreshTransfers(
  pool: DbPool,
  config: HermesConfig,
): Promise<TransferRow[]> {
  const open = await pool.query<TransferDbRow>(
    `select id, direction, withdrawal_id, burn_tx_hash, burn_block,
            source_domain, destination_domain, amount, phase, nonce,
            mint_tx_hash, created_at, last_checked_at
       from transfers
      where direction = 'out'
        and phase in ('waiting', 'ready', 'error')
      order by last_checked_at asc nulls first, created_at asc
      limit 50`,
  )

  const refreshed: TransferRow[] = []
  const refreshOne = async (row: TransferDbRow): Promise<TransferRow> => {
    const transfer = toTransferRow(row)
    const status = await resolveCctpWithdrawal(config, transfer.burnTxHash, {
      sourceDomain: transfer.sourceDomain,
    })

    await pool.query(
      `update transfers
          set phase = $2,
              destination_domain = $3,
              nonce = $4,
              iris_status = $5,
              mint_tx_hash = $6,
              mint_block = $7,
              last_checked_at = now(),
              completed_at = case when $2 = 'done' then coalesce(completed_at, now()) else completed_at end,
              raw = $8::jsonb
        where id = $1`,
      [
        transfer.id,
        status.phase,
        status.destinationDomain || transfer.destinationDomain,
        status.nonce ?? transfer.nonce,
        status.attestationComplete ? 'complete' : status.phase,
        status.mintTxHash ?? null,
        status.mintBlockNumber ?? null,
        json(status),
      ],
    )

    const updated: TransferRow = {
      ...transfer,
      phase: status.phase,
      destinationDomain: status.destinationDomain || transfer.destinationDomain,
      nonce: status.nonce ?? transfer.nonce,
      mintTxHash: status.mintTxHash ?? null,
    }

    if (status.phase === 'done' && updated.withdrawalId !== null) {
      const record = await readWithdrawal(config, BigInt(updated.withdrawalId))
      const executed = record?.executed ?? false
      await pool.query(
        `insert into withdrawal_bookkeeping
           (withdrawal_id, burn_tx_hash, executed_on_chain, verified_complete_at, status)
         values ($1, $2, $3, now(), $4)
         on conflict (withdrawal_id) do update
           set burn_tx_hash = excluded.burn_tx_hash,
               executed_on_chain = excluded.executed_on_chain,
               verified_complete_at = coalesce(withdrawal_bookkeeping.verified_complete_at, now()),
               status = excluded.status,
               updated_at = now()`,
        [
          updated.withdrawalId,
          updated.burnTxHash,
          executed,
          executed ? 'executed' : 'ready_for_keeper',
        ],
      )
    }

    return updated
  }

  // Four at a time keeps the monitor cadence reasonable without hammering the
  // public Iris/destination RPCs with all 50 transfers at once.
  const concurrency = 4
  for (let i = 0; i < open.rows.length; i += concurrency) {
    const batch = open.rows.slice(i, i + concurrency)
    refreshed.push(...(await Promise.all(batch.map(refreshOne))))
  }

  return refreshed
}

async function runOnce(
  config: HermesConfig,
  pool: DbPool,
): Promise<{ alerts: number; indexed: number }> {
  const scan = await scanActivity(pool, config, config.indexChunksPerRun)
  const insertedTransfers = await indexNewWithdrawalEvents(pool, config)
  logger.info(
    {
      scan,
      insertedTransfers,
    },
    'monitor scan complete',
  )

  const states = []
  for (const agent of config.trackedAgents) {
    states.push(await recordSnapshot(pool, config, agent))
  }

  const transfers = await refreshTransfers(pool, config)
  const alerts: MonitorAlert[] = states.flatMap((state) =>
    collectAlerts(config, state, transfers),
  )

  let sent = 0
  for (const alert of alerts) {
    try {
      const delivery = await deliverAlert(
        pool,
        alert,
        config.discordWebhookUrl,
        config.alertCooldownSeconds,
        logger,
      )
      if (delivery.sent) sent += 1
    } catch (error) {
      logger.error({ err: error, alert: alert.dedupeKey }, 'failed to deliver alert')
    }
  }

  await resolveStaleAlerts(pool, alerts.map((alert) => alert.dedupeKey))
  await pool.query(
    `insert into monitor_cursor (key, value, updated_at)
     values ('monitorHeartbeat', $1, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [new Date().toISOString()],
  )

  return { alerts: sent, indexed: scan.inserted }
}

async function main(): Promise<void> {
  const config = loadConfig()
  const pool = createPool(config)
  if (!pool) {
    throw new Error('DATABASE_URL is required for the monitor')
  }

  logger.info(
    {
      network: config.network.network,
      chainId: config.network.chainId,
      agents: config.trackedAgents,
      intervalSeconds: config.monitorIntervalMs / 1_000,
    },
    'Hermes monitor starting',
  )

  let running = false
  const tick = async (): Promise<boolean> => {
    if (running) {
      logger.warn('previous monitor run still active; skipping tick')
      return true
    }
    running = true
    health.running = true
    health.lastRunAt = new Date().toISOString()
    try {
      const result = await runOnce(config, pool)
      health.lastSuccessAt = new Date().toISOString()
      health.lastError = null
      logger.info(result, 'monitor run complete')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      health.lastErrorAt = new Date().toISOString()
      health.lastError = message
      logger.error({ err: error }, 'monitor run failed')

      // Surface a failing monitor in Discord too. The next successful run
      // clears this alert because its key is not in the active alert set.
      try {
        await deliverAlert(
          pool,
          {
            dedupeKey: 'monitor-run-failed',
            severity: 'critical',
            kind: 'monitor-run-failed',
            subject: 'Monitor run failed; check /health and container logs.',
            payload: { error: message, at: new Date().toISOString() },
          },
          config.discordWebhookUrl,
          config.alertCooldownSeconds,
          logger,
        )
      } catch (alertError) {
        logger.error({ err: alertError }, 'failed to record monitor failure alert')
      }
      return false
    } finally {
      running = false
      health.running = false
    }
  }

  if (process.argv.includes('--once')) {
    const ok = await tick()
    await pool.end()
    if (!ok) process.exitCode = 1
    return
  }

  const healthServer = startHealthServer(config.monitorPort, config.monitorHost)
  await tick()
  const timer = setInterval(() => {
    void tick()
  }, config.monitorIntervalMs)

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'monitor shutting down')
    clearInterval(timer)
    healthServer.close()
    await pool.end()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error) => {
  logger.fatal({ err: error }, 'monitor failed')
  process.exitCode = 1
})
