import {
  createPublicClient,
  defineChain,
  fallback,
  formatUnits,
  http,
  type PublicClient,
} from 'viem'
import { ADAPTER_ABI, ERC20_ABI, TREASURY_ABI } from './abis'
import type { HermesConfig } from './config'

const TRACKED_DOMAINS = [0, 1, 2, 3, 6, 7, 26] as const

export function arcChain(config: HermesConfig) {
  return defineChain({
    id: config.network.chainId,
    name: config.network.name,
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [...config.network.rpcUrls] } },
    blockExplorers: {
      default: { name: 'Arc Explorer', url: config.network.explorer },
    },
  })
}

export function createArcClient(config: HermesConfig): PublicClient {
  return createPublicClient({
    chain: arcChain(config),
    transport: fallback(
      config.network.rpcUrls.map((url) =>
        http(url, { timeout: 15_000, retryCount: 1 }),
      ),
      { rank: false },
    ),
  })
}

async function readOrNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch {
    return null
  }
}

export function usdc(value: bigint | null | undefined): string | null {
  return value === null || value === undefined ? null : formatUnits(value, 6)
}

export interface TreasuryState {
  network: string
  chainId: number
  treasury: string
  agent: string
  asOfBlock: string
  asOfTime: string
  paused: boolean | null
  owner: string | null
  keeper: string | null
  gatewayReceiver: string | null
  defaultVaultId: string | null
  cctpDomain: number | null
  nextWithdrawalId: string | null
  principal: string | null
  principalUsdc: string | null
  totalBalance: string | null
  totalBalanceUsdc: string | null
  vaultShares: string | null
  activeVaultId: string | null
  idleUsdc: string | null
  idleUsdcDisplay: string | null
  treasuryUsdcBalance: string | null
  treasuryUsdcBalanceDisplay: string | null
  agentUsdcBalance: string | null
  agentUsdcBalanceDisplay: string | null
  depositsByChain: Record<string, string>
  vault: {
    id: string
    address: string
    name: string
    symbol: string
    minDeposit: string
    minDepositUsdc: string
    isActive: boolean
    apyRaw: string | null
    apyPercent: number | null
    previewRedeem: string | null
    previewRedeemUsdc: string | null
  } | null
  warnings: string[]
}

