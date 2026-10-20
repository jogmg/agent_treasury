/**
 * TanStack Query → Zustand bridge.
 * Polls all read-only contract state every 10 s and writes to useTreasuryStore.
 */
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount, useReadContracts } from 'wagmi'
import { ARC_TESTNET_CHAIN_ID, ADDRESSES, TREASURY_ABI, ADAPTER_ABI, ERC20_ABI, VAULT_ABI, VAULT_1_ID } from '../lib/contracts'
import { useTreasuryStore } from '../stores/treasury'
import { useUiStore } from '../stores/ui'
import { fetchActivityEvents } from '../lib/activity'

const CHAIN = ARC_TESTNET_CHAIN_ID

export function useTreasuryData() {
  const { address } = useAccount()
  const set = useTreasuryStore((s) => s.set)
  const pushSnapshot = useUiStore((s) => s.pushSnapshot)

  // ── Batch read: all balance/config calls ────────────────────────────────────
  const { data: reads, isLoading } = useReadContracts({
    contracts: address ? [
      { address: ADDRESSES.treasury, abi: TREASURY_ABI, functionName: 'getTotalBalance',  args: [address],     chainId: CHAIN },
      { address: ADDRESSES.treasury, abi: TREASURY_ABI, functionName: 'getPrincipal',     args: [address],     chainId: CHAIN },
      { address: ADDRESSES.treasury, abi: TREASURY_ABI, functionName: 'getVaultShares',   args: [address],     chainId: CHAIN },
      { address: ADDRESSES.treasury, abi: TREASURY_ABI, functionName: 'getActiveVault',   args: [address],     chainId: CHAIN },
      { address: ADDRESSES.treasury, abi: TREASURY_ABI, functionName: 'paused',           args: [],            chainId: CHAIN },
      { address: ADDRESSES.treasury, abi: TREASURY_ABI, functionName: 'owner',            args: [],            chainId: CHAIN },
      { address: ADDRESSES.treasury, abi: TREASURY_ABI, functionName: 'keeper',           args: [],            chainId: CHAIN },
      { address: ADDRESSES.usdc,     abi: ERC20_ABI,    functionName: 'balanceOf',        args: [address],     chainId: CHAIN },
      { address: ADDRESSES.usdc,     abi: ERC20_ABI,    functionName: 'allowance',        args: [address, ADDRESSES.treasury], chainId: CHAIN },
      { address: ADDRESSES.adapter,  abi: ADAPTER_ABI,  functionName: 'vaultAPY',         args: [VAULT_1_ID],  chainId: CHAIN },
      { address: ADDRESSES.adapter,  abi: ADAPTER_ABI,  functionName: 'totalAssets',      args: [VAULT_1_ID],  chainId: CHAIN },
      { address: ADDRESSES.adapter,  abi: ADAPTER_ABI,  functionName: 'pricePerShare',    args: [VAULT_1_ID],  chainId: CHAIN },
      { address: ADDRESSES.vault1,   abi: VAULT_ABI,    functionName: 'decimals',         args: [],            chainId: CHAIN },
    ] : [],
    query: { refetchInterval: 10_000, enabled: !!address },
  })

  useEffect(() => {
    set({ isFetching: isLoading })
    if (!reads || !address) return

    const r = (i: number) => reads[i]?.result

    const totalBalance  = (r(0) as bigint | undefined) ?? 0n
    const principal     = (r(1) as bigint | undefined) ?? 0n
    const vaultShares   = (r(2) as bigint | undefined) ?? 0n
    const activeVaultId = (r(3) as bigint | undefined) ?? 0n
    const isPaused      = (r(4) as boolean | undefined) ?? false
    const ownerAddr     = ((r(5) as string | undefined) ?? '').toLowerCase()
    const keeperAddr    = ((r(6) as string | undefined) ?? '').toLowerCase()
    const usdcBalance   = (r(7) as bigint | undefined) ?? 0n
    const usdcAllowance = (r(8) as bigint | undefined) ?? 0n
    const vaultApy      = (r(9) as bigint | undefined) ?? 0n
    const vaultTvl      = (r(10) as bigint | undefined) ?? 0n
    const pricePerShare = (r(11) as bigint | undefined) ?? BigInt('1000000000000000000')
    const vaultShareDecimals = Number((r(12) as number | undefined) ?? 18)

    set({
      totalBalance, principal, vaultShares, activeVaultId,
      isPaused, ownerAddr, keeperAddr,
      usdcBalance, usdcAllowance,
      vaultApy, vaultTvl, pricePerShare, vaultShareDecimals,
      lastFetched: Date.now(),
    })

    // Snapshot for growth chart
    if (totalBalance > 0n) pushSnapshot(totalBalance)
  }, [reads, address, isLoading, set, pushSnapshot])

  return { isLoading }
}

// ── Activity events hook ─────────────────────────────────────────────────────

export function useActivityEvents() {
  const { address } = useAccount()
  const setEvents   = useUiStore((s) => s.setEvents)
  const setLoading  = useUiStore((s) => s.setActivityLoading)

  useQuery({
    queryKey: ['activity', address],
    queryFn: async () => {
      setLoading(true)
      try {
        const events = await fetchActivityEvents(address ?? undefined)
        setEvents(events)
        return events
      } finally {
        setLoading(false)
      }
    },
    enabled: !!address,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}
