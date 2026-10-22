/**
 * CCTP v2 completion helpers.
 *
 * A cross-chain withdrawal is burn -> Circle attestation -> destination mint.
 * The burn is the only transaction the treasury can submit on Arc; the app
 * polls Iris for the attestation and then asks the user to submit the mint on
 * the destination chain.
 */
import {
  createPublicClient,
  fallback,
  http,
  parseAbi,
  parseAbiItem,
  type Chain,
  type PublicClient,
} from 'viem'
import {
  arbitrum,
  arbitrumSepolia,
  avalanche,
  avalancheFuji,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sepolia,
} from 'viem/chains'
import { ARC_CCTP_DOMAIN, IS_ARC_MAINNET } from './contracts'
import {
  getCctpMessageAmount,
  getCctpMessageDestinationDomain,
  getCctpMessageMintRecipient,
  getCctpMessageNonce,
  getCctpMessageSourceDomain,
} from '../../shared/cctp-message'

export {
  getCctpMessageAmount,
  getCctpMessageBurnToken,
  getCctpMessageDestinationCaller,
  getCctpMessageDestinationDomain,
  getCctpMessageHookAgent,
  getCctpMessageMintRecipient,
  getCctpMessageNonce,
  getCctpMessageSourceDomain,
} from '../../shared/cctp-message'

export { ARC_CCTP_DOMAIN }

// Circle's production Iris API attests mainnet burns; sandbox attests testnets.
export const IRIS_API = IS_ARC_MAINNET
  ? 'https://iris-api.circle.com'
  : 'https://iris-api-sandbox.circle.com'

// CCTP v2 mainnet and testnet use different deterministic deployments.
export const TOKEN_MESSENGER_V2 = (IS_ARC_MAINNET
  ? '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'
  : '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA') as `0x${string}`

export const MESSAGE_TRANSMITTER_V2 = (IS_ARC_MAINNET
  ? '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64'
  : '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275') as `0x${string}`

export const MESSAGE_TRANSMITTER_V2_ABI = parseAbi([
  'function receiveMessage(bytes message, bytes attestation) external returns (bool)',
  'function usedNonces(bytes32 nonce) external view returns (uint256)',
])

// Emitted by MessageTransmitterV2 when a message is delivered. `nonce` is
// indexed, so one getLogs call can find the destination mint tx for a burn.
export const MESSAGE_RECEIVED_EVENT = parseAbiItem(
  'event MessageReceived(address indexed caller, uint32 sourceDomain, bytes32 indexed nonce, bytes32 sender, uint32 indexed finalityThresholdExecuted, bytes messageBody)',
)

export const TOKEN_MESSENGER_V2_ABI = parseAbi([
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) external',
  'function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData) external',
])

export interface CctpDestination {
  domain: number
  name: string
  chain: Chain
  /** Canonical USDC on the source/destination chain. */
  usdc: `0x${string}`
  transmitter: `0x${string}`
  explorer: string
  faucet?: string
}

const TESTNET_DESTINATIONS: Record<number, CctpDestination> = {
  0: {
    domain: 0,
    name: 'Ethereum Sepolia',
    chain: sepolia,
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    transmitter: MESSAGE_TRANSMITTER_V2,
    explorer: 'https://sepolia.etherscan.io',
    faucet: 'https://www.alchemy.com/faucets/ethereum-sepolia',
  },
  1: {
    domain: 1,
    name: 'Avalanche Fuji',
    chain: avalancheFuji,
    usdc: '0x5425890298aed601595a70AB815c96711a31Bc65',
    transmitter: MESSAGE_TRANSMITTER_V2,
    explorer: 'https://testnet.snowtrace.io',
    faucet: 'https://www.alchemy.com/faucets/avalanche-fuji',
  },
  2: {
    domain: 2,
    name: 'OP Sepolia',
    chain: optimismSepolia,
    usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
    transmitter: MESSAGE_TRANSMITTER_V2,
    explorer: 'https://sepolia-optimism.etherscan.io',
    faucet: 'https://www.alchemy.com/faucets/optimism-sepolia',
  },
  3: {
    domain: 3,
    name: 'Arbitrum Sepolia',
    chain: arbitrumSepolia,
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    transmitter: MESSAGE_TRANSMITTER_V2,
    explorer: 'https://sepolia.arbiscan.io',
    faucet: 'https://www.alchemy.com/faucets/arbitrum-sepolia',
  },
  6: {
    domain: 6,
    name: 'Base Sepolia',
    chain: baseSepolia,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    transmitter: MESSAGE_TRANSMITTER_V2,
    explorer: 'https://sepolia.basescan.org',
    faucet: 'https://www.alchemy.com/faucets/base-sepolia',
  },
  7: {
    domain: 7,
    name: 'Polygon Amoy',
    chain: polygonAmoy,
    usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    transmitter: MESSAGE_TRANSMITTER_V2,
    explorer: 'https://amoy.polygonscan.com',
    faucet: 'https://www.alchemy.com/faucets/polygon-amoy',
  },
}

