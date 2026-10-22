import { parseAbi, parseAbiItem } from 'viem'

export const TREASURY_ABI = parseAbi([
  'function getTotalBalance(address agent) view returns (uint256)',
  'function getPrincipal(address agent) view returns (uint256)',
  'function getVaultShares(address agent) view returns (uint256)',
  'function getActiveVault(address agent) view returns (uint256)',
  'function getDepositsByChain(address agent, uint32 domain) view returns (uint256)',
  'function getWithdrawal(uint256 id) view returns ((uint256 id, address agent, uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, uint256 requestTime, uint256 burnedShares, bytes message, bytes32 messageHash, bool executed, bool cancelled))',
  'function gatewayReceiver() view returns (address)',
  'function paused() view returns (bool)',
  'function owner() view returns (address)',
  'function keeper() view returns (address)',
  'function defaultVaultId() view returns (uint256)',
  'function ARC_DOMAIN() view returns (uint32)',
  'function CCTP_MIN_FINALITY_THRESHOLD() view returns (uint32)',
  'function nextWithdrawalId() view returns (uint256)',
])

export const ADAPTER_ABI = parseAbi([
  'function getVaultConfig(uint256 vaultId) view returns ((uint256 id, address vaultAddress, string name, string symbol, uint256 minDeposit, bool isActive))',
  'function vaultAPY(uint256 vaultId) view returns (uint256)',
  'function totalAssets(uint256 vaultId) view returns (uint256)',
  'function pricePerShare(uint256 vaultId) view returns (uint256)',
  'function previewRedeem(uint256 shares, uint256 vaultId) view returns (uint256)',
])

export const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
])

export const MESSAGE_TRANSMITTER_V2_ABI = parseAbi([
  'function usedNonces(bytes32 nonce) external view returns (uint256)',
])

export const MESSAGE_RECEIVED_EVENT = parseAbiItem(
  'event MessageReceived(address indexed caller, uint32 sourceDomain, bytes32 indexed nonce, bytes32 sender, uint32 indexed finalityThresholdExecuted, bytes messageBody)',
)

export const ACTIVITY_EVENT_ABI = {
  DepositRecorded: parseAbiItem(
    'event DepositRecorded(address indexed agent, uint256 amount, uint32 indexed sourceDomain, uint256 vaultId, uint256 shares)',
  ),
  WithdrawalToWallet: parseAbiItem(
    'event WithdrawalToWallet(address indexed agent, uint256 amount, uint256 sharesBurned)',
  ),
  WithdrawalRequested: parseAbiItem(
    'event WithdrawalRequested(uint256 indexed id, address indexed agent, uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, bytes32 messageHash)',
  ),
  WithdrawalExecuted: parseAbiItem(
    'event WithdrawalExecuted(uint256 indexed id, address indexed agent)',
  ),
  WithdrawalCancelled: parseAbiItem(
    'event WithdrawalCancelled(uint256 indexed id, address indexed agent)',
  ),
  YieldStrategyChanged: parseAbiItem(
    'event YieldStrategyChanged(address indexed agent, uint256 oldVaultId, uint256 indexed newVaultId)',
  ),
  Rebalanced: parseAbiItem(
    'event Rebalanced(address indexed agent, uint256 indexed vaultId, uint256 shares)',
  ),
  YieldClaimed: parseAbiItem(
    'event YieldClaimed(address indexed agent, uint256 amount)',
  ),
  SpendingLimitSet: parseAbiItem(
    'event SpendingLimitSet(address indexed agent, uint256 dailyLimit, uint256 weeklyLimit)',
  ),
} as const

export type ActivityEventType = keyof typeof ACTIVITY_EVENT_ABI
export const ACTIVITY_EVENTS = Object.values(ACTIVITY_EVENT_ABI)
export const ACTIVITY_EVENT_TYPES = new Set<string>(Object.keys(ACTIVITY_EVENT_ABI))
