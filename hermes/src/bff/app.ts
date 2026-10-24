import { randomUUID } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import pino, { type Logger } from 'pino'
import { parseSiweMessage } from 'viem/siwe'
import { z } from 'zod'
import { ACTIVITY_EVENT_TYPES } from '../abis'
import { createArcClient } from '../arc'
import { createPool, toJsonValue } from '../db'
import {
  createSessionToken,
  createSiweChallenge,
  NonceStore,
  parseCookies,
  verifySessionToken,
  verifySiweLogin,
  type VerifiedSession,
} from './auth'
import { requestHermesChat, type ChatMessage } from './chat'
import type { BffConfig } from './config'
import { BffHttpError, isBffHttpError } from './errors'
import { RateLimiter } from './rate-limit'
import {
  BffReadService,
  ReadUnavailableError,
  type BffReader,
} from './read'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const TX_RE = /^0x[0-9a-fA-F]{64}$/
const SIGNATURE_RE = /^0x[0-9a-fA-F]{2,}$/
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{1,120}$/

const nonceBodySchema = z.object({
  address: z.string().regex(ADDRESS_RE),
})

const verifyBodySchema = z.object({
  message: z.string().min(1).max(12_000),
  signature: z.string().regex(SIGNATURE_RE),
})

const chatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4_000),
      }),
    )
    .min(1)
    .max(20),
  conversationId: z
    .string()
    .regex(/^[A-Za-z0-9._:-]{1,100}$/)
    .optional(),
})

export interface AuthedRequest extends Request {
  wallet?: `0x${string}`
  session?: VerifiedSession
}

export interface BffDeps {
  reader?: BffReader
  logger?: Logger
  now?: () => number
  fetchImpl?: typeof fetch
}

export interface BffApp {
  app: express.Express
  close: () => Promise<void>
}

function requestWallet(req: Request): `0x${string}` {
  const wallet = (req as AuthedRequest).wallet
  if (!wallet) throw new BffHttpError(401, 'unauthorized', 'Sign in with your wallet.')
  return wallet
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } })
}

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown'
}

function sessionCookieOptions(config: BffConfig) {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    domain: config.cookieDomain,
    path: '/',
    maxAge: config.sessionTtlSeconds * 1000,
  } as const
}

function clearSessionCookie(res: Response, config: BffConfig): void {
  res.clearCookie(config.cookieName, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    domain: config.cookieDomain,
    path: '/',
  })
}

function createLogger(config: BffConfig): Logger {
  return pino({
    level: config.hermes.logLevel,
    base: { service: 'hermes-bff' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
      ],
      censor: '[redacted]',
    },
  })
}

function totalChatCharacters(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + message.content.length, 0)
}

function parseActivityTypes(value: unknown): string[] | null {
  if (value === undefined) return null
  if (typeof value !== 'string' || value.trim() === '') return null
  const requested = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (requested.length === 0) return null
  if (requested.length > ACTIVITY_EVENT_TYPES.size) return null
  if (requested.some((entry) => !ACTIVITY_EVENT_TYPES.has(entry))) return null
  return requested
}

