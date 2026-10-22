import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import pino from 'pino'
import { afterAll, describe, expect, it } from 'vitest'
import type { DbPool } from '../src/db'
import {
  deliverAlert,
  resolveStaleAlerts,
} from '../src/monitor/notify'
import type { MonitorAlert } from '../src/monitor/rules'

const migration = readFileSync(
  fileURLToPath(new URL('../migrations/001_init.sql', import.meta.url)),
  'utf8',
)

const db = new PGlite()
const logger = pino({ level: 'silent' })

const pool = {
  query: async (text: string, params?: unknown[]) => {
    const result = await db.query(text, params)
    return {
      ...result,
      rowCount: result.rows.length || result.affectedRows || 0,
    }
  },
} as unknown as DbPool

const alert: MonitorAlert = {
  dedupeKey: 'keeper-is-owner:5042:0xagent',
  severity: 'warning',
  kind: 'keeper-is-owner',
  subject: '5042:0xagent',
  payload: { owner: '0xowner', keeper: '0xowner' },
}

afterAll(async () => {
  await db.close()
})

describe('monitor persistence', () => {
  it('persists one alert, throttles retries, and reopens resolved alerts', async () => {
    await db.exec(migration)

    const first = await deliverAlert(pool, alert, undefined, 3_600, logger)
    expect(first).toEqual({ sent: false, reason: 'new' })

    const stored = await db.query<{ last_sent_at: Date | null }>(
      `select last_sent_at from alerts where dedupe_key = $1`,
      [alert.dedupeKey],
    )
    expect(stored.rows[0]?.last_sent_at).toBeTruthy()

    const second = await deliverAlert(pool, alert, undefined, 3_600, logger)
    expect(second).toEqual({ sent: false, reason: 'cooldown' })

    await resolveStaleAlerts(pool, [])
    const resolved = await db.query<{ resolved_at: Date | null }>(
      `select resolved_at from alerts where dedupe_key = $1`,
      [alert.dedupeKey],
    )
    expect(resolved.rows[0]?.resolved_at).toBeTruthy()

    const reopened = await deliverAlert(pool, alert, undefined, 3_600, logger)
    expect(reopened).toEqual({ sent: false, reason: 'reopened' })
  })
})
