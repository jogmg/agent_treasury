/**
 * ERC-4626 share pre-check for deposits. With 18-decimal shares and 6-decimal
 * USDC, a deposit only rounds to zero if the vault's value per share rises
 * enormously — but the failure is silent (assets accepted, no claim minted),
 * so the UI blocks it up front and shows the smallest amount that mints a
 * share. The adapter enforces the same rule on-chain.
 */
import { useReadContract } from 'wagmi'
import { ADDRESSES, ARC_TESTNET_CHAIN_ID, VAULT_ABI } from '../lib/contracts'

export interface DepositShareCheck {
  /** Shares the vault would mint for this amount; undefined until resolved. */
  shares: bigint | undefined
  /** True only when the amount is positive and the vault would mint 0 shares. */
  zeroShares: boolean
  /** Assets needed to mint one share, when the vault reports it. */
  oneShareAssets: bigint | undefined
}

export function useDepositShares(amount: bigint): DepositShareCheck {
  const { data: shares } = useReadContract({
    address: ADDRESSES.vault1,
    abi: VAULT_ABI,
    functionName: 'previewDeposit',
    args: [amount],
    chainId: ARC_TESTNET_CHAIN_ID,
    query: { enabled: amount > 0n },
  })

  const { data: oneShareAssets } = useReadContract({
    address: ADDRESSES.vault1,
    abi: VAULT_ABI,
    functionName: 'previewMint',
    args: [1n],
    chainId: ARC_TESTNET_CHAIN_ID,
    query: { staleTime: 60_000 },
  })

  return {
    shares,
    zeroShares: amount > 0n && shares === 0n,
    oneShareAssets,
  }
}
