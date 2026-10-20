import { create } from 'zustand'

export interface TreasuryState {
  // Balances
  totalBalance:    bigint
  principal:       bigint
  vaultShares:     bigint
  activeVaultId:   bigint
  usdcBalance:     bigint   // wallet ERC-20 balance
  usdcBalanceLoaded: boolean // true once balanceOf has succeeded at least once
  usdcAllowance:   bigint
  // Vault / adapter
  vaultApy:        bigint   // 1e18-scaled
  vaultTvl:        bigint
  pricePerShare:   bigint   // 1e18-scaled
  vaultShareDecimals: number // 18 for Morpho/Earn Kit, not USDC's 6
  // Contract meta
  isPaused:        boolean
  ownerAddr:       string
  keeperAddr:      string
  // Loading
  isFetching:      boolean
  lastFetched:     number   // ms timestamp
  // Setters
  set: (patch: Partial<TreasuryState>) => void
}

export const useTreasuryStore = create<TreasuryState>((setState) => ({
  totalBalance:  0n,
  principal:     0n,
  vaultShares:   0n,
  activeVaultId: 0n,
  usdcBalance:   0n,
  usdcBalanceLoaded: false,
  usdcAllowance: 0n,
  vaultApy:      0n,
  vaultTvl:      0n,
  pricePerShare:  BigInt('1000000000000000000'),
  vaultShareDecimals: 18,
  isPaused:      false,
  ownerAddr:     '',
  keeperAddr:    '',
  isFetching:    false,
  lastFetched:   0,
  set: (patch) => setState((s) => ({ ...s, ...patch })),
}))
