import { useState } from 'react'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { isAddress } from 'viem'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { ADDRESSES, TREASURY_ABI, ARC_CHAIN_ID, ARC_CHAIN, ARC_EXPLORER, ARC_CCTP_DOMAIN } from '../../lib/contracts'
import { parseUsdc, formatUsdcDollar, formatUsdc, addrToBytes32 } from '../../lib/decimals'
import { CCTP_DESTINATIONS } from '../../lib/cctp'
import { parseOnchainError } from '../../lib/errors'
import { useTreasuryStore } from '../../stores/treasury'
import { useFlowStore } from '../../stores/flow'
import { TxStep } from '../TxStep'
import { CctpCompletionCard } from '../CctpCompletionCard'

const MAX_U256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

export function WithdrawTab() {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: ARC_CHAIN_ID })
  const queryClient = useQueryClient()

  const [amount, setAmount] = useState('')
  const [withdrawBusy, setWithdrawBusy] = useState(false)

  // CCTP form state
  const [cctpAmount, setCctpAmount] = useState('')
  const [destDomain, setDestDomain] = useState('')
  const [mintRecipient, setMintRecipient] = useState('')
  const [existingTx, setExistingTx] = useState('')
  const [cctpBusy, setCctpBusy] = useState(false)

  const { totalBalance } = useTreasuryStore()
  const { withdrawStep, withdrawHash, withdrawError, setWithdraw, resetWithdraw,
          cctpStep, cctpHash, cctpError, setCctp, resetCctp } = useFlowStore()

  const { writeContractAsync: withdraw } = useWriteContract()
  const { writeContractAsync: requestWithdrawal } = useWriteContract()

  const isWrongChain = !!address && chainId !== ARC_CHAIN_ID
  const parsedAmount  = amount ? parseUsdc(amount) : 0n

  function loadCctpTransfer(txHash: string, rawAmount?: unknown, destinationDomain?: unknown) {
    const amountValue = typeof rawAmount === 'bigint' ? rawAmount.toString() : ''
    const domainValue = Number(destinationDomain)
    setCctp({
      cctpStep: 'success',
      cctpHash: txHash,
      cctpOwner: address ?? '',
      cctpError: '',
      cctpCompletionStatus: 'waiting',
      cctpDestinationDomain: Number.isInteger(domainValue) ? domainValue : 0,
      cctpAmount: amountValue,
      cctpRecipient: '',
      cctpMessage: '',
      cctpAttestation: '',
      cctpMintHash: '',
      cctpCompletionError: '',
    })
  }

  const pct = (p: number) => {
    const val = (totalBalance * BigInt(p)) / 100n
    setAmount(formatUsdc(val, 6))
  }

  async function handleWithdraw(isMax = false) {
    if (isWrongChain) { switchChain({ chainId: ARC_CHAIN_ID }); return }
    if (!address || !publicClient) return
    if (!isMax && parsedAmount === 0n) return
    if (!isMax && parsedAmount > totalBalance) { toast.error('Amount exceeds balance'); return }
    if (totalBalance === 0n) { toast.error('Nothing to withdraw'); return }

    setWithdrawBusy(true)
    try {
      setWithdraw({ withdrawStep: 'pending', withdrawError: '' })
      const args: [bigint] = [isMax ? MAX_U256 : parsedAmount]
      const tx = await withdraw({
        address: ADDRESSES.treasury,
        abi: TREASURY_ABI,
        functionName: 'withdrawLocal',
        args,
        chainId: ARC_CHAIN_ID,
      })
      setWithdraw({ withdrawStep: 'confirming', withdrawHash: tx })

      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx })
      if (receipt.status !== 'success') throw new Error('Withdrawal transaction reverted')

      setWithdraw({ withdrawStep: 'success' })
      setAmount('')
      toast.success('Withdrawal confirmed', {
        action: { label: 'Explorer', onClick: () => window.open(`${ARC_EXPLORER}/tx/${tx}`) },
      })
      await queryClient.invalidateQueries()
    } catch (e) {
      const msg = parseOnchainError(e)
      setWithdraw({ withdrawStep: 'error', withdrawError: msg })
      if (!msg.toLowerCase().includes('cancelled') && !msg.toLowerCase().includes('rejected')) {
        toast.error(msg)
      }
    } finally {
      setWithdrawBusy(false)
    }
  }

  async function handleCctp() {
    if (isWrongChain) { switchChain({ chainId: ARC_CHAIN_ID }); return }
    if (!address || !publicClient) return

    const parsed = cctpAmount ? parseUsdc(cctpAmount) : 0n
    const domain = parseInt(destDomain, 10)
    if (parsed === 0n) { toast.error('Enter an amount'); return }
    if (parsed > totalBalance) { toast.error('Amount exceeds treasury balance'); return }
    if (isNaN(domain) || domain === ARC_CCTP_DOMAIN) {
      toast.error('Invalid destination domain (Arc domain 26 rejected)')
      return
    }
    if (!isAddress(mintRecipient)) {
      toast.error('Enter a valid 0x recipient address')
      return
    }

    setCctpBusy(true)
    try {
      setCctp({ cctpStep: 'pending', cctpError: '' })
      const tx = await requestWithdrawal({
        address: ADDRESSES.treasury,
        abi: TREASURY_ABI,
        functionName: 'requestWithdrawal',
        args: [address, parsed, domain, addrToBytes32(mintRecipient)],
        chainId: ARC_CHAIN_ID,
      })
      setCctp({ cctpStep: 'confirming', cctpHash: tx })

      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx })
      if (receipt.status !== 'success') throw new Error('CCTP burn transaction reverted')

      setCctp({
        cctpStep: 'success',
        cctpOwner: address,
        cctpCompletionStatus: 'waiting',
        cctpDestinationDomain: domain,
        cctpAmount: parsed.toString(),
        cctpRecipient: mintRecipient,
        cctpMessage: '',
        cctpAttestation: '',
        cctpMintHash: '',
        cctpCompletionError: '',
      })
      setCctpAmount('')
      await queryClient.invalidateQueries()
      toast.success('CCTP burn confirmed. Fetching the Circle attestation…')
    } catch (e) {
      const msg = parseOnchainError(e)
      setCctp({ cctpStep: 'error', cctpError: msg })
      if (!msg.toLowerCase().includes('cancelled') && !msg.toLowerCase().includes('rejected')) {
        toast.error(msg)
      }
    } finally {
      setCctpBusy(false)
    }
  }

  if (!address) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-slate-400">Connect your wallet to withdraw.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      {/* Balance info */}
      <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
        <span className="text-sm text-slate-400">Available</span>
        <span className="font-mono text-sm tabular-nums text-white">{formatUsdcDollar(totalBalance)}</span>
      </div>

      {/* Local withdraw */}
      <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">Withdraw to Wallet</h2>

        {/* Quick pct buttons */}
        <div className="mb-3 flex gap-2">
          {[25, 50, 75].map((p) => (
            <button
              key={p}
              onClick={() => pct(p)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-400 hover:border-emerald-500/40 hover:text-emerald-400"
            >
              {p}%
            </button>
          ))}
          <button
            onClick={() => pct(100)}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-400 hover:border-emerald-500/40 hover:text-emerald-400"
          >
            MAX
          </button>
        </div>

        <input
          type="number"
          min="0"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="mb-4 w-full rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3 font-mono text-xl text-white outline-none placeholder:text-slate-700 tabular-nums focus:border-emerald-500/50"
        />

        {isWrongChain ? (
          <button
            onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}
            className="w-full rounded-xl bg-amber-500 py-3.5 text-sm font-semibold text-black transition hover:bg-amber-400"
          >
            Switch to {ARC_CHAIN.name}
          </button>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={() => { void handleWithdraw(false) }}
              disabled={parsedAmount === 0n || parsedAmount > totalBalance || withdrawBusy}
              className="flex-1 rounded-xl bg-emerald-500 py-3.5 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {withdrawBusy ? 'Processing…' : 'Withdraw'}
            </button>
            <button
              onClick={() => { void handleWithdraw(true) }}
              disabled={totalBalance === 0n || withdrawBusy}
              className="rounded-xl border border-slate-700 px-5 py-3.5 text-sm font-medium text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-400 disabled:opacity-40"
            >
              Withdraw All
            </button>
          </div>
        )}

        <TxStep
          step={withdrawStep}
          hash={withdrawHash}
          error={withdrawError}
          labels={{ success: 'USDC returned to your wallet.' }}
          onReset={resetWithdraw}
        />
      </div>

      {/* CCTP advanced */}
      <details className="rounded-xl border border-slate-800 bg-slate-900/40">
        <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-slate-300 hover:text-white">
          Advanced: Cross-Chain Withdrawal (CCTP)
        </summary>
        <div className="space-y-4 border-t border-slate-800 p-5">
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              This burns USDC on Arc and mints it on the destination through CCTP. The app fetches
              the Circle attestation automatically, then asks you to confirm the destination mint.
              You need a little destination-chain gas for that final transaction. Same-domain (Arc,
              26) is rejected by the contract.
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Amount (USDC)</label>
              <input
                type="number"
                value={cctpAmount}
                onChange={(e) => setCctpAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-slate-600 focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Destination Chain</label>
              <select
                value={destDomain}
                onChange={(e) => setDestDomain(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
              >
                <option value="">Select chain…</option>
                {Object.values(CCTP_DESTINATIONS)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((destination) => (
                    <option key={destination.domain} value={String(destination.domain)}>
                      {destination.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Recipient Address (0x... on destination)</label>
              <input
                type="text"
                value={mintRecipient}
                onChange={(e) => setMintRecipient(e.target.value)}
                placeholder="0x..."
                className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-slate-600 focus:border-emerald-500/50"
              />
            </div>
          </div>

          <button
            onClick={() => { void handleCctp() }}
            disabled={!cctpAmount || !destDomain || !mintRecipient || cctpBusy}
            className="w-full rounded-xl border border-slate-700 py-3 text-sm font-medium text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-400 disabled:opacity-40"
          >
            {cctpBusy ? 'Processing…' : 'Request Cross-Chain Withdrawal'}
          </button>

          <TxStep
            step={cctpStep}
            hash={cctpHash}
            error={cctpError}
            labels={{ success: 'CCTP burn confirmed. The app will finish the destination mint.' }}
            onReset={() => { resetCctp(); setExistingTx('') }}
          />

          {cctpStep === 'success' && cctpHash && (
            <CctpCompletionCard burnTx={cctpHash} />
          )}

          <div className="space-y-2 border-t border-slate-800 pt-4">
            <label className="block text-xs text-slate-500">
              Already burned? Paste the Arc burn tx hash to finish it. Completed requests are in the
              Activity tab.
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={existingTx}
                onChange={(e) => setExistingTx(e.target.value)}
                placeholder="0x..."
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 font-mono text-xs text-white outline-none placeholder:text-slate-600 focus:border-emerald-500/50"
              />
              <button
                type="button"
                onClick={() => {
                  const txHash = existingTx.trim()
                  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
                    toast.error('Enter a valid 32-byte transaction hash')
                    return
                  }
                  loadCctpTransfer(txHash)
                  setExistingTx('')
                }}
                className="shrink-0 rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 hover:border-emerald-500/40 hover:text-emerald-400"
              >
                Load
              </button>
            </div>
          </div>
        </div>
      </details>
    </div>
  )
}
