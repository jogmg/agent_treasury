import { useEffect, useState } from 'react'
import {
  useAccount,
  useBalance,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { decodeFunctionData, zeroHash } from 'viem'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Fuel,
  Info,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import {
  ARC_CCTP_DOMAIN,
  CCTP_DESTINATIONS,
  getCctpDestination,
  getCctpMessageNonce,
  MESSAGE_TRANSMITTER_V2,
  MESSAGE_TRANSMITTER_V2_ABI,
  TOKEN_MESSENGER_V2,
  TOKEN_MESSENGER_V2_ABI,
  waitForCctpAttestation,
} from '../lib/cctp'
import {
  ADDRESSES,
  ARC_EXPLORER,
  ARC_TESTNET_CHAIN_ID,
  ERC20_ABI,
  TREASURY_ABI,
} from '../lib/contracts'
import { addrToBytes32, formatUsdc, formatUsdcDollar, parseUsdc, shortAddr } from '../lib/decimals'
import { parseOnchainError } from '../lib/errors'
import { BRIDGE_STATUS_LABEL, useBridgeDepositStore } from '../stores/bridgeDeposit'
import { useMinDeposit } from '../hooks/useMinDeposit'

const ARC_GAS_SYMBOL = 'USDC'
// Keep enough native USDC for the Arc mint, approval, and treasury deposit.
// Arc gas is paid from the same native USDC balance, so depositing the entire
// minted amount without a buffer can make the final deposit fail.
const ARC_GAS_RESERVE = 100_000_000_000_000_000n // 0.1 USDC in 18-dec native units
const SOURCES = Object.values(CCTP_DESTINATIONS)

function rawAmount(value: string): bigint {
  try {
    return value ? BigInt(value) : 0n
  } catch {
    return 0n
  }
}

/**
 * Inbound CCTP: burn USDC on a source chain, wait for Circle's attestation,
 * then call receiveMessage on Arc. The CCTPReceiver hook credits the connected
 * wallet's agent and deploys the USDC into the treasury vault.
 */
export function CrossChainDepositCard() {
  const { address, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const queryClient = useQueryClient()

  const [sourceDomain, setSourceDomain] = useState(0)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [resumeTx, setResumeTx] = useState('')
  const [resuming, setResuming] = useState(false)

  const {
    status,
    owner,
    sourceDomain: activeSourceDomain,
    amount: activeAmount,
    approveHash,
    burnHash,
    mintHash,
    arcApproveHash,
    depositHash,
    message,
    attestation,
    error,
    recent,
    setBridgeDeposit,
    resetBridgeDeposit,
    restoreBridgeDeposit,
  } = useBridgeDepositStore()

  const source = getCctpDestination(sourceDomain) ?? CCTP_DESTINATIONS[0]
  const activeSource = getCctpDestination(activeSourceDomain) ?? CCTP_DESTINATIONS[0]

  const sourceClient = usePublicClient({ chainId: source.chain.id })
  const arcClient = usePublicClient({ chainId: ARC_TESTNET_CHAIN_ID })

  const { data: sourceBalance, refetch: refetchSourceBalance } = useReadContract({
    address: source.usdc,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: source.chain.id,
    query: { enabled: Boolean(address) },
  })

  const { data: sourceAllowance, refetch: refetchSourceAllowance } = useReadContract({
    address: source.usdc,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, TOKEN_MESSENGER_V2] : undefined,
    chainId: source.chain.id,
    query: { enabled: Boolean(address) },
  })

  const { data: sourceGas } = useBalance({
    address,
    chainId: source.chain.id,
    query: { enabled: Boolean(address) },
  })

  const { data: arcGas, refetch: refetchArcGas } = useBalance({
    address,
    chainId: ARC_TESTNET_CHAIN_ID,
    query: { enabled: Boolean(address) },
  })

  const parsedAmount = amount ? parseUsdc(amount) : 0n
  const needsApprove = parsedAmount > 0n && (sourceAllowance ?? 0n) < parsedAmount
  // The treasury enforces the adapter's on-chain minimum; mirror it exactly.
  const minDeposit = useMinDeposit()
  const ownerMatches = Boolean(
    address && owner && address.toLowerCase() === owner.toLowerCase(),
  )
  const isActive = status !== 'idle'
  const myRecent = address
    ? recent.filter((record) => record.owner.toLowerCase() === address.toLowerCase())
    : []

  let validation: string | null = null
  if (!address) validation = 'Connect wallet'
  else if (minDeposit === undefined) validation = 'Reading vault minimum. Try again in a moment'
  else if (parsedAmount === 0n) validation = 'Enter amount'
  else if (parsedAmount < minDeposit) validation = `Minimum cross-chain deposit is ${formatUsdcDollar(minDeposit)}`
  else if (sourceBalance !== undefined && parsedAmount > sourceBalance) {
    validation = `Insufficient USDC on ${source.name}`
  }

  const activeRaw = rawAmount(activeAmount)
  const activeAmountLabel = activeRaw > 0n ? formatUsdcDollar(activeRaw) : 'USDC'
  const activeGas = arcGas
  const needsArcGas = Boolean(activeGas && activeGas.value < ARC_GAS_RESERVE)

  // Resume the attestation poll after a tab switch. The burn is already safely
  // on the source chain, so only the destination mint is left.
  useEffect(() => {
    if (
      status !== 'waiting' ||
      !address ||
      !owner ||
      owner.toLowerCase() !== address.toLowerCase() ||
      !burnHash ||
      !Number.isInteger(activeSourceDomain)
    ) {
      return
    }

    const controller = new AbortController()
    let active = true

    void (async () => {
      try {
        const result = await waitForCctpAttestation(burnHash, {
          sourceDomain: activeSourceDomain,
          timeoutMs: 60 * 60_000,
          signal: controller.signal,
        })
        if (!active) return
        if (result.destinationDomain !== ARC_CCTP_DOMAIN) {
          throw new Error(
            `This attestation targets CCTP domain ${result.destinationDomain}, not Arc (${ARC_CCTP_DOMAIN}).`,
          )
        }

        setBridgeDeposit({
          status: 'ready',
          amount:
            result.amount > 0n
              ? result.amount.toString()
              : useBridgeDepositStore.getState().amount,
          message: result.message,
          attestation: result.attestation,
          error: '',
        })
      } catch (e) {
        if (!active || controller.signal.aborted) return
        setBridgeDeposit({
          status: 'error',
          error:
            e instanceof Error ? e.message : 'Could not fetch the Circle attestation.',
        })
      }
    })()

    return () => {
      active = false
      controller.abort()
    }
  }, [
    status,
    address,
    owner,
    burnHash,
    activeSourceDomain,
    setBridgeDeposit,
  ])

  async function handleBridge() {
    if (!address || !sourceClient) return
    if (validation) {
      toast.error(validation)
      return
    }

    setBusy(true)
    setBridgeDeposit({
      status: needsApprove ? 'approving' : 'burning',
      owner: address,
      sourceDomain: source.domain,
      amount: parsedAmount.toString(),
      approveHash: '',
      burnHash: '',
      mintHash: '',
      arcApproveHash: '',
      depositHash: '',
      message: '',
      attestation: '',
      error: '',
    })

    try {
      if (chainId !== source.chain.id) {
        await switchChainAsync({ chainId: source.chain.id })
      }

      if (needsApprove) {
        const approveTx = await writeContractAsync({
          address: source.usdc,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [TOKEN_MESSENGER_V2, parsedAmount],
          chainId: source.chain.id,
        })
        setBridgeDeposit({ approveHash: approveTx })

        const approveReceipt = await sourceClient.waitForTransactionReceipt({ hash: approveTx })
        if (approveReceipt.status !== 'success') throw new Error('Approval transaction reverted')
        toast.success(`USDC approved on ${source.name}`)
        void refetchSourceAllowance()
      }

      setBridgeDeposit({ status: 'burning', error: '' })

      const burnTx = await writeContractAsync({
        address: TOKEN_MESSENGER_V2,
        abi: TOKEN_MESSENGER_V2_ABI,
        functionName: 'depositForBurn',
        args: [
          parsedAmount,
          ARC_CCTP_DOMAIN,
          addrToBytes32(address),
          source.usdc,
          zeroHash,
          0n,
          2000, // standard finality; 1000 would require a fast-transfer fee
        ],
        chainId: source.chain.id,
      })
      setBridgeDeposit({ burnHash: burnTx })

      const burnReceipt = await sourceClient.waitForTransactionReceipt({ hash: burnTx })
      if (burnReceipt.status !== 'success') throw new Error('CCTP burn transaction reverted')

      setBridgeDeposit({ status: 'waiting', error: '' })
      setAmount('')
      void refetchSourceBalance()
      void refetchSourceAllowance()
      await queryClient.invalidateQueries()
      toast.success('Source-chain burn confirmed. Waiting for Circle attestation…')
    } catch (e) {
      const messageText = parseOnchainError(e)
      setBridgeDeposit({ status: 'error', error: messageText })
      if (messageText !== 'Transaction cancelled.') toast.error(messageText)
    } finally {
      setBusy(false)
    }
  }

  async function handleResume() {
    if (!address || !sourceClient) return
    const hash = resumeTx.trim()
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      toast.error('Enter a valid source-chain transaction hash.')
      return
    }

    setResuming(true)
    try {
      const transaction = await sourceClient.getTransaction({ hash: hash as `0x${string}` })
      if (!transaction) throw new Error(`No transaction found on ${source.name}.`)
      if (!transaction.to || transaction.to.toLowerCase() !== TOKEN_MESSENGER_V2.toLowerCase()) {
        throw new Error(`That transaction did not call CCTP TokenMessenger on ${source.name}.`)
      }

      const decoded = decodeFunctionData({
        abi: TOKEN_MESSENGER_V2_ABI,
        data: transaction.input,
      })
      const args = decoded.args as readonly [
        bigint,
        number,
        `0x${string}`,
        `0x${string}`,
        `0x${string}`,
        bigint,
        number,
      ]
      if (!args || args.length < 3) throw new Error('Could not decode the CCTP burn arguments.')

      const domain = Number(args[1])
      if (domain !== ARC_CCTP_DOMAIN) {
        throw new Error(`That burn targets CCTP domain ${domain}, not Arc (${ARC_CCTP_DOMAIN}).`)
      }

      if (args[4].toLowerCase() !== zeroHash) {
        throw new Error('That burn restricts the destination caller, so this wallet cannot mint it.')
      }

      const mintRecipient = `0x${args[2].slice(-40)}`
      if (mintRecipient.toLowerCase() !== address.toLowerCase()) {
        throw new Error(
          `That burn mints to ${shortAddr(mintRecipient)}, not the connected wallet ${shortAddr(address)}.`,
        )
      }

      setBridgeDeposit({
        status: 'waiting',
        owner: address,
        sourceDomain: source.domain,
        amount: args[0].toString(),
        approveHash: '',
        burnHash: hash,
        mintHash: '',
        arcApproveHash: '',
        depositHash: '',
        message: '',
        attestation: '',
        error: '',
      })
      setResumeTx('')
      toast.success('Source burn loaded. Waiting for Circle attestation…')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load that source transaction.')
    } finally {
      setResuming(false)
    }
  }

  async function handleCompleteDeposit() {
    if (!address || !arcClient || !message || !attestation) return
    if (owner && owner.toLowerCase() !== address.toLowerCase()) {
      toast.error('Switch to the wallet that started this deposit.')
      return
    }

    const amountToDeposit = activeRaw > 0n ? activeRaw : rawAmount(useBridgeDepositStore.getState().amount)
    if (amountToDeposit === 0n) {
      toast.error('The attested amount is not available yet. Retry the attestation.')
      return
    }

    setBridgeDeposit({ status: 'minting', error: '', mintHash: '', arcApproveHash: '', depositHash: '' })
    try {
      if (chainId !== ARC_TESTNET_CHAIN_ID) {
        await switchChainAsync({ chainId: ARC_TESTNET_CHAIN_ID })
      }

      const gasBalance = await arcClient.getBalance({ address })
      if (gasBalance < ARC_GAS_RESERVE) {
        setBridgeDeposit({
          status: 'ready',
          error: `Keep at least 0.1 ${ARC_GAS_SYMBOL} on Arc for the mint, approval, and deposit gas. The bridge amount is deposited in full, so it cannot cover those fees.`,
        })
        return
      }

      // A message can only be delivered once. If another wallet already
      // delivered it, the USDC is already in this wallet; skip to the deposit.
      let alreadyDelivered = false
      try {
        const nonce = getCctpMessageNonce(message)
        alreadyDelivered = await arcClient.readContract({
          address: MESSAGE_TRANSMITTER_V2,
          abi: MESSAGE_TRANSMITTER_V2_ABI,
          functionName: 'usedNonces',
          args: [nonce],
        })
      } catch {
        // Fall through to the mint; the wallet will surface a real revert.
      }

      if (!alreadyDelivered) {
        const hash = await writeContractAsync({
          address: MESSAGE_TRANSMITTER_V2,
          abi: MESSAGE_TRANSMITTER_V2_ABI,
          functionName: 'receiveMessage',
          args: [message as `0x${string}`, attestation as `0x${string}`],
          chainId: ARC_TESTNET_CHAIN_ID,
        })
        setBridgeDeposit({ mintHash: hash })

        const receipt = await arcClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new Error('Arc CCTP mint reverted')
      }

      // The CCTP mint delivers to this wallet. Confirm the funds are there
      // before pulling them into the treasury.
      const walletUsdc = await arcClient.readContract({
        address: ADDRESSES.usdc,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address],
      })
      if (walletUsdc < amountToDeposit) {
        if (alreadyDelivered) {
          setBridgeDeposit({ status: 'done', error: '' })
          await queryClient.invalidateQueries()
          toast.success('This cross-chain deposit was already delivered.')
          return
        }
        throw new Error(
          `The Arc mint confirmed, but the wallet holds ${formatUsdcDollar(walletUsdc)} USDC instead of ${formatUsdcDollar(amountToDeposit)}. Check the wallet before retrying.`,
        )
      }

      const allowance = await arcClient.readContract({
        address: ADDRESSES.usdc,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, ADDRESSES.treasury],
      })
      if (allowance < amountToDeposit) {
        setBridgeDeposit({ status: 'arc-approving', error: '' })
        const approveTx = await writeContractAsync({
          address: ADDRESSES.usdc,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [ADDRESSES.treasury, amountToDeposit],
          chainId: ARC_TESTNET_CHAIN_ID,
        })
        setBridgeDeposit({ arcApproveHash: approveTx })

        const approveReceipt = await arcClient.waitForTransactionReceipt({ hash: approveTx })
        if (approveReceipt.status !== 'success') throw new Error('Arc approval reverted')
      }

      setBridgeDeposit({ status: 'depositing', error: '' })
      const depositTx = await writeContractAsync({
        address: ADDRESSES.treasury,
        abi: TREASURY_ABI,
        functionName: 'deposit',
        args: [amountToDeposit],
        chainId: ARC_TESTNET_CHAIN_ID,
      })
      setBridgeDeposit({ depositHash: depositTx })

      const depositReceipt = await arcClient.waitForTransactionReceipt({ hash: depositTx })
      if (depositReceipt.status !== 'success') throw new Error('Treasury deposit reverted')

      setBridgeDeposit({ status: 'done', error: '' })
      await queryClient.invalidateQueries()
      void refetchArcGas()
      toast.success('Cross-chain deposit credited to your treasury')
    } catch (e) {
      const messageText = parseOnchainError(e)
      setBridgeDeposit({ status: 'ready', error: messageText })
      if (messageText !== 'Transaction cancelled.') toast.error(messageText)
    }
  }

  function retryAttestation() {
    setBridgeDeposit({ status: 'waiting', error: '' })
  }

  function reset() {
    setAmount('')
    resetBridgeDeposit()
  }

  async function copyBurnHash() {
    if (!burnHash) return
    try {
      await navigator.clipboard.writeText(burnHash)
      toast.success('Source burn hash copied')
    } catch {
      toast.error('Could not copy. Open the burn transaction and copy it from the explorer.')
    }
  }

  const isActivityView = status !== 'idle'
  return (
    <details
      open={isActivityView && status !== 'done' ? true : undefined}
      className="group rounded-xl border border-slate-700 bg-slate-900/60"
    >
      <summary className="flex cursor-pointer list-none select-none items-center justify-between gap-3 px-5 py-4 hover:bg-slate-900/80 [&::-webkit-details-marker]:hidden">
        <div>
          <h2 className="text-sm font-semibold text-white">Cross-Chain Deposit</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Bring USDC from Ethereum, Base, Arbitrum, OP, Avalanche, or Polygon via CCTP v2.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isActive && status !== 'done' && (
            <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-300">
              {BRIDGE_STATUS_LABEL[status]}
            </span>
          )}
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
            CCTP
          </span>
          <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" />
        </div>
      </summary>

      <div className="border-t border-slate-800 p-5">

      {!isActive && (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Source chain</label>
            <select
              value={sourceDomain}
              onChange={(e) => {
                setSourceDomain(Number(e.target.value))
                setAmount('')
              }}
              className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500/50"
            >
              {SOURCES.map((option) => (
                <option key={option.domain} value={option.domain}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-500">Amount (USDC)</label>
            <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2">
              <input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent font-mono text-lg text-white outline-none placeholder:text-slate-600 tabular-nums"
              />
              <button
                type="button"
                onClick={() => setAmount(formatUsdc(sourceBalance ?? 0n, 6))}
                className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-400 hover:border-emerald-500/40 hover:text-emerald-400"
              >
                MAX
              </button>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
              <span>
                {source.name} balance:{' '}
                <span className="font-mono text-slate-400">
                  {sourceBalance === undefined ? '—' : formatUsdcDollar(sourceBalance)}
                </span>
              </span>
              <span>
                Gas:{' '}
                <span className={sourceGas?.value === 0n ? 'text-amber-300' : 'text-slate-400'}>
                  {sourceGas ? `${sourceGas.formatted} ${sourceGas.symbol}` : '—'}
                </span>
              </span>
            </div>
          </div>

          {sourceBalance === 0n && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                No USDC on {source.name}.{' '}
                <a
                  href="https://faucet.circle.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline"
                >
                  Get test USDC <ExternalLink className="h-3 w-3" />
                </a>{' '}
                (select {source.name}).
              </span>
            </div>
          )}

          {sourceGas?.value === 0n && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300">
              <Fuel className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                You need {source.chain.nativeCurrency.symbol} on {source.name} for the approve and
                burn gas.{' '}
                {source.faucet && (
                  <a
                    href={source.faucet}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 underline"
                  >
                    Open faucet <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span>1. Approve</span>
            <ArrowRight className="h-3 w-3" />
            <span>2. Burn on {source.name}</span>
            <ArrowRight className="h-3 w-3" />
            <span>3. Mint to Arc wallet</span>
            <ArrowRight className="h-3 w-3" />
            <span>4. Deposit to vault</span>
          </div>

          <button
            type="button"
            onClick={() => { void handleBridge() }}
            disabled={!!validation || busy}
            className="w-full rounded-xl bg-emerald-500 py-3.5 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy
              ? 'Processing…'
              : chainId !== source.chain.id
                ? `Switch to ${source.name} & Bridge`
                : needsApprove
                  ? 'Approve & Bridge to Arc'
                  : 'Bridge to Arc'}
          </button>

          {validation && parsedAmount > 0n && (
            <p className="text-center text-xs text-red-400">{validation}</p>
          )}

          <p className="text-[11px] leading-relaxed text-slate-500">
            Standard CCTP, no protocol fee. The source-chain attestation can take 15–30 minutes
            (15–19 minutes from Ethereum Sepolia). The Arc mint delivers USDC to your connected
            wallet; the app then approves the treasury and deposits it into your agent's vault. You
            need a little Arc {ARC_GAS_SYMBOL} for up to three Arc transactions.
          </p>

          <details className="rounded-lg border border-slate-800 bg-slate-900/40">
            <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium text-slate-400 hover:text-slate-200">
              Already burned? Track a source transaction
            </summary>
            <div className="space-y-2 border-t border-slate-800 p-3">
              <p className="text-[11px] leading-relaxed text-slate-500">
                Paste the CCTP burn transaction from {source.name} to resume after a reload. The app
                checks that the burn targets Arc and mints to the connected wallet.
              </p>
              <div className="flex gap-2">
                <input
                  value={resumeTx}
                  onChange={(e) => setResumeTx(e.target.value)}
                  placeholder="0x source burn hash"
                  className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 font-mono text-xs text-white outline-none placeholder:text-slate-600 focus:border-emerald-500/50"
                />
                <button
                  type="button"
                  onClick={() => { void handleResume() }}
                  disabled={resuming || !resumeTx.trim()}
                  className="shrink-0 rounded-lg border border-emerald-500/40 px-3 py-2 text-xs font-medium text-emerald-400 transition hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {resuming ? 'Checking…' : 'Track'}
                </button>
              </div>

              {myRecent.length > 0 && (
                <div className="space-y-1.5 border-t border-slate-800 pt-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-600">
                      Recent source burns
                    </p>
                    <p className="text-[10px] text-slate-600">Saved in this browser</p>
                  </div>
                  {myRecent.slice(0, 5).map((record) => {
                    const recordSource = getCctpDestination(record.sourceDomain)
                    const recordAmount = rawAmount(record.amount)
                    return (
                      <button
                        key={record.burnHash}
                        type="button"
                        onClick={() => restoreBridgeDeposit(record)}
                        className="w-full rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2 text-left transition hover:border-emerald-500/30"
                      >
                        <span className="block text-xs text-slate-300">
                          {recordAmount > 0n ? formatUsdcDollar(recordAmount) : 'USDC'} ·{' '}
                          {recordSource?.name ?? `Domain ${record.sourceDomain}`}
                        </span>
                        <span
                          className="mt-0.5 block truncate font-mono text-[10px] text-slate-500"
                          title={record.burnHash}
                        >
                          {record.burnHash}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-slate-600">
                          {new Date(record.createdAt).toLocaleString()}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </details>
        </div>
      )}

      {isActive && !ownerMatches && (
        <div className="space-y-3">
          <p className="flex items-start gap-2 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            This deposit was started by {owner ? shortAddr(owner) : 'another wallet'}. Switch back
            to that wallet to finish it, or reset this form.
          </p>
          <button
            type="button"
            onClick={reset}
            className="w-full rounded-xl border border-slate-700 py-2.5 text-xs font-medium text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-400"
          >
            Reset
          </button>
        </div>
      )}

      {isActive && ownerMatches && (
        <div className="space-y-3" aria-live="polite">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-[11px]">
            <span className="text-slate-400">
              {activeAmountLabel} from {activeSource.name}
            </span>
            {burnHash && (
              <div className="flex items-center gap-2">
                <a
                  href={`${activeSource.explorer}/tx/${burnHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-300"
                >
                  Burn tx <ExternalLink className="h-3 w-3" />
                </a>
                <button
                  type="button"
                  onClick={() => { void copyBurnHash() }}
                  className="text-slate-500 underline hover:text-slate-300"
                >
                  Copy hash
                </button>
              </div>
            )}
          </div>

          {status === 'approving' && (
            <div className="flex items-start gap-3 text-sm text-slate-300">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-400" />
              <div>
                <p className="font-medium text-white">Approve USDC on {activeSource.name}…</p>
                <p className="mt-1 text-xs text-slate-400">
                  Confirm the approval in your wallet. The burn comes next.
                </p>
                {approveHash && (
                  <a
                    href={`${activeSource.explorer}/tx/${approveHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-400 underline"
                  >
                    View approval <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          {status === 'burning' && (
            <div className="flex items-start gap-3 text-sm text-slate-300">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-400" />
              <div>
                <p className="font-medium text-white">Burn USDC on {activeSource.name}…</p>
                <p className="mt-1 text-xs text-slate-400">
                  Approve the CCTP burn in your wallet. The app will wait for Circle's attestation.
                </p>
                {burnHash && (
                  <a
                    href={`${activeSource.explorer}/tx/${burnHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-400 underline"
                  >
                    View burn <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          {status === 'waiting' && (
            <div className="flex items-start gap-3 text-sm text-slate-300">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-400" />
              <div>
                <p className="font-medium text-white">Waiting for Circle attestation…</p>
                <p className="mt-1 text-xs text-slate-400">
                  Standard CCTP from {activeSource.name} can take 15–30 minutes (15–19 minutes from
                  Ethereum Sepolia). The source burn is confirmed; there is no Arc transaction yet.
                  You can switch tabs and come back. This burn is saved in your browser, so a
                  reload restores the pending deposit automatically.
                </p>
              </div>
            </div>
          )}

          {status === 'ready' && (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <div>
                  <p className="text-sm font-medium text-white">
                    Attestation ready — {activeAmountLabel}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Mint to your Arc wallet, then approve and deposit into your agent treasury.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-xs text-slate-400">
                <Fuel className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                <div className="min-w-0 flex-1">
                  <p>
                    The connected wallet pays Arc {ARC_GAS_SYMBOL} gas for the mint, approval, and
                    deposit. USDC is minted to{' '}
                    {owner ? shortAddr(owner) : 'the wallet that started the deposit'}, then
                    deposited into that wallet's agent treasury.
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <a
                      href="https://faucet.circle.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-400 underline hover:text-emerald-300"
                    >
                      Get Arc test USDC
                    </a>
                    <button
                      type="button"
                      onClick={() => void refetchArcGas()}
                      className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200"
                    >
                      <RefreshCw className="h-3 w-3" /> Check gas
                    </button>
                  </div>
                  {activeGas && (
                    <p className={needsArcGas ? 'mt-1 text-amber-300' : 'mt-1 text-slate-500'}>
                      Arc gas: {activeGas.formatted} {ARC_GAS_SYMBOL}
                      {needsArcGas ? ' — fund Arc gas before minting.' : ''}
                    </p>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => { void handleCompleteDeposit() }}
                className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400"
              >
                Mint &amp; Deposit to Treasury
              </button>

              {error && (
                <p className="flex items-start gap-2 text-xs text-red-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {error}
                </p>
              )}
            </div>
          )}

          {status === 'minting' && (
            <div className="flex items-start gap-3 text-sm text-slate-300">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-400" />
              <div>
                <p className="font-medium text-white">Complete the Arc CCTP mint…</p>
                <p className="mt-1 text-xs text-slate-400">
                  Approve the network switch and the Arc transaction. This mints USDC to your
                  wallet; the app then approves the treasury and deposits it.
                </p>
                {mintHash && (
                  <a
                    href={`${ARC_EXPLORER}/tx/${mintHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-400 underline"
                  >
                    View mint <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          {status === 'arc-approving' && (
            <div className="flex items-start gap-3 text-sm text-slate-300">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-400" />
              <div>
                <p className="font-medium text-white">Approve USDC for the treasury…</p>
                <p className="mt-1 text-xs text-slate-400">
                  Confirm the Arc approval. The final step is the treasury deposit.
                </p>
                {arcApproveHash && (
                  <a
                    href={`${ARC_EXPLORER}/tx/${arcApproveHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-400 underline"
                  >
                    View approval <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          {status === 'depositing' && (
            <div className="flex items-start gap-3 text-sm text-slate-300">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-400" />
              <div>
                <p className="font-medium text-white">Deposit into the treasury…</p>
                <p className="mt-1 text-xs text-slate-400">
                  Confirm the Arc deposit. The treasury credits your agent and deploys the USDC
                  into the Morpho vault.
                </p>
                {depositHash && (
                  <a
                    href={`${ARC_EXPLORER}/tx/${depositHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-400 underline"
                  >
                    View deposit <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          {status === 'done' && (
            <div className="flex items-start gap-3 text-sm text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Cross-chain deposit credited</p>
                <p className="mt-1 text-xs text-slate-400">
                  {depositHash
                    ? 'The USDC was minted to your Arc wallet, deposited into your agent treasury, and deployed in the Morpho vault.'
                    : 'This CCTP transfer was already delivered. No further action is needed.'}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {mintHash && (
                    <a
                      href={`${ARC_EXPLORER}/tx/${mintHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-emerald-400 underline hover:text-emerald-300"
                    >
                      View Arc mint <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {depositHash && (
                    <a
                      href={`${ARC_EXPLORER}/tx/${depositHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-emerald-400 underline hover:text-emerald-300"
                    >
                      View treasury deposit <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  onClick={reset}
                  className="mt-2 block rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-400"
                >
                  Start another deposit
                </button>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-3">
              <p className="flex items-start gap-2 text-sm text-red-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {error || 'The cross-chain deposit could not be completed.'}
              </p>
              <div className="flex gap-2">
                {burnHash && (
                  <button
                    type="button"
                    onClick={retryAttestation}
                    className="flex-1 rounded-xl border border-slate-700 py-2.5 text-xs font-medium text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-400"
                  >
                    Retry attestation
                  </button>
                )}
                <button
                  type="button"
                  onClick={reset}
                  className="flex-1 rounded-xl border border-slate-700 py-2.5 text-xs font-medium text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-400"
                >
                  Reset
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      </div>
    </details>
  )
}
