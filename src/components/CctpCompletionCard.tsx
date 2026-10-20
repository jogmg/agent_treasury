import { useEffect } from 'react'
import { useAccount, useBalance, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Fuel,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import {
  getCctpDestination,
  getCctpMessageNonce,
  MESSAGE_TRANSMITTER_V2_ABI,
  waitForCctpAttestation,
} from '../lib/cctp'
import { formatUsdcDollar, shortAddr } from '../lib/decimals'
import { parseOnchainError } from '../lib/errors'
import { useFlowStore } from '../stores/flow'

interface Props {
  burnTx: string
}

export function CctpCompletionCard({ burnTx }: Props) {
  const { address, chainId } = useAccount()
  const queryClient = useQueryClient()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  const {
    cctpCompletionStatus,
    cctpDestinationDomain,
    cctpAmount,
    cctpRecipient,
    cctpMessage,
    cctpAttestation,
    cctpMintHash,
    cctpCompletionError,
    setCctp,
  } = useFlowStore()

  const destination = Number.isInteger(cctpDestinationDomain)
    ? getCctpDestination(cctpDestinationDomain)
    : undefined

  const destinationClient = usePublicClient({ chainId: destination?.chain.id })
  const { data: destinationBalance, refetch: refetchDestinationBalance } = useBalance({
    address,
    chainId: destination?.chain.id,
    query: { enabled: Boolean(address && destination) },
  })

  const messageNonce = (() => {
    try {
      return cctpMessage ? getCctpMessageNonce(cctpMessage) : null
    } catch {
      return null
    }
  })()

  // Fetch the Circle attestation automatically after the burn. If the tab is
  // closed and reopened, the effect resumes from the stored burn hash.
  useEffect(() => {
    if (!burnTx || cctpCompletionStatus !== 'waiting') return

    const controller = new AbortController()
    let active = true

    void (async () => {
      try {
        const result = await waitForCctpAttestation(burnTx, { signal: controller.signal })
        if (!active) return

        setCctp({
          cctpDestinationDomain: result.destinationDomain,
          cctpAmount: result.amount > 0n ? result.amount.toString() : useFlowStore.getState().cctpAmount,
          cctpRecipient: result.mintRecipient ?? useFlowStore.getState().cctpRecipient,
          cctpMessage: result.message,
          cctpAttestation: result.attestation,
          cctpCompletionStatus: result.forwardTxHash ? 'done' : 'ready',
          cctpMintHash: result.forwardTxHash ?? '',
          cctpCompletionError: '',
        })
      } catch (error) {
        if (!active || controller.signal.aborted) return
        setCctp({
          cctpCompletionStatus: 'error',
          cctpCompletionError:
            error instanceof Error ? error.message : 'Could not fetch the Circle attestation.',
        })
      }
    })()

    return () => {
      active = false
      controller.abort()
    }
  }, [burnTx, cctpCompletionStatus, setCctp])

  // If the destination nonce is already used, this transfer was already
  // minted. Loading the same burn hash again must not offer a transaction that
  // is guaranteed to revert.
  useEffect(() => {
    if (cctpCompletionStatus !== 'ready' || !destinationClient || !destination || !messageNonce) {
      return
    }

    let active = true
    void (async () => {
      try {
        const used = await destinationClient.readContract({
          address: destination.transmitter,
          abi: MESSAGE_TRANSMITTER_V2_ABI,
          functionName: 'usedNonces',
          args: [messageNonce],
        })
        if (active && used) {
          setCctp({ cctpCompletionStatus: 'done', cctpCompletionError: '' })
        }
      } catch {
        // If the RPC check fails, leave the mint button available; the wallet
        // will surface the real error if the message is already used.
      }
    })()

    return () => {
      active = false
    }
  }, [cctpCompletionStatus, destinationClient, destination, messageNonce, setCctp])

  if (!burnTx || cctpCompletionStatus === 'idle') return null

  const rawAmount = (() => {
    try {
      return cctpAmount ? BigInt(cctpAmount) : 0n
    } catch {
      return 0n
    }
  })()
  const gasSymbol = destination?.chain.nativeCurrency.symbol ?? 'gas'
  const needsGas = Boolean(destination && destinationBalance && destinationBalance.value === 0n)

  async function handleMint() {
    if (!address || !destination || !cctpMessage || !cctpAttestation) return

    setCctp({ cctpCompletionStatus: 'minting', cctpCompletionError: '' })
    try {
      if (chainId !== destination.chain.id) {
        await switchChainAsync({ chainId: destination.chain.id })
      }

      if (destinationClient) {
        const gasBalance = await destinationClient.getBalance({ address })
        if (gasBalance === 0n) {
          setCctp({
            cctpCompletionStatus: 'ready',
            cctpCompletionError: `You need a small amount of ${gasSymbol} on ${destination.name} to pay for the mint transaction.`,
          })
          return
        }
      }

      const hash = await writeContractAsync({
        address: destination.transmitter,
        abi: MESSAGE_TRANSMITTER_V2_ABI,
        functionName: 'receiveMessage',
        args: [cctpMessage as `0x${string}`, cctpAttestation as `0x${string}`],
        chainId: destination.chain.id,
      })
      setCctp({ cctpMintHash: hash })

      if (destinationClient) {
        const receipt = await destinationClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new Error('Destination mint reverted')
      }

      setCctp({ cctpCompletionStatus: 'done', cctpCompletionError: '' })
      toast.success(`USDC minted on ${destination.name}`)
      await queryClient.invalidateQueries()
      void refetchDestinationBalance()
    } catch (error) {
      const message = parseOnchainError(error)
      setCctp({ cctpCompletionStatus: 'ready', cctpCompletionError: message })
      if (message !== 'Transaction cancelled.') toast.error(message)
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/70 p-4" aria-live="polite">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Destination mint
        </p>
        <a
          href={`https://explorer.testnet.arc.io/tx/${burnTx}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300"
        >
          Burn tx <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {cctpCompletionStatus === 'waiting' && (
        <div className="flex items-start gap-3 text-sm text-slate-300">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-400" />
          <div>
            <p className="font-medium text-white">Waiting for Circle attestation…</p>
            <p className="mt-1 text-xs text-slate-400">
              The app is polling Iris automatically. Arc-origin attestations usually take under a
              minute. You can leave this tab and come back.
            </p>
          </div>
        </div>
      )}

      {cctpCompletionStatus === 'ready' && destination && (
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-white">
                Attestation ready
                {rawAmount > 0n ? ` — ${formatUsdcDollar(rawAmount)} USDC` : ''}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Mint on {destination.name}. This is the last step; no manual message copying is
                needed.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-xs text-slate-400">
            <Fuel className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <p>
                The mint can be sent by any wallet. The connected wallet pays {gasSymbol} gas;
                USDC is minted to the CCTP recipient.
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                {address && (
                  <span className="font-mono text-slate-500">
                    Gas payer: {shortAddr(address)}
                  </span>
                )}
                {cctpRecipient && (
                  <span className="font-mono text-slate-500">
                    Recipient: {shortAddr(cctpRecipient)}
                  </span>
                )}
                {destination.faucet && (
                  <a
                    href={destination.faucet}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 underline hover:text-emerald-300"
                  >
                    Get {gasSymbol} from a faucet
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => void refetchDestinationBalance()}
                  className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200"
                >
                  <RefreshCw className="h-3 w-3" /> Check balance
                </button>
              </div>
              {destinationBalance && (
                <p className={needsGas ? 'mt-1 text-amber-300' : 'mt-1 text-slate-500'}>
                  Connected wallet gas: {destinationBalance.formatted} {gasSymbol} on{' '}
                  {destination.name}
                  {needsGas ? ' — fund gas before minting.' : ''}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => { void handleMint() }}
            className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400"
          >
            Mint on {destination.name}
          </button>

          {cctpCompletionError && (
            <p className="flex items-start gap-2 text-xs text-red-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {cctpCompletionError}
            </p>
          )}
        </div>
      )}

      {cctpCompletionStatus === 'ready' && !destination && (
        <div className="flex items-start gap-2 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            Automatic mint is not configured for CCTP domain {cctpDestinationDomain} yet. Use{' '}
            <code>scripts/complete-cctp.ts</code> to finish this transfer.
          </p>
        </div>
      )}

      {cctpCompletionStatus === 'minting' && (
        <div className="flex items-start gap-3 text-sm text-slate-300">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-400" />
          <div>
            <p className="font-medium text-white">Complete the mint in your wallet…</p>
            <p className="mt-1 text-xs text-slate-400">
              Approve the network switch and the {destination?.name ?? 'destination'} transaction.
            </p>
          </div>
        </div>
      )}

      {cctpCompletionStatus === 'done' && (
        <div className="flex items-start gap-3 text-sm text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">
              {cctpMintHash
                ? `USDC minted on ${destination?.name ?? 'the destination chain'}`
                : 'Transfer already minted'}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {cctpMintHash
                ? `The funds are in the CCTP recipient wallet${cctpRecipient ? ` (${shortAddr(cctpRecipient)})` : ''}.`
                : `This CCTP nonce has already been used on ${destination?.name ?? 'the destination chain'}. Re-submitting would revert; no further action is needed.`}
            </p>
            {cctpMintHash && destination && (
              <a
                href={`${destination.explorer}/tx/${cctpMintHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-400 underline hover:text-emerald-300"
              >
                View mint tx <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {!cctpMintHash && cctpRecipient && destination && (
              <a
                href={`${destination.explorer}/address/${cctpRecipient}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-400 underline hover:text-emerald-300"
              >
                View recipient on explorer <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      )}

      {cctpCompletionStatus === 'error' && (
        <div className="space-y-3">
          <p className="flex items-start gap-2 text-sm text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {cctpCompletionError || 'Could not fetch the Circle attestation.'}
          </p>
          <button
            type="button"
            onClick={() => setCctp({ cctpCompletionStatus: 'waiting', cctpCompletionError: '' })}
            className="w-full rounded-xl border border-slate-700 py-2.5 text-xs font-medium text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-400"
          >
            Retry attestation
          </button>
        </div>
      )}
    </div>
  )
}
