import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Logger } from 'pino'
import { z } from 'zod'
import { queryActivity, fetchActivityWindow } from '../activity'
import { createArcClient, readTreasuryState } from '../arc'
import { resolveCctpWithdrawal } from '../cctp'
import type { HermesConfig, McpScope } from '../config'
import { toJsonValue, type DbPool } from '../db'
import { openAlerts } from '../monitor/notify'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const TX_RE = /^0x[0-9a-fA-F]{64}$/

function textResult(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(toJsonValue(value), null, 2),
      },
    ],
  }
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  }
}

function requireDb(pool: DbPool | null) {
  if (!pool) return errorResult('DATABASE_URL is not configured on the Arc MCP server.')
  return null
}

function requireOps(scope: McpScope) {
  if (scope !== 'ops') {
    return errorResult('This tool is restricted to the Hermes Ops profile.')
  }
  return null
}

function resolveAgent(config: HermesConfig, agent?: string): `0x${string}` | null {
  const value = agent ?? config.trackedAgents[0]
  if (!value || !ADDRESS_RE.test(value)) return null
  return value as `0x${string}`
}

export function createArcMcpServer(
  config: HermesConfig,
  scope: McpScope,
  pool: DbPool | null,
  logger: Logger,
): McpServer {
  const server = new McpServer({
    name: 'agent-treasury-arc',
    version: '0.1.0',
  })

  server.registerTool(
    'arc_get_config',
    {
      title: 'Get Arc treasury configuration',
      description:
        'Read-only network, chain, contract, and CCTP configuration for this Agent Treasury deployment. Never signs or broadcasts.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () =>
      textResult({
        network: config.network.network,
        chainId: config.network.chainId,
        name: config.network.name,
        explorer: config.network.explorer,
        cctpDomain: config.network.cctpDomain,
        addresses: config.network.addresses,
        deployBlock: config.network.deployBlock.toString(),
        irisApiUrl: config.network.irisApiUrl,
        trackedAgents: config.trackedAgents,
        readOnly: true,
      }),
  )

  server.registerTool(
    'arc_get_treasury_state',
    {
      title: 'Get Arc treasury state',
      description:
        'Read-only balances, principal, vault shares, pause state, owner/keeper, receiver, and deposits by chain for an agent. Use asOfBlock/asOfTime to judge freshness.',
      inputSchema: {
        agent: z.string().regex(ADDRESS_RE).optional().describe('Agent wallet address'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ agent }) => {
      const resolved = resolveAgent(config, agent)
      if (!resolved) return errorResult('A valid agent address is required.')
      try {
        return textResult(await readTreasuryState(config, resolved))
      } catch (error) {
        logger.error({ err: error, agent: resolved }, 'arc_get_treasury_state failed')
        return errorResult(error instanceof Error ? error.message : 'Treasury read failed')
      }
    },
  )

  server.registerTool(
    'arc_list_activity',
    {
      title: 'List treasury activity',
      description:
        'Read-only normalized Arc treasury events (deposits, local withdrawals, CCTP withdrawal requests, yield events). Prefers the Postgres index and falls back to a bounded live scan.',
      inputSchema: {
        agent: z.string().regex(ADDRESS_RE).optional().describe('Filter by agent address'),
        limit: z.number().int().min(1).max(100).optional(),
        types: z
          .array(
            z.enum([
              'DepositRecorded',
              'WithdrawalToWallet',
              'WithdrawalRequested',
              'WithdrawalExecuted',
              'WithdrawalCancelled',
              'YieldStrategyChanged',
              'Rebalanced',
              'YieldClaimed',
              'SpendingLimitSet',
            ]),
          )
          .optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ agent, limit, types }) => {
      const resolved = resolveAgent(config, agent)
      if (!resolved) return errorResult('A valid agent address is required.')
      const requestedLimit = limit ?? 30

      const dbError = requireDb(pool)
      if (!dbError) {
        try {
          const rows = await queryActivity(pool!, {
            agent: resolved,
            types,
            limit: requestedLimit,
          })
          if (rows.length > 0) {
            return textResult({ source: 'postgres', events: rows })
          }
        } catch (error) {
          logger.warn({ err: error }, 'activity query failed; falling back to live scan')
        }
      }

      try {
        const client = createArcClient(config)
        const latest = await client.getBlockNumber()
        const lookback = 100_000n
        const from = latest > lookback ? latest - lookback : config.network.deployBlock
        const events = await fetchActivityWindow(
          config,
          from < config.network.deployBlock ? config.network.deployBlock : from,
          latest,
          resolved,
        )
        return textResult({
          source: 'live',
          fromBlock: from.toString(),
          toBlock: latest.toString(),
          events: events.slice(0, requestedLimit),
        })
      } catch (error) {
        logger.error({ err: error, agent: resolved }, 'arc_list_activity failed')
        return errorResult(error instanceof Error ? error.message : 'Activity read failed')
      }
    },
  )

  server.registerTool(
    'arc_get_cctp_status',
    {
      title: 'Get CCTP withdrawal status',
      description:
        'Read-only CCTP v2 status for an Arc burn: waiting (no complete attestation), ready (attested, destination mint pending), done (destination nonce used), or error. Never trusts AgentTreasury executed bookkeeping.',
      inputSchema: {
        burnTx: z.string().regex(TX_RE).describe('Arc burn transaction hash'),
        sourceDomain: z.number().int().min(0).max(255).optional(),
        checkDestination: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ burnTx, sourceDomain, checkDestination }) => {
      try {
        const status = await resolveCctpWithdrawal(config, burnTx, {
          sourceDomain,
          checkDestination,
        })
        return textResult(status)
      } catch (error) {
        logger.error({ err: error, burnTx }, 'arc_get_cctp_status failed')
        return errorResult(error instanceof Error ? error.message : 'CCTP status failed')
      }
    },
  )

  server.registerTool(
    'arc_get_transfer',
    {
      title: 'Get persisted transfer',
      description:
        'Read-only transfer record from the Hermes Postgres index. Supply a burn tx hash or an Arc withdrawal id.',
      inputSchema: {
        burnTx: z.string().regex(TX_RE).optional(),
        withdrawalId: z.number().int().min(0).optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ burnTx, withdrawalId }) => {
      const dbError = requireDb(pool)
      if (dbError) return dbError
      if (!burnTx && withdrawalId === undefined) {
        return errorResult('Supply burnTx or withdrawalId.')
      }
      const result = await pool!.query(
        `select id, direction, withdrawal_id, burn_tx_hash, burn_block,
                source_domain, destination_domain, amount, nonce, iris_status,
                phase, mint_tx_hash, mint_block, message_hash, last_checked_at,
                completed_at, created_at, raw
           from transfers
          where ($1::text is not null and burn_tx_hash = $1)
             or ($2::bigint is not null and withdrawal_id = $2)
          order by id desc
          limit 5`,
        [burnTx ?? null, withdrawalId ?? null],
      )
      return textResult({ transfers: result.rows })
    },
  )

  server.registerTool(
    'arc_get_bookkeeping_queue',
    {
      title: 'Get withdrawal bookkeeping queue',
      description:
        'Ops-only. Read-only list of CCTP withdrawals that are delivered but still executed=false on-chain. This does not execute bookkeeping.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const opsError = requireOps(scope)
      if (opsError) return opsError
      const dbError = requireDb(pool)
      if (dbError) return dbError
      const result = await pool!.query(
        `select withdrawal_id, burn_tx_hash, executed_on_chain,
                verified_complete_at, keeper_tx_hash, status, updated_at
           from withdrawal_bookkeeping
          where executed_on_chain = false
            and status = 'ready_for_keeper'
          order by verified_complete_at asc nulls last
          limit 100`,
      )
      return textResult({ queued: result.rows })
    },
  )

  server.registerTool(
    'arc_get_incidents',
    {
      title: 'Get open incidents',
      description:
        'Ops-only. Read-only open monitor alerts, including severity, subject, and the last delivery time.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ limit }) => {
      const opsError = requireOps(scope)
      if (opsError) return opsError
      const dbError = requireDb(pool)
      if (dbError) return dbError
      return textResult({ incidents: await openAlerts(pool!, limit ?? 30) })
    },
  )

  logger.info({ scope, tools: 7 }, 'Arc MCP tools registered')
  return server
}
