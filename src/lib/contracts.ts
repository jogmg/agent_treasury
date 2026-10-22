/**
 * Contract addresses, ABIs, and chain config for Agent Treasury.
 *
 * Network is selected at build time: `VITE_ARC_NETWORK=mainnet` (default) or
 * `testnet`. Addresses fall back to the verified deployments below and can be
 * overridden with VITE_* env vars.
 */
import { defineChain, parseAbi } from 'viem'

export type ArcNetwork = 'mainnet' | 'testnet'

const ENV_NETWORK = (import.meta.env.VITE_ARC_NETWORK as string | undefined)?.toLowerCase()
export const ARC_NETWORK: ArcNetwork = ENV_NETWORK === 'testnet' ? 'testnet' : 'mainnet'
export const IS_ARC_MAINNET = ARC_NETWORK === 'mainnet'
export const ARC_NETWORK_LABEL = IS_ARC_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'

export const ARC_CHAIN_ID = IS_ARC_MAINNET ? 5042 : 5042002
export const ARC_EXPLORER = IS_ARC_MAINNET ? 'https://explorer.arc.io' : 'https://explorer.testnet.arc.io'
export const ARC_CCTP_DOMAIN = 26

// Arc's public RPC rate-limits aggressively. Fail over across the endpoints
// published in the Arc docs for the selected network.
export const ARC_RPC_URLS = (IS_ARC_MAINNET
  ? [
      'https://rpc.mainnet.arc.io',
      'https://rpc.blockdaemon.mainnet.arc.io',
      'https://rpc.drpc.mainnet.arc.io',
      'https://rpc.quicknode.mainnet.arc.io',
    ]
  : [
      'https://rpc.testnet.arc.io',
      'https://rpc.blockdaemon.testnet.arc.io',
      'https://rpc.drpc.testnet.arc.io',
      'https://rpc.quicknode.testnet.arc.io',
    ]) as readonly string[]

export const ARC_CHAIN = defineChain({
  id: ARC_CHAIN_ID,
  name: IS_ARC_MAINNET ? 'Arc' : 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [...ARC_RPC_URLS] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: ARC_EXPLORER } },
})

const MAINNET_ADDRESSES = {
  usdc:     '0x3600000000000000000000000000000000000000',
  treasury: '0xf71b5d1a19d72b98675785123fae811698be6f63',
  adapter:  '0x5102057330f5bb5f3e4eb0925b7d1eac8a563c23',
  receiver: '0x847F55221F30675791d2fAaf84f93B1fa86399E2', // CCTPReceiverV2 (corrected)
  vault1:   '0x8E357432CC12ff425c36432F312968aEb16112AF', // Galaxy USDC
} as const

const TESTNET_ADDRESSES = {
  usdc:     '0x3600000000000000000000000000000000000000',
  treasury: '0x5e2e3da19533ebf85bc916612eff5cdc7bf4d489',
  adapter:  '0x333deccbf9091540e849b7af80f2f10b72197b71',
  receiver: '0x344466B00BED1BD5bdFa3E21392E776144323f4c', // CCTPReceiverV2 (corrected)
  vault1:   '0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88',
} as const

const BASE_ADDRESSES = IS_ARC_MAINNET ? MAINNET_ADDRESSES : TESTNET_ADDRESSES

export const ADDRESSES = {
  usdc:     (import.meta.env.VITE_USDC_ADDRESS     || BASE_ADDRESSES.usdc) as `0x${string}`,
  treasury: (import.meta.env.VITE_TREASURY_ADDRESS || BASE_ADDRESSES.treasury) as `0x${string}`,
  adapter:  (import.meta.env.VITE_ADAPTER_ADDRESS  || BASE_ADDRESSES.adapter) as `0x${string}`,
  receiver: (import.meta.env.VITE_RECEIVER_ADDRESS || BASE_ADDRESSES.receiver) as `0x${string}`,
  vault1:   (import.meta.env.VITE_VAULT_ADDRESS    || BASE_ADDRESSES.vault1) as `0x${string}`,
}

// AgentTreasury deployment block. Starting the activity scan here avoids
// rescanning Arc's entire history (and hitting eth_getLogs range limits).
// Mainnet: adapter deployed at 27153175. Testnet: hotfix stack at 68193025.
export const ARC_TREASURY_DEPLOY_BLOCK = BigInt(
  (import.meta.env.VITE_TREASURY_DEPLOY_BLOCK as string | undefined) ||
    (IS_ARC_MAINNET ? '27153175' : '68193025'),
)

// The pre-hotfix stack only exists on testnet. Kept for historical reference;
// no mainnet funds were ever held by it.
export const LEGACY_ADDRESSES = {
  treasury: '0x9b390bb10bd30a25b5a07dfb9e0a058d7993ae0d' as `0x${string}`,
  adapter:  '0xe1dafeef6762c672bb5e4a8ff62c3812e111b2e3' as `0x${string}`,
  receiver: '0x7697c83c23339ccfdcf2d8e979b26ee5d731e7ee' as `0x${string}`,
} as const

export const LEGACY_TREASURY_DEPLOY_BLOCK = 68109314n

