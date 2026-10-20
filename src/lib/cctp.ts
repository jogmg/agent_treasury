/**
 * CCTP v2 completion helpers.
 *
 * A cross-chain withdrawal is burn -> Circle attestation -> destination mint.
 * The burn is the only transaction the treasury can submit on Arc; the app
 * polls Iris for the attestation and then asks the user to submit the mint on
 * the destination chain.
 */
import { parseAbi, type Chain } from 'viem'
import {
  arbitrumSepolia,
  avalancheFuji,
  baseSepolia,
  optimismSepolia,
  polygonAmoy,
  sepolia,
} from 'viem/chains'

export const IRIS_SANDBOX_API = 'https://iris-api-sandbox.circle.com'
export const ARC_CCTP_DOMAIN = 26

// CCTP v2 testnet contracts use the same deterministic addresses on every EVM
// testnet. Keep the source of truth in one place.
const MESSAGE_TRANSMITTER_V2 = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275' as const

export const MESSAGE_TRANSMITTER_V2_ABI = parseAbi([
  'function receiveMessage(bytes message, bytes attestation) external returns (bool)',
  'function usedNonces(bytes32 nonce) external view returns (bool)',
])

/**
 * The CCTP message header is:
 *   version (4) | sourceDomain (4) | destinationDomain (4) | nonce (32) | ...
 * The nonce is the key used by MessageTransmitterV2.usedNonces on the
 * destination chain. It lets the UI tell whether a transfer was already minted.
 */
export function getCctpMessageNonce(message: string): `0x${string}` {
  const nonce = message.slice(2 + 24, 2 + 24 + 64)
  if (!/^[0-9a-fA-F]{64}$/.test(nonce)) {
    throw new Error('Invalid CCTP message header')
  }
  return `0x${nonce}`
}

export interface CctpDestination {
  domain: number
  name: string
  chain: Chain
  transmitter: `0x${string}`
  explorer: string
  faucet?: string
}

export const CCTP_DESTINATIONS: Record<number, CctpDestination> = {
  0: {
    domain: 0,
    name: 'Ethereum Sepolia',
    chain: sepolia,
    transmitter: MESSAGE_TRANSMITTER_V2,
    explorer: 'https://sepolia.etherscan.io',
    faucet: 'https://www.alchemy.com/faucets/ethereum-sepolia',
  },
  1: {
    domain: 1,
    name: 'Avalanche Fuji',
    chain: avalancheFuji,
    transmitter: MESSAGE_TRANSMITTER_V2,
    explorer: 'https://testnet.snowtrace.io',
    faucet: 'https://www.alchemy.com/faucets/avalanche-fuji',
  },
  2: {
    domain: 2,
    name: 'OP Sepolia',
    chain: optimismSepolia,
    transmitter: MESSAGE_TRANSMITTER_V2,
    explorer: 'https://sepolia-optimism.etherscan.io',
    faucet: 'https://www.alchemy.com/faucets/optimism-sepolia',
  },
  3: {
    domain: 3,
    name: 'Arbitrum Sepolia',
    chain: arbitrumSepolia,
    transmitter: MESSAGE_TRANSMITTER_V2,
    explorer: 'https://sepolia.arbiscan.io',
    faucet: 'https://www.alchemy.com/faucets/arbitrum-sepolia',
  },
  6: {
    domain: 6,
    name: 'Base Sepolia',
    chain: baseSepolia,
    transmitter: MESSAGE_TRANSMITTER_V2,
    explorer: 'https://sepolia.basescan.org',
    faucet: 'https://www.alchemy.com/faucets/base-sepolia',
  },
  7: {
    domain: 7,
    name: 'Polygon Amoy',
    chain: polygonAmoy,
    transmitter: MESSAGE_TRANSMITTER_V2,
    explorer: 'https://amoy.polygonscan.com',
    faucet: 'https://www.alchemy.com/faucets/polygon-amoy',
  },
}

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
 * Fetch the CCTP v2 attestation for a burn transaction.
 * Returns null while Iris has not attested the message yet.
 */
export async function fetchCctpAttestation(
  burnTx: string,
  sourceDomain = ARC_CCTP_DOMAIN,
): Promise<CctpAttestation | null> {
  const url = `${IRIS_SANDBOX_API}/v2/messages/${sourceDomain}?transactionHash=${encodeURIComponent(burnTx)}`
  const response = await fetch(url)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Circle Iris returned ${response.status}`)
  }

  const data = (await response.json()) as IrisResponse
  const message = data.messages?.find((entry) => entry.cctpVersion === 2)
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

interface WaitOptions {
  intervalMs?: number
  timeoutMs?: number
  signal?: AbortSignal
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
      const attestation = await fetchCctpAttestation(burnTx)
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
