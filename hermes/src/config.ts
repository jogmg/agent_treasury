import { z } from 'zod'

export type ArcNetwork = 'mainnet' | 'testnet'
export type McpScope = 'user' | 'ops'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

export interface NetworkConfig {
  network: ArcNetwork
  chainId: number
  name: string
  explorer: string
  rpcUrls: string[]
  irisApiUrl: string
  cctpDomain: 26
  addresses: {
    usdc: `0x${string}`
    treasury: `0x${string}`
    adapter: `0x${string}`
    receiver: `0x${string}`
    vault1: `0x${string}`
  }
  deployBlock: bigint
  tokenMessengerV2: `0x${string}`
  messageTransmitterV2: `0x${string}`
}

const NETWORKS: Record<ArcNetwork, NetworkConfig> = {
  mainnet: {
    network: 'mainnet',
    chainId: 5042,
    name: 'Arc',
    explorer: 'https://explorer.arc.io',
    rpcUrls: [
      'https://rpc.mainnet.arc.io',
      'https://rpc.blockdaemon.mainnet.arc.io',
      'https://rpc.drpc.mainnet.arc.io',
      'https://rpc.quicknode.mainnet.arc.io',
    ],
    irisApiUrl: 'https://iris-api.circle.com',
    cctpDomain: 26,
    addresses: {
      usdc: '0x3600000000000000000000000000000000000000',
      treasury: '0xf71b5d1a19d72b98675785123fae811698be6f63',
      adapter: '0x5102057330f5bb5f3e4eb0925b7d1eac8a563c23',
      receiver: '0x847F55221F30675791d2fAaf84f93B1fa86399E2',
      vault1: '0x8E357432CC12ff425c36432F312968aEb16112AF',
    },
    deployBlock: 27_153_175n,
    tokenMessengerV2: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
    messageTransmitterV2: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
  },
  testnet: {
    network: 'testnet',
    chainId: 5_042_002,
    name: 'Arc Testnet',
    explorer: 'https://explorer.testnet.arc.io',
    rpcUrls: [
      'https://rpc.testnet.arc.io',
      'https://rpc.blockdaemon.testnet.arc.io',
      'https://rpc.drpc.testnet.arc.io',
      'https://rpc.quicknode.testnet.arc.io',
    ],
    irisApiUrl: 'https://iris-api-sandbox.circle.com',
    cctpDomain: 26,
    addresses: {
      usdc: '0x3600000000000000000000000000000000000000',
      treasury: '0x5e2e3da19533ebf85bc916612eff5cdc7bf4d489',
      adapter: '0x333deccbf9091540e849b7af80f2f10b72197b71',
      receiver: '0x344466B00BED1BD5bdFa3E21392E776144323f4c',
      vault1: '0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88',
    },
    deployBlock: 68_193_025n,
    tokenMessengerV2: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    messageTransmitterV2: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
  },
}

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

const optionalString = z.preprocess(emptyToUndefined, z.string().optional())
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional())

const envSchema = z.object({
  ARC_NETWORK: z.enum(['mainnet', 'testnet']).default('mainnet'),
  ARC_RPC_URL: optionalUrl,
  IRIS_API_URL: optionalUrl,
  TRACKED_AGENTS: optionalString,
  DATABASE_URL: optionalString,
  DATABASE_SSL: z.preprocess(emptyToUndefined, z.enum(['true', 'false']).optional()),
  ARC_MCP_TOKEN_OPS: optionalString,
  ARC_MCP_TOKEN_USER: optionalString,
  ARC_MCP_PORT: z.coerce.number().int().positive().default(8788),
  MCP_HOST: optionalString,
  MONITOR_PORT: z.coerce.number().int().positive().default(8787),
  MONITOR_HOST: optionalString,
  MONITOR_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  INDEX_CHUNKS_PER_RUN: z.coerce.number().int().positive().default(20),
  ALERT_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(3600),
  DISCORD_WEBHOOK_URL: optionalUrl,
  LOG_LEVEL: z.string().default('info'),
})