const MAINNET_DESTINATIONS: Record<number, CctpDestination> = {
  0: {
    domain: 0,
    name: 'Ethereum',
    chain: mainnet,
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    transmitter: MESSAGE_TRANSMITTER_V2,
    explorer: 'https://etherscan.io',
  },
  1: {
    domain: 1,
    name: 'Avalanche',
    chain: avalanche,
    usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    transmitter: MESSAGE_TRANSMITTER_V2,
    explorer: 'https://snowtrace.io',
  },
  2: {
    domain: 2,
    name: 'Optimism',
    chain: optimism,
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    transmitter: MESSAGE_TRANSMITTER_V2,
    explorer: 'https://optimistic.etherscan.io',
  },
  3: {
    domain: 3,
    name: 'Arbitrum',
    chain: arbitrum,
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    transmitter: MESSAGE_TRANSMITTER_V2,
    explorer: 'https://arbiscan.io',
  },
  6: {
    domain: 6,
    name: 'Base',
    chain: base,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    transmitter: MESSAGE_TRANSMITTER_V2,
    explorer: 'https://basescan.org',
  },
  7: {
    domain: 7,
    name: 'Polygon',
    chain: polygon,
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    transmitter: MESSAGE_TRANSMITTER_V2,
    explorer: 'https://polygonscan.com',
  },
}

export const CCTP_DESTINATIONS = IS_ARC_MAINNET ? MAINNET_DESTINATIONS : TESTNET_DESTINATIONS

export function getCctpDestination(domain: number): CctpDestination | undefined {
  return CCTP_DESTINATIONS[domain]
}

export const CCTP_DESTINATION_CHAINS = Array.from(
  new Set(Object.values(CCTP_DESTINATIONS).map((destination) => destination.chain)),
)

interface IrisDecodedMessageBody {
  amount?: string
  mintRecipient?: string
}

interface IrisDecodedMessage {
  destinationDomain?: string
  decodedMessageBody?: IrisDecodedMessageBody
}

interface IrisMessage {
  message?: string
  attestation?: string
  status?: string
  cctpVersion?: number
  forwardTxHash?: string
  decodedMessage?: IrisDecodedMessage
}

interface IrisResponse {
  messages?: IrisMessage[]
}

export interface CctpAttestation {
  message: `0x${string}`
  attestation: `0x${string}`
  destinationDomain: number
  amount: bigint
  mintRecipient?: `0x${string}`
  forwardTxHash?: `0x${string}`
}

function isHex(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value)
}

/**
 * Fetch the first CCTP v2 message for a burn transaction. This returns the
 * message even while Iris is still attesting it, so the UI can show the
 * destination domain/nonce before the attestation is complete. A 404 means
 * Iris has not indexed the burn yet.
 */
