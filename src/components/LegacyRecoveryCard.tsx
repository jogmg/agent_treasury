import { useState } from 'react'
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { History } from 'lucide-react'
import {
  ARC_TESTNET_CHAIN_ID,
  LEGACY_ADDRESSES,
  TREASURY_ABI,
  explorerAddr,
} from '../lib/contracts'
import { formatUsdcDollar } from '../lib/decimals'
import { parseOnchainError } from '../lib/errors'
import { TxStep } from './TxStep'
import type { FlowStep } from '../stores/flow'

const MAX_U256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

/**
 * The pre-hotfix stack still holds testnet USDC. Its local withdraw path never
 * touches CCTP and still works, so we expose it here instead of leaving funds
 * stranded after the frontend switches to the fixed deployment.
 */
export function LegacyRecoveryCard() {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: ARC_TESTNET_CHAIN_ID })
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<FlowStep>('idle')
  const [hash, setHash] = useState('')
  const [error, setError] = useState('')

  const { data: legacyBalance, refetch } = useReadContract({
    address: LEGACY_ADDRESSES.treasury,
    abi: TREASURY_ABI,
    functionName: 'getTotalBalance',
    args: address ? [address] : undefined,
    chainId: ARC_TESTNET_CHAIN_ID,
    query: { enabled: !!address },
  })

  const { writeContractAsync } = useWriteContract()
  const balance = legacyBalance ?? 0n
  const isWrongChain = !!address && chainId !== ARC_TESTNET_CHAIN_ID

  if (!address || balance === 0n) return null

  async function handleRecover() {
    if (!address || !publicClient) return
    if (isWrongChain) {
      switchChain({ chainId: ARC_TESTNET_CHAIN_ID })
      return
    }

    setBusy(true)
    setError('')
    setStep('pending')
    try {
      const tx = await writeContractAsync({
        address: LEGACY_ADDRESSES.treasury,
        abi: TREASURY_ABI,
        functionName: 'withdrawLocal',
        args: [MAX_U256],
        chainId: ARC_TESTNET_CHAIN_ID,
      })
      setHash(tx)
      setStep('confirming')

      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx })
      if (receipt.status !== 'success') throw new Error('Legacy withdrawal reverted')

      setStep('success')
      toast.success('Legacy treasury funds returned to your wallet')
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
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-5">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-amber-400" />
        <h2 className="text-sm font-semibold text-amber-200">Legacy Treasury</h2>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        The previous testnet deployment still holds USDC for this wallet. Its local
        withdrawal path is unaffected by the CCTP fix, so you can recover it here.
        If you used more than one wallet, switch wallets to recover each account.
      </p>
      <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-900/60 px-3 py-2.5">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Legacy balance</p>
          <p className="font-mono text-sm tabular-nums text-white">{formatUsdcDollar(balance)}</p>
        </div>
        <a
          href={explorerAddr(LEGACY_ADDRESSES.treasury)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-slate-500 underline hover:text-slate-300"
        >
          {LEGACY_ADDRESSES.treasury.slice(0, 8)}…{LEGACY_ADDRESSES.treasury.slice(-6)}
        </a>
      </div>

      {isWrongChain ? (
        <button
          onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
          className="mt-3 w-full rounded-xl bg-amber-500 py-3 text-sm font-semibold text-black transition hover:bg-amber-400"
        >
          Switch to Arc Testnet
        </button>
      ) : (
        <button
          onClick={() => { void handleRecover() }}
          disabled={busy}
          className="mt-3 w-full rounded-xl border border-amber-500/40 py-3 text-sm font-medium text-amber-200 transition hover:bg-amber-500/10 disabled:opacity-40"
        >
          {busy ? 'Recovering…' : 'Recover to Wallet'}
        </button>
      )}

      <TxStep
        step={step}
        hash={hash}
        error={error}
        labels={{ success: 'Legacy USDC returned to your wallet.' }}
        onReset={() => { setStep('idle'); setHash(''); setError('') }}
      />
    </div>
  )
}