export function createBffApp(config: BffConfig, deps: BffDeps = {}): BffApp {
  const logger = deps.logger ?? createLogger(config)
  const now = deps.now ?? Date.now
  // Only the default reader owns the Postgres pool. An injected reader (tests
  // or a host integration) is responsible for its own resources.
  const pool = !deps.reader && config.hermes.databaseUrl
    ? createPool(config.hermes)
    : null
  const reader = deps.reader ?? new BffReadService(config.hermes, pool, logger)
  const publicClient = createArcClient(config.hermes)
  const nonceStore = new NonceStore(config.nonceTtlSeconds * 1000, now)
  const nonceLimiter = new RateLimiter(config.nonceRateLimitPerMinute, 60_000, now)
  const chatLimiter = new RateLimiter(config.chatRateLimitPerMinute, 60_000, now)

  const app = express()
  app.disable('x-powered-by')
  if (config.trustProxy) app.set('trust proxy', 1)
  app.use((_req, res, next) => {
    // Sessions, balances, and activity must never be served from a stale cache.
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  app.use(express.json({ limit: '32kb' }))

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    res.setHeader('Cache-Control', 'no-store')
    next()
  })

  app.use((req, res, next) => {
    const origin = req.get('origin')
    res.setHeader('Vary', 'Origin')
    if (origin) {
      if (!config.allowedOrigins.has(origin)) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendError(res, 403, 'origin_not_allowed', 'This origin is not allowed.')
          return
        }
      } else {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Credentials', 'true')
      }
    }

    if (req.method === 'OPTIONS') {
      if (origin && !config.allowedOrigins.has(origin)) {
        sendError(res, 403, 'origin_not_allowed', 'This origin is not allowed.')
        return
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
      res.setHeader(
        'Access-Control-Allow-Headers',
        'content-type,x-hermes-client,idempotency-key',
      )
      res.setHeader('Access-Control-Max-Age', '600')
      res.status(204).end()
      return
    }
    next()
  })

  app.use((req, res, next) => {
    const startedAt = now()
    res.on('finish', () => {
      logger.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: now() - startedAt,
        },
        'request',
      )
    })
    next()
  })

  const readSession = (req: Request): VerifiedSession | null =>
    verifySessionToken(
      parseCookies(req.headers.cookie)[config.cookieName],
      config.sessionSecret,
      now(),
    )

  const requireSession = (req: Request, res: Response, next: NextFunction): void => {
    const session = readSession(req)
    if (!session) {
      clearSessionCookie(res, config)
      sendError(res, 401, 'unauthorized', 'Sign in with your wallet.')
      return
    }
    ;(req as AuthedRequest).wallet = session.address
    ;(req as AuthedRequest).session = session
    next()
  }

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'hermes-bff',
      readOnly: true,
      chatConfigured: Boolean(config.hermesUserUrl && config.hermesUserApiKey),
    })
  })

  app.get('/api/session', (req, res) => {
    const session = readSession(req)
    if (!session) {
      clearSessionCookie(res, config)
      res.json({ authenticated: false })
      return
    }
    res.json({
      authenticated: true,
      wallet: session.address,
      expiresAt: session.expiresAt,
    })
  })

  app.post('/auth/logout', (_req, res) => {
    clearSessionCookie(res, config)
    res.status(204).end()
  })

  app.post('/auth/siwe/nonce', (req, res) => {
    const limit = nonceLimiter.consume(`nonce:${clientIp(req)}`)
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds))
      sendError(res, 429, 'rate_limited', 'Too many sign-in attempts. Try again shortly.')
      return
    }

    const parsed = nonceBodySchema.safeParse(req.body)
    if (!parsed.success) {
      sendError(res, 400, 'invalid_request', 'A valid wallet address is required.')
      return
    }

    try {
      const entry = nonceStore.issue(parsed.data.address as `0x${string}`)
      const challenge = createSiweChallenge({
        address: entry.address,
        publicOrigin: config.publicOrigin,
        chainId: config.hermes.network.chainId,
        nonce: entry.nonce,
        expiresAt: entry.expiresAt,
        now: now(),
      })
      res.json(challenge)
    } catch (error) {
      logger.warn({ err: error }, 'could not create SIWE challenge')
      sendError(res, 400, 'invalid_address', 'A valid wallet address is required.')
    }
  })

  app.post('/auth/siwe/verify', async (req, res) => {
    const parsed = verifyBodySchema.safeParse(req.body)
    if (!parsed.success) {
      sendError(res, 400, 'invalid_request', 'A SIWE message and signature are required.')
      return
    }

    let parsedMessage: ReturnType<typeof parseSiweMessage>
    try {
      parsedMessage = parseSiweMessage(parsed.data.message)
    } catch {
      sendError(res, 401, 'invalid_signature', 'The sign-in message is incomplete.')
      return
    }
    if (!parsedMessage.nonce) {
      sendError(res, 401, 'invalid_signature', 'The sign-in message is incomplete.')
      return
    }
    const nonce = nonceStore.consume(parsedMessage.nonce)
    if (!nonce) {
      sendError(res, 401, 'invalid_nonce', 'The sign-in challenge is missing or expired.')
      return
    }

    try {
      const address = await verifySiweLogin({
        client: publicClient,
        message: parsed.data.message,
        signature: parsed.data.signature as `0x${string}`,
        publicOrigin: config.publicOrigin,
        chainId: config.hermes.network.chainId,
        nonce,
        now: now(),
      })
      const session = createSessionToken(
        address,
        config.sessionSecret,
        config.sessionTtlSeconds,
        now(),
      )
      res.cookie(config.cookieName, session.token, sessionCookieOptions(config))
      res.json({
        authenticated: true,
        wallet: address,
        expiresAt: session.expiresAt,
      })
    } catch (error) {
      logger.warn({ err: error }, 'SIWE verification failed')
      sendError(res, 401, 'invalid_signature', 'The wallet signature could not be verified.')
    }
  })

  app.get('/api/config', requireSession, (_req, res) => {
    res.json(toJsonValue(reader.configResponse()))
  })

  app.get('/api/treasury', requireSession, async (req, res, next) => {
    try {
      const state = await reader.treasury(requestWallet(req))
      res.json(toJsonValue(state))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/activity', requireSession, async (req, res, next) => {
    try {
      const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 30
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50) : 30
      const types = parseActivityTypes(req.query.types)
      if (req.query.types !== undefined && types === null) {
        sendError(res, 400, 'invalid_request', 'Unknown activity type filter.')
        return
      }
      const result = await reader.activity(
        requestWallet(req),
        limit,
        types ?? undefined,
      )
      res.json(toJsonValue(result))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/cctp/:burnTx', requireSession, async (req, res, next) => {
    const burnTx = String(req.params.burnTx ?? '').toLowerCase()
    if (!TX_RE.test(burnTx)) {
      sendError(res, 400, 'invalid_request', 'A valid burn transaction hash is required.')
      return
    }
    try {
      res.json(toJsonValue(await reader.cctp(burnTx)))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/transfers', requireSession, async (req, res, next) => {
    const burnTx = typeof req.query.burnTx === 'string' ? req.query.burnTx.toLowerCase() : ''
    if (!TX_RE.test(burnTx)) {
      sendError(res, 400, 'invalid_request', 'A valid burn transaction hash is required.')
      return
    }
    try {
      res.json(
        toJsonValue({ transfers: await reader.transfers(burnTx, requestWallet(req)) }),
      )
    } catch (error) {
      if (error instanceof ReadUnavailableError) {
        sendError(res, 503, 'db_unavailable', error.message)
        return
      }
      next(error)
    }
  })

  app.post('/api/chat', requireSession, async (req, res, next) => {
    const wallet = requestWallet(req)
    const limit = chatLimiter.consume(`chat:${wallet.toLowerCase()}`)
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds))
      sendError(res, 429, 'rate_limited', 'Too many chat messages. Try again shortly.')
      return
    }

    const parsed = chatBodySchema.safeParse(req.body)
    if (!parsed.success) {
      sendError(res, 400, 'invalid_request', 'Send one to twenty chat messages.')
      return
    }
    const messages = parsed.data.messages as ChatMessage[]
    if (messages[messages.length - 1]?.role !== 'user') {
      sendError(res, 400, 'invalid_request', 'The last chat message must be from the user.')
      return
    }
    if (totalChatCharacters(messages) > 12_000) {
      sendError(res, 400, 'invalid_request', 'The chat context is too large.')
      return
    }

    const headerKey = req.get('idempotency-key')
    const idempotencyKey = headerKey && IDEMPOTENCY_RE.test(headerKey)
      ? headerKey
      : randomUUID()

    try {
      const result = await requestHermesChat({
        config,
        wallet,
        messages,
        conversationId: parsed.data.conversationId,
        idempotencyKey,
        logger,
        fetchImpl: deps.fetchImpl,
      })
      res.json(result)
    } catch (error) {
      next(error)
    }
  })

  app.use((_req, res) => {
    sendError(res, 404, 'not_found', 'Not found.')
  })

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error)
      return
    }
    if (error instanceof SyntaxError && 'body' in error) {
      sendError(res, 400, 'invalid_json', 'The request body is not valid JSON.')
      return
    }
    if (isBffHttpError(error)) {
      sendError(res, error.status, error.code, error.message)
      return
    }
    logger.error({ err: error }, 'unhandled BFF error')
    sendError(res, 500, 'internal_error', 'Unexpected server error.')
  })

  return {
    app,
    close: async () => {
      await reader.close()
    },
  }
}
