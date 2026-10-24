import type { Logger } from 'pino'
import type { BffConfig } from './config'
import { BffHttpError } from './errors'

export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ChatResult {
  reply: string
  model: string | null
  usage: Record<string, unknown> | null
}

function extractText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return null
  const parts: string[] = []
  for (const part of value) {
    if (typeof part === 'string') parts.push(part)
    else if (part && typeof part === 'object') {
      const text = (part as { text?: unknown }).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.length > 0 ? parts.join('') : null
}

function extractReply(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const body = data as {
    output_text?: unknown
    choices?: Array<{ message?: { content?: unknown } }>
    output?: Array<{ content?: unknown }>
  }
  const outputText = extractText(body.output_text)
  if (outputText) return outputText

  const choiceContent = body.choices?.[0]?.message?.content
  const choiceText = extractText(choiceContent)
  if (choiceText) return choiceText

  if (Array.isArray(body.output)) {
    const parts: string[] = []
    for (const item of body.output) {
      const text = extractText(item?.content)
      if (text) parts.push(text)
    }
    if (parts.length > 0) return parts.join('')
  }
  return null
}

export async function requestHermesChat(options: {
  config: BffConfig
  wallet: `0x${string}`
  messages: ChatMessage[]
  conversationId?: string
  idempotencyKey: string
  system?: string
  logger: Logger
  fetchImpl?: typeof fetch
}): Promise<ChatResult> {
  const { config } = options
  if (!config.hermesUserUrl || !config.hermesUserApiKey) {
    throw new BffHttpError(
      503,
      'chat_unconfigured',
      'Hermes User is not connected yet. The read-only API is available, but chat needs a User profile.',
    )
  }

  const fetchImpl = options.fetchImpl ?? fetch
  // Hermes follows the OpenAI Chat Completions shape: server-owned instructions
  // must be a `system` message, not a top-level `system` field. The latter is
  // ignored by the upstream router, which would silently drop the action format.
  const messages = options.system
    ? [{ role: 'system' as const, content: options.system }, ...options.messages]
    : options.messages
  const body: Record<string, unknown> = {
    messages,
    stream: false,
  }
  if (config.hermesUserModel) body.model = config.hermesUserModel

  // A standalone User gateway may expose `/v1/chat/completions` instead of the
  // profile-scoped host-gateway route. Try the configured path first, then the
  // neutral OpenAI-compatible path on a route-level 404.
  const paths = [config.hermesUserChatPath]
  if (!paths.includes('/v1/chat/completions')) paths.push('/v1/chat/completions')

  let response: Response | null = null
  let lastRouteError: unknown = null
  for (const path of paths) {
    const url = new URL(path, `${config.hermesUserUrl}/`)
    try {
      const candidate = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.hermesUserApiKey}`,
          'x-hermes-session-key': `bff:${options.wallet.toLowerCase()}:${options.conversationId ?? 'default'}`,
          'idempotency-key': options.idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.chatTimeoutMs),
      })
      if (candidate.status === 404 && path !== paths[paths.length - 1]) {
        lastRouteError = new Error(`Hermes route ${path} was not found`)
        if (candidate.body) await candidate.body.cancel().catch(() => undefined)
        continue
      }
      response = candidate
      break
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      if (name === 'TimeoutError' || name === 'AbortError') {
        options.logger.warn({ wallet: options.wallet }, 'Hermes User chat timed out')
        throw new BffHttpError(504, 'chat_timeout', 'Hermes took too long to answer. Try again.')
      }
      options.logger.error(
        { err: error, wallet: options.wallet },
        'Hermes User chat request failed',
      )
      throw new BffHttpError(502, 'chat_upstream_error', 'Hermes is unavailable right now.')
    }
  }

  if (!response) {
    options.logger.error(
      { err: lastRouteError, wallet: options.wallet },
      'Hermes User chat route was not found',
    )
    throw new BffHttpError(502, 'chat_upstream_error', 'Hermes is unavailable right now.')
  }

  const text = await response.text()
  if (!response.ok) {
    options.logger.error(
      { status: response.status, wallet: options.wallet, body: text.slice(0, 500) },
      'Hermes User chat returned an error',
    )
    throw new BffHttpError(502, 'chat_upstream_error', 'Hermes returned an error. Try again.')
  }

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    options.logger.error(
      { wallet: options.wallet, body: text.slice(0, 500) },
      'Hermes User chat returned non-JSON',
    )
    throw new BffHttpError(502, 'chat_invalid_response', 'Hermes returned an unreadable answer.')
  }

  const reply = extractReply(data)
  if (!reply) {
    options.logger.error(
      { wallet: options.wallet, body: text.slice(0, 500) },
      'Hermes User chat response had no assistant text',
    )
    throw new BffHttpError(502, 'chat_invalid_response', 'Hermes returned an empty answer.')
  }

  const record = data as { model?: unknown; usage?: unknown }
  return {
    reply,
    model: typeof record.model === 'string' ? record.model : null,
    usage:
      record.usage && typeof record.usage === 'object'
        ? (record.usage as Record<string, unknown>)
        : null,
  }
}