async function fetchIrisMessage(
  burnTx: string,
  sourceDomain: number,
): Promise<IrisMessage | null> {
  const url = `${IRIS_API}/v2/messages/${sourceDomain}?transactionHash=${encodeURIComponent(burnTx)}`
  const response = await fetch(url)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Circle Iris returned ${response.status}`)
  }

  const data = (await response.json()) as IrisResponse
  return data.messages?.find((entry) => Number(entry.cctpVersion) === 2) ?? null
}

/**
 * Fetch the CCTP v2 attestation for a burn transaction.
 * Returns null while Iris has not attested the message yet.
 */
export async function fetchCctpAttestation(
  burnTx: string,
  sourceDomain = ARC_CCTP_DOMAIN,
): Promise<CctpAttestation | null> {
  const message = await fetchIrisMessage(burnTx, sourceDomain)
  if (!message || message.status !== 'complete') return null
  if (!isHex(message.message) || !isHex(message.attestation)) return null

  const destinationDomain = Number(message.decodedMessage?.destinationDomain)
  if (!Number.isInteger(destinationDomain)) return null

  const rawAmount = message.decodedMessage?.decodedMessageBody?.amount
  let amount = 0n
  try {
    amount = rawAmount ? BigInt(rawAmount) : 0n
  } catch {
    amount = 0n
  }

  const rawRecipient = message.decodedMessage?.decodedMessageBody?.mintRecipient
  const forwardTxHash = isHex(message.forwardTxHash) ? message.forwardTxHash : undefined

  return {
    message: message.message,
    attestation: message.attestation,
    destinationDomain,
    amount,
    mintRecipient: isHex(rawRecipient) ? rawRecipient : undefined,
    forwardTxHash,
  }
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
  mintRecipient?: `0x${string}`
  message?: `0x${string}`
  attestation?: `0x${string}`
  mintTxHash?: string
  mintBlockNumber?: bigint
  forwardTxHash?: `0x${string}`
  error?: string
}

// Public RPC fallbacks for destination reads. The chain defaults are used too,
// but Base in particular rate-limits eth_getLogs aggressively, so put a couple
// of independent endpoints in front of it.
const CCTP_RPC_FALLBACKS: Record<number, string[]> = IS_ARC_MAINNET
  ? {
      0: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
      1: ['https://avalanche-c-chain-rpc.publicnode.com'],
      2: ['https://optimism-rpc.publicnode.com'],
      3: ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc'],
      6: ['https://base-rpc.publicnode.com', 'https://base.drpc.org', 'https://mainnet.base.org'],
      7: ['https://polygon-bor-rpc.publicnode.com'],
    }
  : {
      0: ['https://ethereum-sepolia-rpc.publicnode.com'],
      1: ['https://avalanche-fuji-c-chain-rpc.publicnode.com'],
      2: ['https://optimism-sepolia-rpc.publicnode.com'],
      3: ['https://arbitrum-sepolia-rpc.publicnode.com'],
      6: ['https://base-sepolia-rpc.publicnode.com', 'https://sepolia.base.org'],
      7: ['https://polygon-amoy-bor-rpc.publicnode.com'],
    }

function createDestinationClient(destination: CctpDestination): PublicClient {
  const urls = [...new Set([
    ...(CCTP_RPC_FALLBACKS[destination.domain] ?? []),
    ...destination.chain.rpcUrls.default.http,
  ])]
  return createPublicClient({
    chain: destination.chain,
    transport: fallback(urls.map((url) => http(url, { timeout: 10_000, retryCount: 1 }))),
  })
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown RPC error'
}

/**
 * Find the destination MessageReceived log for a nonce. Circle's forwarder tx
 * is used first when Iris reports one; otherwise scan recent chunks backwards.
 * Returns null when the mint tx cannot be located (delivery status is still
 * known from usedNonces, so the UI can show "Delivered" without a link).
 */
async function findMessageReceived(
  client: PublicClient,
  destination: CctpDestination,
  nonce: `0x${string}`,
  forwardTxHash?: `0x${string}`,
): Promise<{ txHash: string; blockNumber: bigint } | null> {
  if (forwardTxHash) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: forwardTxHash })
      if (receipt.status === 'success') {
        return { txHash: forwardTxHash, blockNumber: receipt.blockNumber }
      }
    } catch {
      // Not indexed by this RPC; fall back to a log scan.
    }
  }

  let latest: bigint
  try {
    latest = await client.getBlockNumber()
  } catch {
    return null
  }

  const chunk = 5_000n
  const maxChunks = 120n // ~600k blocks; recent enough for normal attestations
  let end = latest
  for (let i = 0n; i < maxChunks && end > 0n; i++) {
    const start = end >= chunk ? end - chunk + 1n : 0n
    try {
      const logs = await client.getLogs({
        address: destination.transmitter,
        event: MESSAGE_RECEIVED_EVENT,
        args: { nonce },
        fromBlock: start,
        toBlock: end,
      })
      if (logs.length > 0) {
        const log = logs[logs.length - 1]
        return { txHash: log.transactionHash, blockNumber: log.blockNumber ?? 0n }
      }
    } catch {
      // Some public RPCs reject archive ranges; keep walking backwards.
    }
    if (start === 0n) break
    end = start - 1n
  }

  return null
}

/**
 * Resolve an outbound CCTP withdrawal from its Arc burn tx without relying on
 * AgentTreasury's legacy executeWithdrawal bookkeeping:
 *   Arc WithdrawalRequested tx -> Iris message/attestation -> destination
 *   usedNonces + MessageReceived log.
 *
 * A complete attestation with no destination delivery is `ready` (the mint is
 * still pending). Iris still attesting is `waiting`. A used nonce is `done`.
 */
export async function resolveCctpWithdrawal(
  burnTx: string,
  options: { sourceDomain?: number; checkDestination?: boolean } = {},
): Promise<CctpWithdrawalStatus> {
  const sourceDomain = options.sourceDomain ?? ARC_CCTP_DOMAIN
  const status: CctpWithdrawalStatus = {
    burnTx,
    sourceDomain,
    destinationDomain: 0,
    phase: 'waiting',
    attestationComplete: false,
    delivered: false,
  }

  let iris: IrisMessage | null
  try {
    iris = await fetchIrisMessage(burnTx, sourceDomain)
  } catch (error) {
    return { ...status, phase: 'error', error: `Could not reach Circle Iris: ${errorText(error)}` }
  }

  if (!iris) return status

  // Use Iris's decoded fields for an early display, even before attestation.
  const decodedDestination = Number(iris.decodedMessage?.destinationDomain)
  if (Number.isInteger(decodedDestination) && decodedDestination > 0) {
    status.destinationDomain = decodedDestination
  }
  const decodedAmount = iris.decodedMessage?.decodedMessageBody?.amount
  if (decodedAmount) {
    try { status.amount = BigInt(decodedAmount) } catch { /* ignore */ }
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
    status.mintRecipient = getCctpMessageMintRecipient(iris.message)
  } catch {
    return { ...status, phase: 'error', error: 'The attested CCTP message has an invalid header.' }
  }

  if (options.checkDestination === false) {
    return { ...status, phase: 'ready' }
  }

  const destination = getCctpDestination(status.destinationDomain)
  if (!destination) {
    return {
      ...status,
      phase: 'ready',
      error: `Destination CCTP domain ${status.destinationDomain} is not configured in this build.`,
    }
  }

  const nonce = status.nonce
  if (!nonce) {
    return { ...status, phase: 'error', error: 'The attested CCTP message is missing its nonce.' }
  }

  try {
    const client = createDestinationClient(destination)
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

    const mint = await findMessageReceived(client, destination, nonce, status.forwardTxHash)
    if (mint) {
      status.mintTxHash = mint.txHash
      status.mintBlockNumber = mint.blockNumber
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

interface WaitOptions {
  intervalMs?: number
  timeoutMs?: number
  signal?: AbortSignal
  /** CCTP domain that emitted the burn. Defaults to Arc for withdrawals. */
  sourceDomain?: number
}

function abortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError')
  }
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Poll Iris until the burn has a complete attestation. Network and rate-limit
 * failures are retried; the caller can abort when the UI unmounts.
 */
export async function waitForCctpAttestation(
  burnTx: string,
  options: WaitOptions = {},
): Promise<CctpAttestation> {
  const intervalMs = options.intervalMs ?? 5_000
  const timeoutMs = options.timeoutMs ?? 30 * 60_000
  const startedAt = Date.now()
  let lastError: unknown

  while (true) {
    if (options.signal?.aborted) throw abortError()

    try {
      const attestation = await fetchCctpAttestation(
        burnTx,
        options.sourceDomain ?? ARC_CCTP_DOMAIN,
      )
      if (attestation) return attestation
      lastError = undefined
    } catch (error) {
      lastError = error
    }

    if (Date.now() - startedAt >= timeoutMs) {
      const detail = lastError instanceof Error ? ` (${lastError.message})` : ''
      throw new Error(`Timed out waiting for Circle attestation${detail}. The burn is safe; retry later.`)
    }

    await sleep(intervalMs, options.signal)
  }
}
