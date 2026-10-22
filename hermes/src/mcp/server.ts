import express, { type NextFunction, type Request, type Response } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import pino from 'pino'
import { loadConfig, type HermesConfig, type McpScope } from '../config'
import { createPool, type DbPool } from '../db'
import { createArcMcpServer } from './tools'

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'hermes-arc-mcp' },
})

interface ScopedRequest extends Request {
  mcpScope?: McpScope
}

function tokenMap(config: HermesConfig): Map<string, McpScope> {
  const map = new Map<string, McpScope>()
  if (config.mcpTokens.ops) map.set(config.mcpTokens.ops, 'ops')
  if (config.mcpTokens.user) {
    if (map.has(config.mcpTokens.user)) {
      throw new Error('ARC_MCP_TOKEN_OPS and ARC_MCP_TOKEN_USER must be different')
    }
    map.set(config.mcpTokens.user, 'user')
  }
  if (map.size === 0) {
    throw new Error(
      'No MCP tokens configured. Set ARC_MCP_TOKEN_OPS and/or ARC_MCP_TOKEN_USER.',
    )
  }
  return map
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}

function createApp(config: HermesConfig, pool: DbPool | null): express.Express {
  const tokens = tokenMap(config)
  const app = express()
  app.disable('x-powered-by')

  app.get('/health', async (_req, res) => {
    let database = 'not-configured'
    if (pool) {
      try {
        await pool.query('select 1')
        database = 'ok'
      } catch {
        database = 'down'
      }
    }
    res.status(database === 'down' ? 503 : 200).json({
      ok: database !== 'down',
      service: 'hermes-arc-mcp',
      network: config.network.network,
      chainId: config.network.chainId,
      database,
      readOnly: true,
    })
  })

  app.get('/', (_req, res) => {
    res.json({
      service: 'hermes-arc-mcp',
      transport: 'streamable-http',
      endpoint: '/mcp',
      readOnly: true,
    })
  })

  app.use('/mcp', (req: ScopedRequest, res: Response, next: NextFunction) => {
    const token = bearerToken(req.header('authorization'))
    const scope = token ? tokens.get(token) : undefined
    if (!scope) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    req.mcpScope = scope
    next()
  })

  // Authenticate before parsing a request body. Unauthenticated callers should
  // get 401 even if they send malformed JSON.
  app.use(express.json({ limit: '1mb' }))

  app.post('/mcp', async (req: ScopedRequest, res: Response) => {
    const scope = req.mcpScope
    if (!scope) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    const server = createArcMcpServer(config, scope, pool, logger)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })

    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      logger.error({ err: error, scope }, 'MCP request failed')
      if (!res.headersSent) {
        res.status(500).json({ error: 'internal_error' })
      }
    } finally {
      // Stateless JSON responses finish inside handleRequest. Close both sides
      // here so an aborted or failed request cannot leak a server/transport.
      await transport.close().catch(() => undefined)
      await server.close().catch(() => undefined)
    }
  })

  app.all('/mcp', (_req, res) => {
    res.status(405).json({ error: 'method_not_allowed' })
  })

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? Number((error as { status?: number }).status)
        : 500
    const code = Number.isFinite(status) && status >= 400 && status < 500 ? status : 500
    if (!res.headersSent) {
      res.status(code).json({ error: code === 400 ? 'invalid_json' : 'internal_error' })
    }
  })

  return app
}

async function main(): Promise<void> {
  const config = loadConfig()
  const pool = createPool(config)
  const app = createApp(config, pool)

  const server = app.listen(config.mcpPort, config.mcpHost, () => {
    logger.info(
      {
        port: config.mcpPort,
        network: config.network.network,
        database: Boolean(pool),
      },
      'Hermes Arc MCP listening',
    )
  })

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Arc MCP shutting down')
    server.close()
    if (pool) await pool.end()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Arc MCP failed to start')
  process.exitCode = 1
})
