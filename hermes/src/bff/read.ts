import type { Logger } from 'pino'
import { fetchActivityWindow, queryActivity, type ActivityEvent } from '../activity'
import { createArcClient, readTreasuryState, type TreasuryState } from '../arc'
import { resolveCctpWithdrawal, type CctpWithdrawalStatus } from '../cctp'
import type { HermesConfig } from '../config'
import type { DbPool } from '../db'

export class ReadUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReadUnavailableError'
  }
}

export interface ActivityResult {
  source: 'postgres' | 'live'
  fromBlock?: string
  toBlock?: string
  events: ActivityEvent[]
}

export interface TransferRecord {
  [key: string]: unknown
}

export interface BffReader {
  configResponse(): Record<string, unknown>
  treasury(agent: `0x${string}`): Promise<TreasuryState>
  activity(
    agent: `0x${string}`,
    limit: number,
    types?: string[],
  ): Promise<ActivityResult>
  cctp(burnTx: string): Promise<CctpWithdrawalStatus>
  transfers(burnTx: string, agent: `0x${string}`): Promise<TransferRecord[]>
  close(): Promise<void>
}

export class BffReadService implements BffReader {
  constructor(
    private readonly config: HermesConfig,
    private readonly pool: DbPool | null,
    private readonly logger: Logger,
  ) {}

  configResponse(): Record<string, unknown> {
    return {
      network: this.config.network.network,
      chainId: this.config.network.chainId,
      name: this.config.network.name,
      explorer: this.config.network.explorer,
      cctpDomain: this.config.network.cctpDomain,
      addresses: this.config.network.addresses,
      deployBlock: this.config.network.deployBlock.toString(),
      irisApiUrl: this.config.network.irisApiUrl,
      readOnly: true,
    }
  }

  async treasury(agent: `0x${string}`): Promise<TreasuryState> {
    return readTreasuryState(this.config, agent)
  }

  async activity(
    agent: `0x${string}`,
    limit: number,
    types?: string[],
  ): Promise<ActivityResult> {
    if (this.pool) {
      try {
        const rows = await queryActivity(this.pool, { agent, types, limit })
        if (rows.length > 0) return { source: 'postgres', events: rows }
      } catch (error) {
        this.logger.warn({ err: error }, 'BFF activity query failed; falling back to live scan')
      }
    }

    const client = createArcClient(this.config)
    const latest = await client.getBlockNumber()
    const lookback = 100_000n
    const candidate = latest > lookback ? latest - lookback : this.config.network.deployBlock
    const from = candidate < this.config.network.deployBlock
      ? this.config.network.deployBlock
      : candidate
    const events = await fetchActivityWindow(this.config, from, latest, agent)
    return {
      source: 'live',
      fromBlock: from.toString(),
      toBlock: latest.toString(),
      events: events.slice(0, limit),
    }
  }

  async cctp(burnTx: string): Promise<CctpWithdrawalStatus> {
    return resolveCctpWithdrawal(this.config, burnTx)
  }

  async transfers(burnTx: string, agent: `0x${string}`): Promise<TransferRecord[]> {
    if (!this.pool) {
      throw new ReadUnavailableError('Transfer history is unavailable without Postgres.')
    }
    const result = await this.pool.query(
      `select t.id, t.direction, t.withdrawal_id, t.burn_tx_hash, t.burn_block,
              t.source_domain, t.destination_domain, t.amount, t.nonce, t.iris_status,
              t.phase, t.mint_tx_hash, t.mint_block, t.message_hash, t.last_checked_at,
              t.completed_at, t.created_at
         from transfers t
        where t.burn_tx_hash = $1
          and exists (
            select 1
              from activity_events e
             where e.tx_hash = t.burn_tx_hash
               and e.event_type = 'WithdrawalRequested'
               and lower(e.agent_address) = lower($2)
          )
        order by t.id desc
        limit 10`,
      [burnTx, agent],
    )
    return result.rows as TransferRecord[]
  }

  async close(): Promise<void> {
    await this.pool?.end()
  }
}
