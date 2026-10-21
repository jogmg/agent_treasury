/**
 * Live vault minimum from the MorphoVaultAdapter's vault registry. The
 * treasury and adapter enforce `BelowMinDeposit` on-chain, so the UI must
 * follow the configured value — and while the read is unresolved it stays
 * `undefined`, which callers must treat as "cannot judge validity yet"
 * (never substitute a permissive default here; that allowed reverting tx).
 */
import { useReadContract } from 'wagmi'
import { ADAPTER_ABI, ADDRESSES, ARC_TESTNET_CHAIN_ID, VAULT_1_ID } from '../lib/contracts'

export const FLOOR_MIN_DEPOSIT = 1_000_000n // sanity floor: 1 USDC in 6 decimals

export function useMinDeposit(): bigint | undefined {
  const { data } = useReadContract({
    address: ADDRESSES.adapter,
    abi: ADAPTER_ABI,
    functionName: 'getVaultConfig',
    args: [VAULT_1_ID],
    chainId: ARC_TESTNET_CHAIN_ID,
    query: { staleTime: 60_000 },
  })

  const minDeposit = data?.minDeposit
  return typeof minDeposit === 'bigint' && minDeposit >= FLOOR_MIN_DEPOSIT
    ? minDeposit
    : undefined
}
