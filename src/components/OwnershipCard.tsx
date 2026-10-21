import { useState } from 'react'
import {
  useAccount,
  usePublicClient,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
} from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { KeyRound } from 'lucide-react'
import {
  ADDRESSES,
  ARC_CHAIN_ID,
  OWNABLE_ABI,
} from '../lib/contracts'
import { parseOnchainError } from '../lib/errors'
import { TxStep } from './TxStep'
import type { FlowStep } from '../stores/flow'

const CONTRACTS = [
  { name: 'AgentTreasury', address: ADDRESSES.treasury },
  { name: 'MorphoVaultAdapter', address: ADDRESSES.adapter },
  { name: 'CCTPReceiver', address: ADDRESSES.receiver },
] as const

/**
 * The hotfix deployment uses Ownable2Step. The final owner is already active;
 * accepting on each contract clears the redundant pendingOwner entry.
 */
export function OwnershipCard() {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: ARC_CHAIN_ID })
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<FlowStep>('idle')
  const [hash, setHash] = useState('')
  const [error, setError] = useState('')

  const { data, refetch } = useReadContracts({
    contracts: CONTRACTS.map((c) => ({
      address: c.address,
      abi: OWNABLE_ABI,
      functionName: 'pendingOwner' as const,
      chainId: ARC_CHAIN_ID,
    })),
    query: { enabled: !!address },
  })

  const { writeContractAsync } = useWriteContract()
  const isWrongChain = !!address && chainId !== ARC_CHAIN_ID

  const pending = CONTRACTS.filter((_, i) => {
    const result = data?.[i]
    if (!result || result.status !== 'success') return false
    return result.result.toLowerCase() === address?.toLowerCase()
  })

  if (!address || pending.length === 0) return null

  async function handleAccept(contractAddress: `0x${string}`, name: string) {
    if (!publicClient) return
    if (isWrongChain) {
      switchChain({ chainId: ARC_CHAIN_ID })
      return
    }

    setBusy(true)
    setError('')
    setStep('pending')
    try {
      const tx = await writeContractAsync({
        address: contractAddress,
        abi: OWNABLE_ABI,
        functionName: 'acceptOwnership',
        chainId: ARC_CHAIN_ID,
      })
      setHash(tx)
      setStep('confirming')

      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx })
      if (receipt.status !== 'success') throw new Error('acceptOwnership reverted')

      setStep('success')
      toast.success(`${name} ownership accepted`)
      await queryClient.invalidateQueries()
      await refetch()
    } catch (e) {
      const msg = parseOnchainError(e)
      setError(msg)
      setStep('error')
      if (!msg.toLowerCase().includes('cancelled') && !msg.toLowerCase().includes('rejected')) {
        toast.error(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-5">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-sky-400" />
        <h2 className="text-sm font-semibold text-sky-200">Complete Contract Ownership</h2>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        This deployment uses a two-step ownership handoff. Accept on each contract
        to complete the handoff and clear the pending entry. If a contract still
        lists a different owner, accepting transfers it to you.
      </p>

      <div className="mt-3 space-y-2">
        {pending.map((c) => (
          <div
            key={c.address}
            className="flex items-center justify-between rounded-lg bg-slate-900/60 px-3 py-2.5"
          >
            <span className="text-xs text-slate-300">{c.name}</span>
            <button
              onClick={() => { void handleAccept(c.address, c.name) }}
              disabled={busy}
              className="rounded-lg border border-sky-500/40 px-3 py-1.5 text-xs font-medium text-sky-200 transition hover:bg-sky-500/10 disabled:opacity-40"
            >
              Accept
            </button>
          </div>
        ))}
      </div>

      <TxStep
        step={step}
        hash={hash}
        error={error}
        labels={{ success: 'Ownership accepted.' }}
        onReset={() => { setStep('idle'); setHash(''); setError('') }}
      />
    </div>
  )
}
