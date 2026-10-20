/**
 * TanStack Query → Zustand bridge.
 * Polls all read-only contract state every 10 s and writes to useTreasuryStore.
 */
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount, useReadContracts } from 'wagmi'
import { ARC_TESTNET_CHAIN_ID, ADDRESSES, TREASURY_ABI, ADAPTER_ABI, ERC20_ABI, VAULT_ABI, VAULT_1_ID } from '../lib/contracts'
import { useTreasuryStore, type TreasuryState } from '../stores/treasury'
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

    // A failed call (e.g. RPC 429) has no result. Only apply successful
    // values so a transient failure can't overwrite a good balance with 0.
    const r = <T,>(i: number): T | undefined => {
      const item = reads[i]
      return item?.status === 'success' ? (item.result as T) : undefined
    }

    const patch: Partial<TreasuryState> = {}
    const totalBalance  = r<bigint>(0)
    const principal     = r<bigint>(1)
    const vaultShares   = r<bigint>(2)
    const activeVaultId = r<bigint>(3)
    const isPaused      = r<boolean>(4)
    const ownerAddr     = r<string>(5)
    const keeperAddr    = r<string>(6)
    const usdcBalance   = r<bigint>(7)
    const usdcAllowance = r<bigint>(8)
    const vaultApy      = r<bigint>(9)
    const vaultTvl      = r<bigint>(10)
    const pricePerShare = r<bigint>(11)
    const vaultShareDecimals = r<number>(12)

    if (totalBalance !== undefined)  patch.totalBalance = totalBalance
    if (principal !== undefined)     patch.principal = principal
    if (vaultShares !== undefined)   patch.vaultShares = vaultShares
    if (activeVaultId !== undefined) patch.activeVaultId = activeVaultId
    if (isPaused !== undefined)      patch.isPaused = isPaused
    if (ownerAddr !== undefined)     patch.ownerAddr = ownerAddr.toLowerCase()
    if (keeperAddr !== undefined)    patch.keeperAddr = keeperAddr.toLowerCase()
    if (usdcBalance !== undefined) {
      patch.usdcBalance = usdcBalance
      patch.usdcBalanceLoaded = true
    }
    if (usdcAllowance !== undefined) patch.usdcAllowance = usdcAllowance
    if (vaultApy !== undefined)      patch.vaultApy = vaultApy
    if (vaultTvl !== undefined)      patch.vaultTvl = vaultTvl
    if (pricePerShare !== undefined) patch.pricePerShare = pricePerShare
    if (vaultShareDecimals !== undefined) patch.vaultShareDecimals = Number(vaultShareDecimals)

    if (Object.keys(patch).length > 0) {
      set({ ...patch, isFetching: false, lastFetched: Date.now() })
    }

    // Snapshot for growth chart
    if (totalBalance !== undefined && totalBalance > 0n) pushSnapshot(totalBalance)
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
    refetchInterval: 120_000,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}
