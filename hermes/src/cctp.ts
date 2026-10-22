import {
  createPublicClient,
  defineChain,
  fallback,
  formatUnits,
  http,
  type PublicClient,
} from 'viem'
import {
  getCctpMessageAmount,
  getCctpMessageDestinationDomain,
  getCctpMessageMintRecipient,
  getCctpMessageNonce,
  getCctpMessageSourceDomain,
} from '../../shared/cctp-message'
import { MESSAGE_TRANSMITTER_V2_ABI } from './abis'
import { getCctpDestination, type CctpDestination } from './cctp-destinations'
import type { HermesConfig } from './config'

interface IrisMessage {
  message?: string
  attestation?: string
  status?: string
  cctpVersion?: number
  forwardTxHash?: string
  decodedMessage?: {
    destinationDomain?: string
    decodedMessageBody?: {
      amount?: string
      mintRecipient?: string
    }
  }
}

interface IrisResponse {
  messages?: IrisMessage[]
}

export interface CctpWithdrawalStatus {
  burnTx: string
  sourceDomain: number
  destinationDomain: number
  /** waiting: no complete attestation; ready: attested, not delivered; done: delivered. */
  phase: 'waiting' | 'ready' | 'done' | 'error'
  attestationComplete: boolean
  delivered: boolean
  nonce?: `0x${string}`
  amount?: bigint
  amountUsdc?: string
  mintRecipient?: `0x${string}`
  message?: `0x${string}`
  attestation?: `0x${string}`
  mintTxHash?: string
  mintBlockNumber?: string
  forwardTxHash?: `0x${string}`
  checkedAt: string
  error?: string
}

function isHex(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown RPC error'
}

