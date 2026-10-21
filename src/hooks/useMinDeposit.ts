/**
 * Live vault minimum from the MorphoVaultAdapter's vault registry. The
 * treasury and adapter enforce `BelowMinDeposit` on-chain, so the UI must
 * follow the configured value (not a constant). Falls back to 1 USDC when the
 * read is unavailable.
 */
import { useReadContract } from 'wagmi'
import { ADAPTER_ABI, ADDRESSES, ARC_TESTNET_CHAIN_ID, VAULT_1_ID } from '../lib/contracts'

export const FALLBACK_MIN_DEPOSIT = 1_000_000n // 1 USDC in 6 decimals

export function useMinDeposit(): bigint {
  const { data } = useReadContract({
    address: ADDRESSES.adapter,
    abi: ADAPTER_ABI,
    functionName: 'getVaultConfig',
    args: [VAULT_1_ID],
    chainId: ARC_TESTNET_CHAIN_ID,
    query: { staleTime: 60_000 },
  })

  const minDeposit = data?.[4]
  return typeof minDeposit === 'bigint' && minDeposit >= FALLBACK_MIN_DEPOSIT
    ? minDeposit
    : FALLBACK_MIN_DEPOSIT
}
