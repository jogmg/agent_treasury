import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import pino from 'pino'
import { loadConfig, type McpScope } from '../src/config'
import { createArcMcpServer } from '../src/mcp/tools'

const logger = pino({ level: 'silent' })
const config = loadConfig({})

const open: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  while (open.length) {
    const item = open.pop()
    if (item) await item.close()
  }
})

async function connect(scope: McpScope) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createArcMcpServer(config, scope, null, logger)
  const client = new Client({ name: 'test-client', version: '0.1.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  open.push({ close: () => client.close() })
  open.push({ close: () => server.close() })
  return client
}

function text(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content
  if (!Array.isArray(content) || content.length === 0) return ''
  const first = content.find((entry) => entry.type === 'text')
  return first && first.type === 'text' ? first.text : ''
}

describe('Arc MCP tools', () => {
  it('registers the seven read-only tools', async () => {
    const client = await connect('ops')
    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'arc_get_bookkeeping_queue',
      'arc_get_cctp_status',
      'arc_get_config',
      'arc_get_incidents',
      'arc_get_transfer',
      'arc_get_treasury_state',
      'arc_list_activity',
    ])
  })

  it('returns config without a database', async () => {
    const client = await connect('user')
    const result = await client.callTool({ name: 'arc_get_config', arguments: {} })
    expect(result.isError).toBeFalsy()
    const body = JSON.parse(text(result)) as {
      chainId: number
      cctpDomain: number
      readOnly: boolean
    }
    expect(body.chainId).toBe(5042)
    expect(body.cctpDomain).toBe(26)
    expect(body.readOnly).toBe(true)
  })

  it('blocks ops-only tools for the user scope', async () => {
    const client = await connect('user')
    const result = await client.callTool({
      name: 'arc_get_bookkeeping_queue',
      arguments: {},
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('restricted to the Hermes Ops profile')
  })

  it('allows ops to reach the database guard', async () => {
    const client = await connect('ops')
    const result = await client.callTool({
      name: 'arc_get_bookkeeping_queue',
      arguments: {},
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('DATABASE_URL is not configured')
  })
})