export async function fetchIrisMessage(
  config: HermesConfig,
  burnTx: string,
  sourceDomain: number,
): Promise<IrisMessage | null> {
  const url = `${config.network.irisApiUrl}/v2/messages/${sourceDomain}?transactionHash=${encodeURIComponent(burnTx)}`
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Circle Iris returned ${response.status}`)
  }
  const data = (await response.json()) as IrisResponse
  return data.messages?.find((entry) => Number(entry.cctpVersion) === 2) ?? null
}

function destinationClient(destination: CctpDestination): PublicClient {
  const chain = defineChain({
    id: destination.chainId,
    name: destination.name,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [...destination.rpcUrls] } },
  })
  return createPublicClient({
    chain,
    transport: fallback(
      destination.rpcUrls.map((url) => http(url, { timeout: 5_000, retryCount: 0 })),
      { rank: false },
    ),
  })
}

async function findForwardedMint(
  client: PublicClient,
  forwardTxHash?: `0x${string}`,
): Promise<{ txHash: string; blockNumber: bigint } | null> {
  if (!forwardTxHash) return null
  try {
    const receipt = await client.getTransactionReceipt({ hash: forwardTxHash })
    if (receipt.status === 'success') {
      return { txHash: forwardTxHash, blockNumber: receipt.blockNumber }
    }
  } catch {
    // Not indexed by this RPC; delivery is already proven by usedNonces.
  }
  return null
}

/**
 * Resolve an outbound CCTP withdrawal from its Arc burn transaction.
 *
 * Completion is derived from Iris + destination usedNonces. The AgentTreasury
 * `executed` flag is bookkeeping only and is deliberately ignored here.
 */
export async function resolveCctpWithdrawal(
  config: HermesConfig,
  burnTx: string,
  options: { sourceDomain?: number; checkDestination?: boolean } = {},
): Promise<CctpWithdrawalStatus> {
  const sourceDomain = options.sourceDomain ?? config.network.cctpDomain
  const status: CctpWithdrawalStatus = {
    burnTx,
    sourceDomain,
    destinationDomain: 0,
    phase: 'waiting',
    attestationComplete: false,
    delivered: false,
    checkedAt: new Date().toISOString(),
  }

  let iris: IrisMessage | null
  try {
    iris = await fetchIrisMessage(config, burnTx, sourceDomain)
  } catch (error) {
    return {
      ...status,
      phase: 'error',
      error: `Could not reach Circle Iris: ${errorText(error)}`,
    }
  }

  if (!iris) return status

  const decodedDestination = Number(iris.decodedMessage?.destinationDomain)
  if (Number.isInteger(decodedDestination) && decodedDestination > 0) {
    status.destinationDomain = decodedDestination
  }
  const decodedAmount = iris.decodedMessage?.decodedMessageBody?.amount
  if (decodedAmount) {
    try {
      status.amount = BigInt(decodedAmount)
      status.amountUsdc = formatUnits(status.amount, 6)
    } catch {
      // Ignore malformed Iris amount; the attested message is authoritative.
    }
  }
  const decodedRecipient = iris.decodedMessage?.decodedMessageBody?.mintRecipient
  if (isHex(decodedRecipient)) status.mintRecipient = decodedRecipient
  if (isHex(iris.forwardTxHash)) status.forwardTxHash = iris.forwardTxHash

  if (isHex(iris.message)) {
    try {
      status.nonce = getCctpMessageNonce(iris.message)
      status.sourceDomain = getCctpMessageSourceDomain(iris.message)
      status.destinationDomain = getCctpMessageDestinationDomain(iris.message)
      status.amount = getCctpMessageAmount(iris.message)
      status.amountUsdc = formatUnits(status.amount, 6)
      status.mintRecipient = getCctpMessageMintRecipient(iris.message)
    } catch {
      // Keep the Iris-decoded values; complete messages are validated below.
    }
  }

  if (iris.status !== 'complete' || !isHex(iris.message) || !isHex(iris.attestation)) {
    return status
  }

  status.attestationComplete = true
  status.message = iris.message
  status.attestation = iris.attestation

  try {
    status.nonce = getCctpMessageNonce(iris.message)
    status.sourceDomain = getCctpMessageSourceDomain(iris.message)
    status.destinationDomain = getCctpMessageDestinationDomain(iris.message)
    status.amount = getCctpMessageAmount(iris.message)
    status.amountUsdc = formatUnits(status.amount, 6)
    status.mintRecipient = getCctpMessageMintRecipient(iris.message)
  } catch {
    return {
      ...status,
      phase: 'error',
      error: 'The attested CCTP message has an invalid header.',
    }
  }

  if (options.checkDestination === false) {
    return { ...status, phase: 'ready' }
  }

  const destination = getCctpDestination(config, status.destinationDomain)
  if (!destination) {
    return {
      ...status,
      phase: 'ready',
      error: `Destination CCTP domain ${status.destinationDomain} is not configured.`,
    }
  }

  const nonce = status.nonce
  if (!nonce) {
    return { ...status, phase: 'error', error: 'The attested message is missing its nonce.' }
  }

  try {
    const client = destinationClient(destination)
    const used = await client.readContract({
      address: destination.transmitter,
      abi: MESSAGE_TRANSMITTER_V2_ABI,
      functionName: 'usedNonces',
      args: [nonce],
    })

    if (used === 0n) {
      return { ...status, phase: 'ready' }
    }

    status.delivered = true
    status.phase = 'done'

    const mint = await findForwardedMint(client, status.forwardTxHash)
    if (mint) {
      status.mintTxHash = mint.txHash
      status.mintBlockNumber = mint.blockNumber.toString()
    } else if (status.forwardTxHash) {
      status.mintTxHash = status.forwardTxHash
    }

    return status
  } catch (error) {
    // Circle's forwarder tx is a strong delivery signal when the destination
    // RPC is unavailable. Otherwise the attestation is ready but unverified.
    if (status.forwardTxHash) {
      return {
        ...status,
        phase: 'done',
        delivered: true,
        mintTxHash: status.forwardTxHash,
        error: undefined,
      }
    }
    return {
      ...status,
      phase: 'ready',
      error: `Attested, but the destination RPC could not be checked: ${errorText(error)}`,
    }
  }
}
