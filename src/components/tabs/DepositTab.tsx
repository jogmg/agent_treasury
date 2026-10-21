import { useState } from 'react'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ExternalLink, Info, ArrowRight } from 'lucide-react'
import { ADDRESSES, TREASURY_ABI, ERC20_ABI, ARC_CHAIN_ID, ARC_CHAIN, ARC_EXPLORER, IS_ARC_MAINNET } from '../../lib/contracts'
import { parseUsdc, formatUsdcDollar, formatUsdc } from '../../lib/decimals'
import { parseOnchainError } from '../../lib/errors'
import { useTreasuryStore } from '../../stores/treasury'
import { useFlowStore } from '../../stores/flow'
import { useMinDeposit } from '../../hooks/useMinDeposit'
import { useDepositShares } from '../../hooks/useDepositShares'
import { TxStep } from '../TxStep'
import { CrossChainDepositCard } from '../CrossChainDepositCard'

const MAX_U256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

export function DepositTab() {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: ARC_CHAIN_ID })
  const queryClient = useQueryClient()

  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [submittedAmount, setSubmittedAmount] = useState('')

  const { usdcBalance, usdcBalanceLoaded, usdcAllowance } = useTreasuryStore()
  const { depositStep, depositHash, approveHash, depositError, setDeposit, resetDeposit } = useFlowStore()

  const { writeContractAsync: approve } = useWriteContract()
  const { writeContractAsync: deposit } = useWriteContract()

  const parsedAmount = amount ? parseUsdc(amount) : 0n
  const needsApprove = parsedAmount > 0n && usdcAllowance < parsedAmount
  const isWrongChain = !!address && chainId !== ARC_CHAIN_ID
  // The treasury enforces the adapter's on-chain minimum; mirror it exactly.
  const minDeposit = useMinDeposit()
  // Block deposits the vault would accept but mint zero shares for.
  const { zeroShares, oneShareAssets } = useDepositShares(parsedAmount)

  const validate = (): string | null => {
    if (!address) return 'Connect wallet'
    if (minDeposit === undefined) return 'Reading vault minimum. Try again in a moment'
    if (parsedAmount === 0n) return 'Enter amount'
    if (parsedAmount > usdcBalance) return 'Insufficient USDC balance'
    if (parsedAmount < minDeposit) return `Minimum deposit is ${formatUsdcDollar(minDeposit)}`
    if (zeroShares) {
      return oneShareAssets
        ? `Amount too small for the vault's share price — deposit at least ${formatUsdcDollar(oneShareAssets)}`
        : 'Amount too small to mint vault shares'
    }
    return null
  }
  const validationMsg = validate()

  async function handleDeposit() {
    if (isWrongChain) {
      switchChain({ chainId: ARC_CHAIN_ID })
      return
    }
    if (validationMsg || !address || !publicClient) return

    setBusy(true)
    setSubmittedAmount('')
    try {
      // Step 1: approve if needed, and wait for the receipt before depositing.
      if (needsApprove) {
        setDeposit({ depositStep: 'approving', approveHash: '', depositHash: '', depositError: '' })
        const approveTx = await approve({
          address: ADDRESSES.usdc,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [ADDRESSES.treasury, MAX_U256],
          chainId: ARC_CHAIN_ID,
        })
        setDeposit({ approveHash: approveTx })

        const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx })
        if (approveReceipt.status !== 'success') throw new Error('Approval transaction reverted')
        toast.success('USDC approved')
      }

      // Step 2: deposit, and only report success after the receipt confirms.
      setDeposit({ depositStep: 'pending', depositError: '' })
      const depositTx = await deposit({
        address: ADDRESSES.treasury,
        abi: TREASURY_ABI,
        functionName: 'deposit',
        args: [parsedAmount],
        chainId: ARC_CHAIN_ID,
      })
      setDeposit({ depositStep: 'confirming', depositHash: depositTx })

      const receipt = await publicClient.waitForTransactionReceipt({ hash: depositTx })
      if (receipt.status !== 'success') throw new Error('Deposit transaction reverted')

      setSubmittedAmount(amount)
      setDeposit({ depositStep: 'success' })
      setAmount('')
      toast.success('Deposit confirmed', {
        description: `${amount} USDC → treasury`,
        action: {
          label: 'Explorer',
          onClick: () => window.open(`${ARC_EXPLORER}/tx/${depositTx}`),
        },
      })
      await queryClient.invalidateQueries()
    } catch (e) {
      const msg = parseOnchainError(e)
      setDeposit({ depositStep: 'error', depositError: msg })
      if (!msg.toLowerCase().includes('cancelled') && !msg.toLowerCase().includes('rejected')) {
        toast.error(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  if (!address) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-slate-400">Connect your wallet to deposit.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      {/* Balance row */}
      <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
        <span className="text-sm text-slate-400">Wallet USDC</span>
        <span className="font-mono text-sm tabular-nums text-white">
          {!usdcBalanceLoaded ? '—' : formatUsdcDollar(usdcBalance)}
        </span>
      </div>

      {usdcBalanceLoaded && usdcBalance === 0n && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {IS_ARC_MAINNET ? (
              'No USDC in this wallet on Arc. Send USDC on Arc mainnet to this address, then refresh.'
            ) : (
              <>
                No USDC in wallet.{' '}
                <a
                  href="https://faucet.circle.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline"
                >
                  Get test USDC <ExternalLink className="h-3 w-3" />
                </a>
                {' '}(select Arc Testnet)
              </>
            )}
          </span>
        </div>
      )}

      {/* Amount input */}
      <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-500">Amount (USDC)</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-transparent font-mono text-2xl text-white outline-none placeholder:text-slate-700 tabular-nums"
          />
          <button
            onClick={() => setAmount(formatUsdc(usdcBalance, 6))}
            className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-400 hover:border-emerald-500/40 hover:text-emerald-400"
          >
            MAX
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-600">
          Min deposit: {minDeposit === undefined ? '...' : formatUsdcDollar(minDeposit)}
        </p>
      </div>

      {/* Progress steps */}
      {needsApprove && parsedAmount > 0n && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className={depositStep !== 'idle' && depositStep !== 'approving' ? 'text-emerald-400' : 'text-slate-400'}>
            1. Approve
          </span>
          <ArrowRight className="h-3 w-3" />
          <span className={depositStep === 'pending' || depositStep === 'confirming' || depositStep === 'success' ? 'text-emerald-400' : 'text-slate-400'}>
            2. Deposit
          </span>
          <ArrowRight className="h-3 w-3" />
          <span className={depositStep === 'success' ? 'text-emerald-400' : 'text-slate-400'}>
            3. Vault
          </span>
        </div>
      )}

      {/* Action button */}
      {isWrongChain ? (
        <button
          onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}
          className="w-full rounded-xl bg-amber-500 py-3.5 text-sm font-semibold text-black transition hover:bg-amber-400"
        >
          Switch to {ARC_CHAIN.name}
        </button>
      ) : (
        <button
          onClick={() => { void handleDeposit() }}
          disabled={!!validationMsg || busy}
          className="w-full rounded-xl bg-emerald-500 py-3.5 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Processing…' : needsApprove ? 'Approve & Deposit' : 'Deposit USDC'}
        </button>
      )}

      {validationMsg && parsedAmount > 0n && (
        <p className="text-center text-xs text-red-400">{validationMsg}</p>
      )}

      <TxStep
        step={depositStep}
        hash={depositHash || approveHash}
        error={depositError}
        labels={{ success: `Deposited ${submittedAmount} USDC — vault shares minted.` }}
        onReset={resetDeposit}
      />

      <CrossChainDepositCard />
    </div>
  )
}