export async function readTreasuryState(
  config: HermesConfig,
  agent: `0x${string}`,
): Promise<TreasuryState> {
  const client = createArcClient(config)
  const { treasury, adapter, usdc: usdcAddress, vault1 } = config.network.addresses

  const [blockNumber, paused, owner, keeper, gatewayReceiver, defaultVaultId, cctpDomain, nextWithdrawalId, principal, totalBalance, vaultShares, activeVaultId, treasuryUsdcBalance, agentUsdcBalance] =
    await Promise.all([
      readOrNull(() => client.getBlockNumber()),
      readOrNull(() => client.readContract({ address: treasury, abi: TREASURY_ABI, functionName: 'paused' })),
      readOrNull(() => client.readContract({ address: treasury, abi: TREASURY_ABI, functionName: 'owner' })),
      readOrNull(() => client.readContract({ address: treasury, abi: TREASURY_ABI, functionName: 'keeper' })),
      readOrNull(() => client.readContract({ address: treasury, abi: TREASURY_ABI, functionName: 'gatewayReceiver' })),
      readOrNull(() => client.readContract({ address: treasury, abi: TREASURY_ABI, functionName: 'defaultVaultId' })),
      readOrNull(() => client.readContract({ address: treasury, abi: TREASURY_ABI, functionName: 'ARC_DOMAIN' })),
      readOrNull(() => client.readContract({ address: treasury, abi: TREASURY_ABI, functionName: 'nextWithdrawalId' })),
      readOrNull(() => client.readContract({ address: treasury, abi: TREASURY_ABI, functionName: 'getPrincipal', args: [agent] })),
      readOrNull(() => client.readContract({ address: treasury, abi: TREASURY_ABI, functionName: 'getTotalBalance', args: [agent] })),
      readOrNull(() => client.readContract({ address: treasury, abi: TREASURY_ABI, functionName: 'getVaultShares', args: [agent] })),
      readOrNull(() => client.readContract({ address: treasury, abi: TREASURY_ABI, functionName: 'getActiveVault', args: [agent] })),
      readOrNull(() => client.readContract({ address: usdcAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [treasury] })),
      readOrNull(() => client.readContract({ address: usdcAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [agent] })),
    ])

  // Use the block timestamp, not wall-clock time, so the monitor's
  // stale-snapshot rule detects a stalled Arc RPC instead of always passing.
  const latestBlock =
    blockNumber === null
      ? null
      : await readOrNull(() => client.getBlock({ blockNumber: blockNumber as bigint }))

  const depositsByChain: Record<string, string> = {}
  await Promise.all(
    TRACKED_DOMAINS.map(async (domain) => {
      const value = await readOrNull(() =>
        client.readContract({
          address: treasury,
          abi: TREASURY_ABI,
          functionName: 'getDepositsByChain',
          args: [agent, domain],
        }),
      )
      if (value !== null) depositsByChain[String(domain)] = value.toString()
    }),
  )

  const vaultConfig = await readOrNull(() =>
    client.readContract({
      address: adapter,
      abi: ADAPTER_ABI,
      functionName: 'getVaultConfig',
      args: [1n],
    }),
  )
  const apyRaw = await readOrNull(() =>
    client.readContract({
      address: adapter,
      abi: ADAPTER_ABI,
      functionName: 'vaultAPY',
      args: [1n],
    }),
  )
  const previewRedeem = vaultShares
    ? await readOrNull(() =>
        client.readContract({
          address: adapter,
          abi: ADAPTER_ABI,
          functionName: 'previewRedeem',
          args: [vaultShares, 1n],
        }),
      )
    : null

  const warnings: string[] = []
  if (paused === null) warnings.push('Could not read treasury.paused()')
  if (principal === null) warnings.push('Could not read getPrincipal(agent)')
  if (totalBalance === null) warnings.push('Could not read getTotalBalance(agent)')
  if (vaultConfig === null) warnings.push('Could not read adapter.getVaultConfig(1)')
  const expectedVault = vault1.toLowerCase()
  if (vaultConfig && vaultConfig.vaultAddress.toLowerCase() !== expectedVault) {
    warnings.push(
      `Configured vault ${vaultConfig.vaultAddress} does not match the build address ${vault1}`,
    )
  }

  return {
    network: config.network.name,
    chainId: config.network.chainId,
    treasury,
    agent,
    asOfBlock: blockNumber?.toString() ?? '0',
    asOfTime: latestBlock
      ? new Date(Number(latestBlock.timestamp) * 1000).toISOString()
      : new Date().toISOString(),
    paused,
    owner,
    keeper,
    gatewayReceiver,
    defaultVaultId: defaultVaultId?.toString() ?? null,
    cctpDomain: cctpDomain === null ? null : Number(cctpDomain),
    nextWithdrawalId: nextWithdrawalId?.toString() ?? null,
    principal: principal?.toString() ?? null,
    principalUsdc: usdc(principal),
    totalBalance: totalBalance?.toString() ?? null,
    totalBalanceUsdc: usdc(totalBalance),
    vaultShares: vaultShares?.toString() ?? null,
    activeVaultId: activeVaultId?.toString() ?? null,
    idleUsdc: treasuryUsdcBalance?.toString() ?? null,
    idleUsdcDisplay: usdc(treasuryUsdcBalance),
    treasuryUsdcBalance: treasuryUsdcBalance?.toString() ?? null,
    treasuryUsdcBalanceDisplay: usdc(treasuryUsdcBalance),
    agentUsdcBalance: agentUsdcBalance?.toString() ?? null,
    agentUsdcBalanceDisplay: usdc(agentUsdcBalance),
    depositsByChain,
    vault: vaultConfig
      ? {
          id: vaultConfig.id.toString(),
          address: vaultConfig.vaultAddress,
          name: vaultConfig.name,
          symbol: vaultConfig.symbol,
          minDeposit: vaultConfig.minDeposit.toString(),
          minDepositUsdc: usdc(vaultConfig.minDeposit) ?? '0',
          isActive: vaultConfig.isActive,
          apyRaw: apyRaw?.toString() ?? null,
          apyPercent: apyRaw === null ? null : Number(apyRaw) / 1e16,
          previewRedeem: previewRedeem?.toString() ?? null,
          previewRedeemUsdc: usdc(previewRedeem),
        }
      : null,
    warnings,
  }
}

export interface WithdrawalRecord {
  id: string
  agent: string
  amount: string
  amountUsdc: string
  destinationDomain: number
  mintRecipient: string
  requestTime: string
  burnedShares: string
  messageHash: string
  executed: boolean
  cancelled: boolean
}

export async function readWithdrawal(
  config: HermesConfig,
  id: bigint,
): Promise<WithdrawalRecord | null> {
  const client = createArcClient(config)
  const record = await readOrNull(() =>
    client.readContract({
      address: config.network.addresses.treasury,
      abi: TREASURY_ABI,
      functionName: 'getWithdrawal',
      args: [id],
    }),
  )
  if (!record) return null
  return {
    id: record.id.toString(),
    agent: record.agent,
    amount: record.amount.toString(),
    amountUsdc: usdc(record.amount) ?? '0',
    destinationDomain: Number(record.destinationDomain),
    mintRecipient: record.mintRecipient,
    requestTime: record.requestTime.toString(),
    burnedShares: record.burnedShares.toString(),
    messageHash: record.messageHash,
    executed: record.executed,
    cancelled: record.cancelled,
  }
}
