import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'

describe('Hermes config', () => {
  it('defaults to mainnet and the launch owner as the tracked agent', () => {
    const config = loadConfig({})
    expect(config.network.network).toBe('mainnet')
    expect(config.network.chainId).toBe(5042)
    expect(config.mcpHost).toBe('127.0.0.1')
    expect(config.monitorHost).toBe('127.0.0.1')
    expect(config.trackedAgents).toEqual([
      '0xD00fD0B006c01342522cAf4FA04D5f8910aB268c',
    ])
  })

  it('honors an explicit RPC and Iris override', () => {
    const config = loadConfig({
      ARC_RPC_URL: 'https://example.invalid/rpc',
      IRIS_API_URL: 'https://example.invalid/iris',
    })
    expect(config.network.rpcUrls[0]).toBe('https://example.invalid/rpc')
    expect(config.network.irisApiUrl).toBe('https://example.invalid/iris')
  })

  it('opts into managed Postgres TLS explicitly', () => {
    expect(loadConfig({}).databaseSsl).toBe(false)
    expect(loadConfig({ DATABASE_SSL: 'true' }).databaseSsl).toBe(true)
    expect(loadConfig({ DATABASE_SSL: 'false' }).databaseSsl).toBe(false)
    expect(loadConfig({ DATABASE_SSL: '' }).databaseSsl).toBe(false)
  })

  it('loads separate MCP scopes', () => {
    const config = loadConfig({
      ARC_MCP_TOKEN_OPS: `ops-${'a'.repeat(40)}`,
      ARC_MCP_TOKEN_USER: `user-${'b'.repeat(40)}`,
    })
    expect(config.mcpTokens).toEqual({
      ops: `ops-${'a'.repeat(40)}`,
      user: `user-${'b'.repeat(40)}`,
    })
  })

  it('rejects placeholder or short MCP tokens', () => {
    expect(() => loadConfig({ ARC_MCP_TOKEN_OPS: 'replace-with-ops-token' })).toThrow(
      'ARC_MCP_TOKEN_OPS must be a random token',
    )
    expect(() => loadConfig({ ARC_MCP_TOKEN_USER: 'short' })).toThrow(
      'ARC_MCP_TOKEN_USER must be a random token',
    )
  })

  it('treats blank optional values as unset', () => {
    const config = loadConfig({
      ARC_RPC_URL: '',
      IRIS_API_URL: '',
      TRACKED_AGENTS: '',
      DATABASE_URL: '',
      DATABASE_SSL: '',
      ARC_MCP_TOKEN_OPS: '',
      ARC_MCP_TOKEN_USER: '',
      DISCORD_WEBHOOK_URL: '',
    })
    expect(config.discordWebhookUrl).toBeUndefined()
    expect(config.databaseUrl).toBeUndefined()
    expect(config.mcpTokens).toEqual({})
    expect(config.trackedAgents).toEqual([
      '0xD00fD0B006c01342522cAf4FA04D5f8910aB268c',
    ])
  })

  it('rejects an invalid tracked agent', () => {
    expect(() => loadConfig({ TRACKED_AGENTS: 'not-an-address' })).toThrow(
      'Invalid tracked agent address',
    )
  })
})