export interface HermesConfig {
  network: NetworkConfig
  trackedAgents: `0x${string}`[]
  databaseUrl: string | undefined
  databaseSsl: boolean
  mcpTokens: Partial<Record<McpScope, string>>
  mcpPort: number
  mcpHost: string
  monitorPort: number
  monitorHost: string
  monitorIntervalMs: number
  indexChunksPerRun: number
  alertCooldownSeconds: number
  discordWebhookUrl: string | undefined
  logLevel: string
}

function validateMcpToken(name: string, value: string | undefined): void {
  if (!value) return
  if (value.length < 32 || value.startsWith('replace-with-')) {
    throw new Error(
      `${name} must be a random token of at least 32 characters (for example: openssl rand -hex 32)`,
    )
  }
}

function parseAddressList(value: string | undefined, fallback: string): `0x${string}`[] {
  const raw = (value ?? fallback)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  for (const address of raw) {
    if (!ADDRESS_RE.test(address)) {
      throw new Error(`Invalid tracked agent address: ${address}`)
    }
  }
  return raw as `0x${string}`[]
}

/**
 * Load and validate runtime configuration. Kept as a function (not a module
 * singleton) so tests and one-shot CLI commands can pass explicit env values.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): HermesConfig {
  const parsed = envSchema.parse(env)
  const base = NETWORKS[parsed.ARC_NETWORK]

  const rpcUrls = parsed.ARC_RPC_URL
    ? [parsed.ARC_RPC_URL, ...base.rpcUrls.filter((url) => url !== parsed.ARC_RPC_URL)]
    : base.rpcUrls

  validateMcpToken('ARC_MCP_TOKEN_OPS', parsed.ARC_MCP_TOKEN_OPS)
  validateMcpToken('ARC_MCP_TOKEN_USER', parsed.ARC_MCP_TOKEN_USER)

  const mcpTokens: Partial<Record<McpScope, string>> = {}
  if (parsed.ARC_MCP_TOKEN_OPS) mcpTokens.ops = parsed.ARC_MCP_TOKEN_OPS
  if (parsed.ARC_MCP_TOKEN_USER) mcpTokens.user = parsed.ARC_MCP_TOKEN_USER

  return {
    network: {
      ...base,
      rpcUrls,
      irisApiUrl: parsed.IRIS_API_URL ?? base.irisApiUrl,
    },
    // The launch owner is the default tracked agent. Override with a
    // comma-separated TRACKED_AGENTS list as more agents are onboarded.
    trackedAgents: parseAddressList(
      parsed.TRACKED_AGENTS,
      '0xD00fD0B006c01342522cAf4FA04D5f8910aB268c',
    ),
    databaseUrl: parsed.DATABASE_URL,
    databaseSsl: parsed.DATABASE_SSL === 'true',
    mcpTokens,
    mcpPort: parsed.ARC_MCP_PORT,
    mcpHost: parsed.MCP_HOST ?? '127.0.0.1',
    monitorPort: parsed.MONITOR_PORT,
    monitorHost: parsed.MONITOR_HOST ?? '127.0.0.1',
    monitorIntervalMs: parsed.MONITOR_INTERVAL_SECONDS * 1_000,
    indexChunksPerRun: parsed.INDEX_CHUNKS_PER_RUN,
    alertCooldownSeconds: parsed.ALERT_COOLDOWN_SECONDS,
    discordWebhookUrl: parsed.DISCORD_WEBHOOK_URL,
    logLevel: parsed.LOG_LEVEL,
  }
}

export function explorerTx(config: HermesConfig, hash: string): string {
  return `${config.network.explorer}/tx/${hash}`
}

export function explorerAddress(config: HermesConfig, address: string): string {
  return `${config.network.explorer}/address/${address}`
}

export const NETWORK_CONFIGS = NETWORKS