export const VAULT_1_ID = 1n
export const VAULT_1_NAME = IS_ARC_MAINNET ? 'Galaxy USDC' : 'USDC Core'
export const VAULT_1_TIER = IS_ARC_MAINNET ? 'Galaxy curated · 0 fees' : 'Conservative'
export const VAULT_1_APY_DISPLAY = IS_ARC_MAINNET ? '~2.65%' : '~4.2%'


// ── ABIs ────────────────────────────────────────────────────────────────────

export const TREASURY_ABI = parseAbi([
  'function deposit(uint256 amount) external',
  'function withdrawLocal(uint256 amount) external',
  'function getTotalBalance(address agent) view returns (uint256)',
  'function getPrincipal(address agent) view returns (uint256)',
  'function getVaultShares(address agent) view returns (uint256)',
  'function getActiveVault(address agent) view returns (uint256)',
  'function getDepositsByChain(address agent, uint32 domain) view returns (uint256)',
  'function setYieldStrategy(address agent, uint256 vaultId) external',
  'function setSpendingLimit(address agent, uint256 dailyLimit, uint256 weeklyLimit) external',
  'function requestWithdrawal(address agent, uint256 amount, uint32 destinationDomain, bytes32 mintRecipient) external returns (uint256 withdrawalId)',
  'function setGatewayReceiver(address receiver) external',
  'function gatewayReceiver() view returns (address)',
  'function paused() view returns (bool)',
  'function owner() view returns (address)',
  'function keeper() view returns (address)',
  'function defaultVaultId() view returns (uint256)',
  'function ARC_DOMAIN() view returns (uint32)',
  'function CCTP_MIN_FINALITY_THRESHOLD() view returns (uint32)',
  'function nextWithdrawalId() view returns (uint256)',
  // Events
  'event DepositRecorded(address indexed agent, uint256 amount, uint32 indexed sourceDomain, uint256 vaultId, uint256 shares)',
  'event WithdrawalToWallet(address indexed agent, uint256 amount, uint256 sharesBurned)',
  'event WithdrawalRequested(uint256 indexed id, address indexed agent, uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, bytes32 messageHash)',
  'event WithdrawalExecuted(uint256 indexed id, address indexed agent)',
  'event WithdrawalCancelled(uint256 indexed id, address indexed agent)',
  'event YieldStrategyChanged(address indexed agent, uint256 oldVaultId, uint256 indexed newVaultId)',
  'event Rebalanced(address indexed agent, uint256 indexed vaultId, uint256 shares)',
  'event YieldClaimed(address indexed agent, uint256 amount)',
  'event SpendingLimitSet(address indexed agent, uint256 dailyLimit, uint256 weeklyLimit)',
])

export const CCTP_RECEIVER_ABI = parseAbi([
  // Atomic inbound path: validate -> MessageTransmitterV2.receiveMessage ->
  // transfer to treasury -> recordDeposit(agent, amount, sourceDomain).
  'function receiveAndProcess(bytes message, bytes attestation) external returns (address agent, uint256 amount)',
  // Owner fallback for a message a relayer already delivered to the receiver.
  'function processDeliveredMessage(bytes message) external returns (address agent, uint256 amount)',
  // Owner-only rescue for malformed hook data.
  'function receiveAndRescue(bytes message, bytes attestation, address to) external returns (uint256 amount)',
  'function rescueUSDC(address to, uint256 amount) external',
  'function processedMessages(bytes32 messageHash) view returns (bool)',
  'function paused() view returns (bool)',
  'function treasury() view returns (address)',
  'function trustedTransmitter() view returns (address)',
  'function owner() view returns (address)',
])

export const ADAPTER_ABI = parseAbi([
  // The deployed adapter returns VaultConfig as a SINGLE struct (one tuple
  // output), not six flat values. Declaring six outputs makes viem decode
  // `name` from the vault address and throw IntegerOutOfRangeError.
  'function getVaultConfig(uint256 vaultId) view returns ((uint256 id, address vaultAddress, string name, string symbol, uint256 minDeposit, bool isActive))',
  'function vaultAPY(uint256 vaultId) view returns (uint256)',
  'function totalAssets(uint256 vaultId) view returns (uint256)',
  'function pricePerShare(uint256 vaultId) view returns (uint256)',
  'function previewRedeem(uint256 shares, uint256 vaultId) view returns (uint256)',
  'function treasury() view returns (address)',
  'function keeper() view returns (address)',
])

// Shared Ownable2Step surface for ownership acceptance in Settings.
export const OWNABLE_ABI = parseAbi([
  'function owner() view returns (address)',
  'function pendingOwner() view returns (address)',
  'function acceptOwnership() external',
])

export const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
])

// Vault shares are 18-dec on the real Morpho/Earn Kit vault, unlike 6-dec USDC.
export const VAULT_ABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function previewDeposit(uint256 assets) view returns (uint256 shares)',
  'function previewMint(uint256 shares) view returns (uint256 assets)',
])

// ── Helpers ──────────────────────────────────────────────────────────────────

export function explorerTx(hash: string) {
  return `${ARC_EXPLORER}/tx/${hash}`
}
export function explorerAddr(addr: string) {
  return `${ARC_EXPLORER}/address/${addr}`
}
