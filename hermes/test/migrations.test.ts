import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, describe, expect, it } from 'vitest'

const migrations = ['001_init.sql', '002_intents.sql']
  .map((file) =>
    readFileSync(
      fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)),
      'utf8',
    ),
  )
  .join('\n')

const db = new PGlite()

afterAll(async () => {
  await db.close()
})

describe('Hermes migrations', () => {
  it('creates the Phase 1 and Phase 2 tables idempotently', async () => {
    await db.exec(migrations)
    await db.exec(migrations)

    const tables = await db.query<{ table_name: string }>(
      `select table_name
         from information_schema.tables
        where table_schema = 'public'
        order by table_name`,
    )
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'activity_events',
      'alerts',
      'audit_events',
      'intents',
      'monitor_cursor',
      'transfers',
      'treasury_snapshots',
      'withdrawal_bookkeeping',
    ])
  })

  it('accepts a snapshot and enforces transfer phases', async () => {
    await db.query(
      `insert into treasury_snapshots
         (chain_id, block_number, treasury_address, agent_address, principal,
          total_balance, vault_shares, idle_usdc, active_vault_id, paused,
          keeper, gateway_receiver)
       values (5042, 27349110, '0xtreasury', '0xagent', 10000001, 10000011,
               9992387766924438899, 0, 1, false, '0xkeeper', '0xreceiver')`,
    )
    const snapshot = await db.query<{ principal: string; total_balance: string }>(
      `select principal, total_balance from treasury_snapshots`,
    )
    expect(snapshot.rows[0]).toEqual({
      principal: '10000001',
      total_balance: '10000011',
    })

    await db.query(
      `insert into transfers
         (direction, withdrawal_id, burn_tx_hash, burn_block, source_domain,
          destination_domain, amount, phase)
       values ('out', 3, '0xburn', 27317380, 26, 6, 4999999, 'done')`,
    )

    await expect(
      db.query(
        `insert into transfers
           (direction, burn_tx_hash, burn_block, source_domain, amount, phase)
         values ('out', '0xbad', 1, 26, 1, 'unknown')`,
      ),
    ).rejects.toThrow()
  })

  it('dedupes alerts by kind:subject and stores JSON args', async () => {
    await db.query(
      `insert into alerts (dedupe_key, severity, kind, subject, payload)
       values ('keeper-is-owner:5042:0xagent', 'warning', 'keeper-is-owner',
               '5042:0xagent', '{"owner":"0xowner"}')`,
    )
    await expect(
      db.query(
        `insert into alerts (dedupe_key, severity, kind, subject, payload)
         values ('keeper-is-owner:5042:0xagent', 'warning', 'keeper-is-owner',
                 '5042:0xagent', '{"owner":"0xowner"}')`,
      ),
    ).rejects.toThrow()

    await db.query(
      `insert into activity_events
         (id, event_type, block_number, tx_hash, log_index, agent_address, args)
       values ('0xtx:0', 'WithdrawalRequested', 27317380, '0xtx', 0, '0xagent',
               '{"id":"3","amount":"4999999","destinationDomain":6}')`,
    )
    const event = await db.query<{ id: string; amount: string }>(
      `select args->>'id' as id, args->>'amount' as amount
         from activity_events`,
    )
    expect(event.rows[0]).toEqual({ id: '3', amount: '4999999' })
  })
})
