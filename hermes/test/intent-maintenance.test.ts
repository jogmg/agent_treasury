import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import pino from 'pino'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadBffConfig } from '../src/bff/config'
import {
  IntentService,
  type IntentChain,
  type IntentChainState,
} from '../src/bff/intents'
import {
  IntentMaintenance,
  type IntentChainReader,
  type TransactionSnapshot,
} from '../src/bff/maintenance'
import type { DbPool } from '../src/db'

const migrations = ['001_init.sql', '002_intents.sql']
  .map((file) =>
    readFileSync(
      fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)),
      'utf8',
    ),
  )
  .join('\n')

const db = new PGlite()
await db.exec(migrations)

const account = privateKeyToAccount(generatePrivateKey())
const now = Date.parse('2026-10-24T12:00:00.000Z')
const logger = pino({ level: 'silent' })
const config = loadBffConfig({
  BFF_SESSION_SECRET: 's'.repeat(64),
  BFF_PUBLIC_ORIGIN: 'http://localhost:5173',
  BFF_COOKIE_SECURE: 'false',
  BFF_INTENT_TTL_SECONDS: '900',
})

const baseState: IntentChainState = {
  paused: false,
  walletUsdc: 100_000_000n,
  treasuryTotal: 20_000_000n,
  allowance: 0n,
  minDeposit: 5_000_000n,
}

function fakeChain(): IntentChain {
  return {
    readState: vi.fn(async () => ({ ...baseState })),
    simulateDeposit: vi.fn(async () => {}),
    simulateWithdrawLocal: vi.fn(async () => {}),
    simulateCctpWithdraw: vi.fn(async () => {}),
  }
}

function service(chain: IntentChain = fakeChain()): IntentService {
  return new IntentService(
    config,
    db as unknown as DbPool,
    chain,
    logger,
    () => now,
  )
}

function maintenance(chain: IntentChainReader): IntentMaintenance {
  return new IntentMaintenance({
    pool: db as unknown as DbPool,
    chain,
    logger,
  })
}

function noTransaction(): Promise<TransactionSnapshot | null> {
  return Promise.resolve(null)
}

async function createSubmitted(
  svc: IntentService,
  amount: string,
  txHash: string,
): Promise<string> {
  const created = await svc.create(account.address, {
    kind: 'deposit',
    amount,
  })
  await svc.submit(created.intent.id, account.address, txHash)
  return created.intent.id
}

beforeEach(async () => {
  await db.query('delete from intents')
  await db.query('delete from audit_events')
})

afterAll(async () => {
  await db.close()
})

describe('IntentMaintenance', () => {
  it('expires stale drafts and leaves submitted records alone', async () => {
    const svc = service()
    const draft = await svc.create(account.address, {
      kind: 'deposit',
      amount: '25',
    })
    const submittedId = await createSubmitted(
      svc,
      '30',
      `0x${'a'.repeat(64)}`,
    )
    await db.query(
      `update intents set expires_at = '2000-01-01T00:00:00Z' where id = $1`,
      [draft.intent.id],
    )

    const result = await maintenance({
      getTransaction: noTransaction,
      getTransactionReceipt: async () => null,
    }).runOnce()

    expect(result.expired).toBe(1)
    const rows = await db.query<{ id: string; status: string }>(
      `select id, status from intents where id in ($1, $2)`,
      [draft.intent.id, submittedId],
    )
    const byId = new Map(rows.rows.map((row) => [row.id, row.status]))
    expect(byId.get(draft.intent.id)).toBe('expired')
    expect(byId.get(submittedId)).toBe('submitted')

    const audits = await db.query<{ action: string }>(
      `select action from audit_events where action = 'intent.expired'`,
    )
    expect(audits.rows).toHaveLength(1)
  })

  it('confirms successful receipts and fails reverted ones', async () => {
    const svc = service()
    const successHash = `0x${'b'.repeat(64)}`
    const revertedHash = `0x${'c'.repeat(64)}`
    const pendingHash = `0x${'d'.repeat(64)}`
    const successId = await createSubmitted(svc, '25', successHash)
    const revertedId = await createSubmitted(svc, '30', revertedHash)
    const pendingId = await createSubmitted(svc, '35', pendingHash)
    const transactions = new Map<string, TransactionSnapshot>()
    for (const id of [successId, revertedId]) {
      const intent = await svc.get(id, account.address)
      transactions.set(intent.txHash ?? '', {
        from: account.address,
        to: intent.to,
        data: intent.data,
        value: BigInt(intent.value),
        chainId: intent.chainId,
      })
    }

    const result = await maintenance({
      getTransaction: async (hash) => transactions.get(hash) ?? null,
      getTransactionReceipt: async (hash) => {
        if (hash === successHash) return { status: 'success' }
        if (hash === revertedHash) return { status: 'reverted' }
        return null
      },
    }).runOnce()

    expect(result).toMatchObject({
      expired: 0,
      confirmed: 1,
      failed: 1,
      pending: 1,
    })

    const rows = await db.query<{ id: string; status: string }>(
      `select id, status from intents where id in ($1, $2, $3)`,
      [successId, revertedId, pendingId],
    )
    const byId = new Map(rows.rows.map((row) => [row.id, row.status]))
    expect(byId.get(successId)).toBe('confirmed')
    expect(byId.get(revertedId)).toBe('failed')
    expect(byId.get(pendingId)).toBe('submitted')

    const audits = await db.query<{ action: string; subject: string }>(
      `select action, subject from audit_events
        where action in ('intent.confirmed', 'intent.failed')
        order by action`,
    )
    expect(audits.rows).toEqual([
      { action: 'intent.confirmed', subject: successId },
      { action: 'intent.failed', subject: revertedId },
    ])
  })

  it('fails a receipt whose transaction does not match the intent', async () => {
    const svc = service()
    const hash = `0x${'e'.repeat(64)}`
    const id = await createSubmitted(svc, '25', hash)
    const intent = await svc.get(id, account.address)

    const result = await maintenance({
      getTransaction: async () => ({
        from: account.address,
        to: intent.to,
        data: '0xdeadbeef',
        value: BigInt(intent.value),
        chainId: intent.chainId,
      }),
      getTransactionReceipt: async () => ({ status: 'success' }),
    }).runOnce()

    expect(result).toMatchObject({ confirmed: 0, failed: 1, pending: 0 })
    const row = await db.query<{ status: string }>(
      `select status from intents where id = $1`,
      [id],
    )
    expect(row.rows[0]?.status).toBe('failed')

    const audit = await db.query<{ payload: { reason: string } }>(
      `select payload from audit_events
        where action = 'intent.failed' and subject = $1`,
      [id],
    )
    expect(audit.rows[0]?.payload.reason).toBe('transaction_mismatch')
  })

  it('does nothing without a Postgres pool', async () => {
    const result = await new IntentMaintenance({
      pool: null,
      chain: {
        getTransaction: noTransaction,
        getTransactionReceipt: async () => null,
      },
      logger,
    }).runOnce()

    expect(result).toEqual({
      expired: 0,
      confirmed: 0,
      failed: 0,
      pending: 0,
    })
  })
})
