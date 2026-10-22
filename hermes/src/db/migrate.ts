import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPool, type DbPool } from '../db'
import { loadConfig } from '../config'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url))

export async function applyMigrations(pool: DbPool): Promise<string[]> {
  await pool.query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `)

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()

  const applied: string[] = []
  for (const file of files) {
    const existing = await pool.query('select 1 from schema_migrations where version = $1', [file])
    if (existing.rowCount) continue

    const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8')
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(sql)
      await client.query('insert into schema_migrations (version) values ($1)', [file])
      await client.query('commit')
      applied.push(file)
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }
  return applied
}

async function main(): Promise<void> {
  const config = loadConfig()
  const pool = createPool(config)
  if (!pool) {
    throw new Error('DATABASE_URL is required to run migrations')
  }
  try {
    const applied = await applyMigrations(pool)
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'No pending migrations')
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
