import type { Logger } from 'pino'
import { json, type DbPool } from '../db'
import type { MonitorAlert, Severity } from './rules'

const COLORS: Record<Severity, number> = {
  info: 0x3b82f6,
  warning: 0xf59e0b,
  critical: 0xef4444,
}

function truncate(value: string, max = 1_000): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

export async function sendDiscordAlert(
  webhookUrl: string | undefined,
  alert: MonitorAlert,
  logger: Logger,
): Promise<boolean> {
  if (!webhookUrl) {
    logger.warn({ alert }, 'DISCORD_WEBHOOK_URL is not set; alert logged only')
    return false
  }

  const fields = Object.entries(alert.payload)
    .filter(([, value]) => value !== undefined && value !== null)
    .slice(0, 20)
    .map(([name, value]) => ({
      name: name.slice(0, 256),
      value: truncate(typeof value === 'string' ? value : json(value)).slice(0, 1_024),
      inline: typeof value === 'string' && value.length < 80,
    }))

  const body = {
    username: 'Hermes Ops',
    embeds: [
      {
        title: truncate(`[${alert.severity.toUpperCase()}] ${alert.kind}`, 256),
        description: truncate(alert.subject, 2_000),
        color: COLORS[alert.severity],
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: `dedupe: ${alert.dedupeKey}` },
      },
    ],
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      logger.error({ status: response.status, alert: alert.dedupeKey }, 'Discord webhook failed')
      return false
    }
    return true
  } catch (error) {
    // Never log the webhook URL or the full undici error object: the URL path
    // is the credential.
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        alert: alert.dedupeKey,
      },
      'Discord webhook request failed',
    )
    return false
  }
}

export interface AlertDelivery {
  sent: boolean
  reason: string
}

/**
 * Persist an alert and send it at most once per cooldown window. The alert row
 * is the source of truth for dedupe; Discord delivery is best-effort.
 */
export async function deliverAlert(
  pool: DbPool,
  alert: MonitorAlert,
  webhookUrl: string | undefined,
  cooldownSeconds: number,
  logger: Logger,
): Promise<AlertDelivery> {
  const existing = await pool.query<{
    id: string
    last_sent_at: Date | null
    resolved_at: Date | null
  }>(
    `select id, last_sent_at, resolved_at
       from alerts
      where dedupe_key = $1`,
    [alert.dedupeKey],
  )

  const now = new Date()
  let shouldSend = false
  let reason = 'cooldown'

  if (existing.rows.length === 0) {
    await pool.query(
      `insert into alerts (dedupe_key, severity, kind, subject, payload, first_seen_at, last_seen_at)
       values ($1, $2, $3, $4, $5::jsonb, now(), now())`,
      [alert.dedupeKey, alert.severity, alert.kind, alert.subject, json(alert.payload)],
    )
    shouldSend = true
    reason = 'new'
  } else {
    const row = existing.rows[0]
    if (row.resolved_at) {
      shouldSend = true
      reason = 'reopened'
    } else if (
      !row.last_sent_at ||
      now.getTime() - new Date(row.last_sent_at).getTime() >= cooldownSeconds * 1_000
    ) {
      shouldSend = true
      reason = 'cooldown-expired'
    }

    await pool.query(
      `update alerts
          set severity = $2,
              kind = $3,
              subject = $4,
              payload = $5::jsonb,
              last_seen_at = now(),
              resolved_at = null
        where dedupe_key = $1`,
      [alert.dedupeKey, alert.severity, alert.kind, alert.subject, json(alert.payload)],
    )
  }

  if (!shouldSend) return { sent: false, reason }

  const sent = await sendDiscordAlert(webhookUrl, alert, logger)
  // Record the attempt even when delivery fails or no webhook is configured.
  // Otherwise a down webhook would retry on every monitor tick.
  await pool.query(
    `update alerts set last_sent_at = now() where dedupe_key = $1`,
    [alert.dedupeKey],
  )
  return { sent, reason }
}

export async function resolveStaleAlerts(
  pool: DbPool,
  activeKeys: string[],
): Promise<number> {
  const result = await pool.query(
    `update alerts
        set resolved_at = now()
      where resolved_at is null
        and not (dedupe_key = any($1::text[]))`,
    [activeKeys],
  )
  return result.rowCount ?? 0
}

export async function openAlerts(
  pool: DbPool,
  limit = 50,
): Promise<Array<Record<string, unknown>>> {
  const result = await pool.query(
    `select dedupe_key, severity, kind, subject, payload, first_seen_at,
            last_seen_at, last_sent_at
       from alerts
      where resolved_at is null
      order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end,
               last_seen_at desc
      limit $1`,
    [Math.min(Math.max(limit, 1), 200)],
  )
  return result.rows
}
