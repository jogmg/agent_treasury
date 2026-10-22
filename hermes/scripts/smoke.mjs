#!/usr/bin/env node
/**
 * Read-only connectivity smoke test for the Arc MCP server.
 *
 *   ARC_MCP_URL=http://127.0.0.1:8788/mcp \
 *   ARC_MCP_TOKEN_OPS=... \
 *   node scripts/smoke.mjs
 *
 * It calls only read tools. It never signs or writes.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const url = new URL(process.env.ARC_MCP_URL ?? 'http://127.0.0.1:8788/mcp')
const token = process.env.ARC_MCP_TOKEN_OPS ?? process.env.ARC_MCP_TOKEN_USER
if (!token) {
  console.error('Set ARC_MCP_TOKEN_OPS or ARC_MCP_TOKEN_USER')
  process.exit(1)
}

const transport = new StreamableHTTPClientTransport(url, {
  requestInit: {
    headers: { Authorization: `Bearer ${token}` },
  },
})

const client = new Client({ name: 'arc-mcp-smoke', version: '0.1.0' })

function payload(result) {
  const content = result?.content
  if (!Array.isArray(content) || content.length === 0) return result
  const first = content.find((entry) => entry.type === 'text')
  if (!first) return result
  try {
    return JSON.parse(first.text)
  } catch {
    return first.text
  }
}

function assertOk(result, name) {
  if (result?.isError) {
    throw new Error(`${name} returned isError: ${payload(result)}`)
  }
  return payload(result)
}

try {
  await client.connect(transport)
  console.log(`Connected to ${url.href}`)

  const tools = await client.listTools()
  console.log(
    'Tools:',
    tools.tools.map((tool) => tool.name).join(', '),
  )

  const config = assertOk(await client.callTool({ name: 'arc_get_config', arguments: {} }), 'config')
  console.log('Config:', {
    network: config.network,
    chainId: config.chainId,
    treasury: config.addresses?.treasury,
    cctpDomain: config.cctpDomain,
    readOnly: config.readOnly,
  })

  const state = assertOk(
    await client.callTool({ name: 'arc_get_treasury_state', arguments: {} }),
    'state',
  )
  console.log('Treasury:', {
    asOfBlock: state.asOfBlock,
    asOfTime: state.asOfTime,
    asOfAgeSeconds: Math.round((Date.now() - Date.parse(state.asOfTime)) / 1000),
    paused: state.paused,
    principalUsdc: state.principalUsdc,
    totalBalanceUsdc: state.totalBalanceUsdc,
    activeVaultId: state.activeVaultId,
    keeper: state.keeper,
    owner: state.owner,
  })

  const activity = assertOk(
    await client.callTool({
      name: 'arc_list_activity',
      arguments: { limit: 5 },
    }),
    'activity',
  )
  console.log('Activity:', {
    source: activity.source,
    count: activity.events?.length ?? 0,
    newest: activity.events?.[0]?.type,
  })

  const burnTx =
    process.env.SMOKE_BURN_TX ??
    '0x79006af075136d77abb5724fc1124e7ee2b61c8a58ceea3cd943e50423042b13'
  const transfer = assertOk(
    await client.callTool({
      name: 'arc_get_cctp_status',
      arguments: { burnTx },
    }),
    'cctp-status',
  )
  console.log('CCTP id 3 burn:', {
    phase: transfer.phase,
    sourceDomain: transfer.sourceDomain,
    destinationDomain: transfer.destinationDomain,
    amountUsdc: transfer.amountUsdc,
    mintTxHash: transfer.mintTxHash ?? null,
    attestationComplete: transfer.attestationComplete,
    delivered: transfer.delivered,
    error: transfer.error,
  })

  if (process.env.ARC_MCP_SMOKE_DB === '1') {
    const queue = assertOk(
      await client.callTool({ name: 'arc_get_bookkeeping_queue', arguments: {} }),
      'bookkeeping-queue',
    )
    console.log('Bookkeeping queue:', {
      count: queue.queued?.length ?? 0,
      withdrawalIds: queue.queued?.map((row) => row.withdrawal_id),
      statuses: [...new Set(queue.queued?.map((row) => row.status) ?? [])],
    })

    const persisted = assertOk(
      await client.callTool({
        name: 'arc_get_transfer',
        arguments: { withdrawalId: 3 },
      }),
      'persisted-transfer',
    )
    console.log('Persisted id 3:', {
      count: persisted.transfers?.length ?? 0,
      phase: persisted.transfers?.[0]?.phase,
      burnTxHash: persisted.transfers?.[0]?.burn_tx_hash,
    })

    const incidents = assertOk(
      await client.callTool({ name: 'arc_get_incidents', arguments: { limit: 10 } }),
      'incidents',
    )
    console.log('Open incidents:', {
      count: incidents.incidents?.length ?? 0,
      kinds: incidents.incidents?.map((row) => row.kind),
    })
  }

  await client.close()
  console.log('Smoke test passed (read-only).')
} catch (error) {
  console.error('Smoke test failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
}
