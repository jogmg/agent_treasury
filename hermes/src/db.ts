import pg from 'pg'
import type { HermesConfig } from './config'

const { Pool } = pg

export type DbPool = pg.Pool

export function createPool(config: HermesConfig): DbPool | null {
  if (!config.databaseUrl) return null
  const pool = new Pool({
    connectionString: config.databaseUrl,
    // Managed Postgres (Fly/Railway) usually terminates TLS with a provider
    // CA that is not in Node's trust store. Opt in explicitly; private
    // Compose Postgres should leave this off.
    ...(config.databaseSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })

  // An idle client can emit an error (for example, when Postgres restarts).
  // Without a listener, Node treats it as an unhandled EventEmitter error and
  // kills the monitor/MCP process. Log it and let the next query reconnect.
  pool.on('error', (error) => {
    console.error(
      'Postgres pool error:',
      error instanceof Error ? error.message : String(error),
    )
  })

  return pool
}

export async function withTransaction<T>(
  pool: DbPool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (error) {
    try {
      await client.query('rollback')
    } catch {
      // Preserve the original error.
    }
    throw error
  } finally {
    client.release()
  }
}

/**
 * Postgres JSON does not accept bigint. Convert recursively while preserving
 * address/hex strings as strings.
 */
export function toJsonValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  // pg returns timestamptz columns as Date objects. Without this they would
  // serialize as {} because Date has no enumerable own keys.
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(toJsonValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        toJsonValue(entry),
      ]),
    )
  }
  return value
}

export function json(value: unknown): string {
  return JSON.stringify(toJsonValue(value))
}
