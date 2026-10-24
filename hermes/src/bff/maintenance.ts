import type { Logger } from 'pino'
import type { DbPool } from '../db'

export interface TransactionSnapshot {
  from: `0x${string}`
  to: `0x${string}` | null
  data: `0x${string}`
  value: bigint
  chainId?: number
}

/** Minimal chain boundary for receipt reconciliation. */
export interface IntentChainReader {
  getTransaction(hash: `0x${string}`): Promise<TransactionSnapshot | null>
  getTransactionReceipt(
    hash: `0x${string}`,
  ): Promise<{ status: 'success' | 'reverted' } | null>
}

export interface IntentMaintenanceResult {
  expired: number
  confirmed: number
  failed: number
  pending: number
}

const EMPTY_RESULT: IntentMaintenanceResult = {
  expired: 0,
  confirmed: 0,
  failed: 0,
  pending: 0,
}

const RECEIPT_BATCH_SIZE = 50

export interface IntentMaintenanceOptions {
  pool: DbPool | null
  chain: IntentChainReader
  logger: Logger
}

/**
 * Keeps the intent store truthful after the wallet has signed:
 * - submitted transactions are reconciled from their receipts and contents;
 * - unsigned drafts expire even when nobody reads them again.
 *
 * It is deliberately best-effort. A failed sweep is logged and retried on the
 * next interval; it never blocks the HTTP server or changes a submitted intent
 * without a deterministic receipt and a matching transaction.
 */
export class IntentMaintenance {
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(private readonly options: IntentMaintenanceOptions) {}

  async runOnce(): Promise<IntentMaintenanceResult> {
    if (!this.options.pool) return { ...EMPTY_RESULT }
    if (this.running) return { ...EMPTY_RESULT }
    this.running = true
    try {
      const expired = await this.expireDrafts()
      const reconciled = await this.reconcileSubmitted()
      return { expired, ...reconciled }
    } finally {
      this.running = false
    }
  }

  start(intervalMs: number): void {
    if (intervalMs <= 0 || this.timer) return
    const tick = (): void => {
      void this.runOnce().catch((error: unknown) => {
        this.options.logger.error({ err: error }, 'intent maintenance sweep failed')
      })
    }
    tick()
    this.timer = setInterval(tick, intervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  private async expireDrafts(): Promise<number> {
    const pool = this.options.pool
    if (!pool) return 0
    const result = await pool.query<{ id: string; wallet: string }>(
      `update intents
          set status = 'expired', updated_at = now()
        where status in ('draft', 'reviewed')
          and expires_at <= now()
        returning id, wallet`,
    )

    for (const row of result.rows) {
      await this.audit(row.wallet, 'intent.expired', row.id, {}).catch(
        (error: unknown) => {
          this.options.logger.warn(
            { err: error, intentId: row.id },
            'intent expiry audit insert failed',
          )
        },
      )
    }
    return result.rows.length
  }

  private async reconcileSubmitted(): Promise<
    Omit<IntentMaintenanceResult, 'expired'>
  > {
    const pool = this.options.pool
    if (!pool) return { confirmed: 0, failed: 0, pending: 0 }

    const result = await pool.query<{
      id: string
      wallet: string
      tx_hash: string
      chain_id: number
      to_address: string
      data: string
      value: string
    }>(
      `select id, wallet, tx_hash, chain_id, to_address, data, value
         from intents
        where status = 'submitted' and tx_hash is not null
        order by submitted_at asc nulls first
        limit $1`,
      [RECEIPT_BATCH_SIZE],
    )

    let confirmed = 0
    let failed = 0
    let pending = 0

    for (const row of result.rows) {
      let receipt: { status: 'success' | 'reverted' } | null
      try {
        receipt = await this.options.chain.getTransactionReceipt(
          row.tx_hash as `0x${string}`,
        )
      } catch (error) {
        this.options.logger.warn(
          { err: error, intentId: row.id, txHash: row.tx_hash },
          'intent receipt lookup failed',
        )
        pending += 1
        continue
      }

      if (!receipt) {
        // Still in the mempool, or the RPC has not indexed it yet.
        pending += 1
        continue
      }

      let transaction: TransactionSnapshot | null
      try {
        transaction = await this.options.chain.getTransaction(
          row.tx_hash as `0x${string}`,
        )
      } catch (error) {
        this.options.logger.warn(
          { err: error, intentId: row.id, txHash: row.tx_hash },
          'intent transaction lookup failed',
        )
        pending += 1
        continue
      }

      if (!transaction) {
        pending += 1
        continue
      }

      // A receipt only proves that *some* transaction succeeded. Confirm only
      // when the transaction is the exact call the BFF derived for this wallet.
      const matches =
        transaction.from.toLowerCase() === row.wallet.toLowerCase() &&
        transaction.to?.toLowerCase() === row.to_address.toLowerCase() &&
        transaction.data.toLowerCase() === row.data.toLowerCase() &&
        transaction.value === BigInt(row.value) &&
        (transaction.chainId === undefined || transaction.chainId === row.chain_id)
      let status: 'confirmed' | 'failed'
      let reason: 'receipt_success' | 'receipt_reverted' | 'transaction_mismatch'
      if (!matches) {
        status = 'failed'
        reason = 'transaction_mismatch'
      } else if (receipt.status === 'success') {
        status = 'confirmed'
        reason = 'receipt_success'
      } else {
        status = 'failed'
        reason = 'receipt_reverted'
      }

      const updated = await pool.query<{ id: string }>(
        `update intents
            set status = $1, updated_at = now()
          where id = $2 and status = 'submitted' and tx_hash = $3
          returning id`,
        [status, row.id, row.tx_hash],
      )
      if (updated.rows.length === 0) {
        // Another sweep or request already moved the row.
        pending += 1
        continue
      }

      await this.audit(row.wallet, `intent.${status}`, row.id, {
        txHash: row.tx_hash,
        reason,
      }).catch((error: unknown) => {
        this.options.logger.warn(
          { err: error, intentId: row.id },
          'intent receipt audit insert failed',
        )
      })

      if (status === 'confirmed') confirmed += 1
      else failed += 1
    }

    return { confirmed, failed, pending }
  }

  private async audit(
    wallet: string,
    action: string,
    intentId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const pool = this.options.pool
    if (!pool) return
    await pool.query(
      `insert into audit_events (actor, action, subject, payload)
       values ($1, $2, $3, $4::jsonb)`,
      [wallet, action, intentId, JSON.stringify(payload)],
    )
  }
}
