/**
 * Contract addresses, ABIs, and chain config for Agent Treasury.
 * Hardcoded fallbacks; overrideable via VITE_ env vars.
 */
import { parseAbi } from 'viem'

export const ARC_TESTNET_CHAIN_ID = 5042002
export const ARC_TESTNET_RPC      = 'https://rpc.testnet.arc.io'
export const ARC_EXPLORER         = 'https://explorer.testnet.arc.io'
export const ARC_CCTP_DOMAIN      = 26

// Arc's public RPC rate-limits aggressively. Fail over across the four
// endpoints published in viem's arcTestnet chain definition.
export const ARC_RPC_URLS = [
  ARC_TESTNET_RPC,
  'https://rpc.blockdaemon.testnet.arc.io',
  'https://rpc.drpc.testnet.arc.io',
  'https://rpc.quicknode.testnet.arc.io',
] as const

// AgentTreasury deployment block. Starting the activity scan here avoids
// rescanning Arc's entire history (and hitting eth_getLogs range limits).
// Current deployment (CCTP hotfix): all three contracts were created at block
// 68193025. Keep this in sync with deployments/arc-testnet-fixed.json.
export const ARC_TREASURY_DEPLOY_BLOCK = BigInt(
  (import.meta.env.VITE_TREASURY_DEPLOY_BLOCK as string | undefined) || '68193025',
)

export const ADDRESSES = {
  usdc:     (import.meta.env.VITE_USDC_ADDRESS     || '0x3600000000000000000000000000000000000000') as `0x${string}`,
  treasury: (import.meta.env.VITE_TREASURY_ADDRESS  || '0x5e2e3da19533ebf85bc916612eff5cdc7bf4d489') as `0x${string}`,
  adapter:  (import.meta.env.VITE_ADAPTER_ADDRESS   || '0x333deccbf9091540e849b7af80f2f10b72197b71') as `0x${string}`,
  receiver: (import.meta.env.VITE_RECEIVER_ADDRESS  || '0x8066bcf8e6b17e2d84082179a89f0972cc6e31c1') as `0x${string}`,
  vault1:   '0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88' as `0x${string}`,
}

// The pre-hotfix stack still holds testnet USDC for the owner and one agent.
// `withdrawLocal` on the old treasury works, so the UI exposes a recovery card
// instead of stranding those funds after the address switch.
export const LEGACY_ADDRESSES = {
  treasury: '0x9b390bb10bd30a25b5a07dfb9e0a058d7993ae0d' as `0x${string}`,
  adapter:  '0xe1dafeef6762c672bb5e4a8ff62c3812e111b2e3' as `0x${string}`,
  receiver: '0x7697c83c23339ccfdcf2d8e979b26ee5d731e7ee' as `0x${string}`,
} as const

export const LEGACY_TREASURY_DEPLOY_BLOCK = 68109314n

export const VAULT_1_ID = 1n
export const VAULT_1_NAME = 'USDC Core'
export const VAULT_1_APY_DISPLAY = '~4.2%'

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
])

// ── Helpers ──────────────────────────────────────────────────────────────────

export function explorerTx(hash: string) {
  return `${ARC_EXPLORER}/tx/${hash}`
}
export function explorerAddr(addr: string) {
  return `${ARC_EXPLORER}/address/${addr}`
}
