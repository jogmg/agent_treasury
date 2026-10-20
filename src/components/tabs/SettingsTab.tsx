import { useState } from 'react'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Copy, Check, ShieldOff } from 'lucide-react'
import { ADDRESSES, TREASURY_ABI, ARC_TESTNET_CHAIN_ID, explorerAddr } from '../../lib/contracts'
import { parseUsdc } from '../../lib/decimals'
import { parseOnchainError } from '../../lib/errors'
import { useTreasuryStore } from '../../stores/treasury'
import { useFlowStore } from '../../stores/flow'
import { TxStep } from '../TxStep'
import { OwnershipCard } from '../OwnershipCard'

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="ml-2 text-slate-600 hover:text-slate-300 transition"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

function AddrRow({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-xs text-slate-500">{label}</span>
      <div className="flex items-center gap-1">
        <a
          href={explorerAddr(value)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs text-slate-400 hover:text-emerald-400"
        >
          {value.slice(0, 8)}…{value.slice(-6)}
        </a>
        <CopyButton value={value} />
      </div>
    </div>
  )
}

export function SettingsTab() {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: ARC_TESTNET_CHAIN_ID })
  const queryClient = useQueryClient()
  const [daily, setDaily]   = useState('')
  const [weekly, setWeekly] = useState('')
  const [busy, setBusy]     = useState(false)

  const { ownerAddr, keeperAddr, isPaused } = useTreasuryStore()
  const { settingsStep, settingsHash, settingsError, setSettings, resetSettings } = useFlowStore()

  const { writeContractAsync: setLimit } = useWriteContract()

  const isWrongChain = !!address && chainId !== ARC_TESTNET_CHAIN_ID

  async function handleSetLimit() {
    if (!address || !publicClient) return
    if (isWrongChain) { switchChain({ chainId: ARC_TESTNET_CHAIN_ID }); return }
    const d = daily  ? parseUsdc(daily)  : 0n
    const w = weekly ? parseUsdc(weekly) : 0n
    setBusy(true)
    try {
      setSettings({ settingsStep: 'pending', settingsError: '' })
      const tx = await setLimit({
        address: ADDRESSES.treasury,
        abi: TREASURY_ABI,
        functionName: 'setSpendingLimit',
        args: [address, d, w],
        chainId: ARC_TESTNET_CHAIN_ID,
      })
      setSettings({ settingsStep: 'confirming', settingsHash: tx })

      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx })
      if (receipt.status !== 'success') throw new Error('Transaction reverted')

      setSettings({ settingsStep: 'success' })
      toast.success('Spending limits updated')
      setDaily(''); setWeekly('')
      await queryClient.invalidateQueries()
    } catch (e) {
      const msg = parseOnchainError(e)
      setSettings({ settingsStep: 'error', settingsError: msg })
      if (!msg.toLowerCase().includes('cancelled') && !msg.toLowerCase().includes('rejected')) {
        toast.error(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  if (!address) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
        <p className="text-slate-400">Connect your wallet to view settings.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      {/* Spending limits */}
      <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">Spending Limits</h2>
        <p className="mb-4 text-xs text-slate-500">
          Set 0 for unlimited. Limits are enforced in USDC (6 decimals) by the contract.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Daily limit (USDC)</label>
            <input
              type="number"
              value={daily}
              onChange={(e) => setDaily(e.target.value)}
              placeholder="0 = unlimited"
              className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-slate-600 focus:border-emerald-500/50"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Weekly limit (USDC)</label>
            <input
              type="number"
              value={weekly}
              onChange={(e) => setWeekly(e.target.value)}
              placeholder="0 = unlimited"
              className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-slate-600 focus:border-emerald-500/50"
            />
          </div>
        </div>

        {isWrongChain ? (
          <button
            onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
            className="mt-4 w-full rounded-xl bg-amber-500 py-3 text-sm font-semibold text-black"
          >
            Switch to Arc Testnet
          </button>
        ) : (
          <button
            onClick={() => { void handleSetLimit() }}
            disabled={busy}
            className="mt-4 w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save Limits'}
          </button>
        )}

        <TxStep
          step={settingsStep}
          hash={settingsHash}
          error={settingsError}
          labels={{ success: 'Spending limits updated.' }}
          onReset={resetSettings}
        />
      </div>

      <OwnershipCard />

      {/* Contract info */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="mb-3 text-sm font-semibold text-white">Contract Info</h2>
        <div className="divide-y divide-slate-800">
          <AddrRow label="AgentTreasury"    value={ADDRESSES.treasury} />
          <AddrRow label="MorphoVaultAdapter" value={ADDRESSES.adapter} />
          <AddrRow label="CCTPReceiver"     value={ADDRESSES.receiver} />
          <AddrRow label="USDC (ERC-20)"    value={ADDRESSES.usdc} />
          <AddrRow label="Owner"            value={ownerAddr} />
          <AddrRow label="Keeper"           value={keeperAddr} />
        </div>
      </div>

      {/* Danger zone */}
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5">
        <div className="flex items-center gap-2">
          <ShieldOff className="h-4 w-4 text-red-400" />
          <h2 className="text-sm font-semibold text-red-400">Contract Status</h2>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-slate-500">Paused</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            isPaused
              ? 'bg-red-500/20 text-red-400'
              : 'bg-emerald-500/20 text-emerald-400'
          }`}>
            {isPaused ? 'PAUSED' : 'Active'}
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-600">
          Pause state is read-only here. Only the contract owner can pause/unpause.
        </p>
      </div>
    </div>
  )
}
