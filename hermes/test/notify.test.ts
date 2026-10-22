import { afterEach, describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import { sendDiscordAlert } from '../src/monitor/notify'
import type { MonitorAlert } from '../src/monitor/rules'

const logger = pino({ level: 'silent' })

const alert: MonitorAlert = {
  dedupeKey: 'test:subject',
  severity: 'warning',
  kind: 'test-alert',
  subject: 'subject',
  payload: { burnTx: `0x${'11'.repeat(32)}` },
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Discord alert delivery', () => {
  it('returns false when no webhook is configured', async () => {
    await expect(sendDiscordAlert(undefined, alert, logger)).resolves.toBe(false)
  })

  it('posts one embed and returns true', async () => {
    const mockFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))

    await expect(sendDiscordAlert('https://discord.invalid/webhook', alert, logger)).resolves.toBe(
      true,
    )
    expect(mockFetch).toHaveBeenCalledTimes(1)

    const [, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as {
      embeds: Array<{ title: string; fields: Array<{ name: string }> }>
    }
    expect(body.embeds[0].title).toContain('[WARNING]')
    expect(body.embeds[0].fields.some((field) => field.name === 'burnTx')).toBe(true)
  })
})
