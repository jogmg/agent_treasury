/**
 * Pure CCTP v2 message parsing.
 *
 * This file is shared by the browser app and the Hermes server so both use the
 * exact same offsets. It intentionally has no network, environment, or browser
 * dependencies.
 *
 * Layout:
 *   header: 148 bytes
 *   BurnMessageV2 fixed body: 228 bytes
 *   hookData: starts at absolute byte 376
 */

const HEADER_VERSION_BYTES = 4
const BODY_FIXED_BYTES = 228
const HOOK_DATA_OFFSET = 148 + BODY_FIXED_BYTES

/** Read exactly `length` bytes from a 0x-prefixed hex string. */
function hexSlice(message: string, byteOffset: number, length: number): string {
  const start = 2 + byteOffset * 2
  const end = start + length * 2
  if (!message.startsWith('0x') || message.length < end) {
    throw new Error('Invalid CCTP message')
  }
  return message.slice(start, end)
}

/**
 * The CCTP message header is:
 *   version (4) | sourceDomain (4) | destinationDomain (4) | nonce (32) | ...
 * The nonce is the key used by MessageTransmitterV2.usedNonces on the
 * destination chain. It lets the UI tell whether a transfer was already minted.
 */
export function getCctpMessageNonce(message: string): `0x${string}` {
  // Nonce is a 32-byte value, right-aligned in a 32-byte header word.
  const nonce = message.slice(2 + 24, 2 + 24 + 64)
  if (!/^[0-9a-fA-F]{64}$/.test(nonce)) {
    throw new Error('Invalid CCTP message header')
  }
  return `0x${nonce}`
}

export function getCctpMessageSourceDomain(message: string): number {
  return Number(BigInt(`0x${hexSlice(message, 4, 4)}`))
}

export function getCctpMessageDestinationDomain(message: string): number {
  return Number(BigInt(`0x${hexSlice(message, 8, 4)}`))
}

/** 32-byte destinationCaller field from the header. */
export function getCctpMessageDestinationCaller(message: string): `0x${string}` {
  return `0x${hexSlice(message, 108, 32)}`
}

/** 20-byte mintRecipient from the BurnMessageV2 body. */
export function getCctpMessageMintRecipient(message: string): `0x${string}` {
  const word = hexSlice(message, 184, 32)
  return `0x${word.slice(24)}`
}

/** 20-byte burnToken from the BurnMessageV2 body. */
export function getCctpMessageBurnToken(message: string): `0x${string}` {
  const word = hexSlice(message, 152, 32)
  return `0x${word.slice(24)}`
}

/** USDC amount (6 decimals) from the BurnMessageV2 body. */
export function getCctpMessageAmount(message: string): bigint {
  return BigInt(`0x${hexSlice(message, 216, 32)}`)
}

/**
 * Agent encoded in raw hookData. The real BurnMessageV2 body has 228 fixed
 * bytes, so hookData starts at absolute byte 376. The source app sends
 * abi.encode(agent): one 32-byte word.
 */
export function getCctpMessageHookAgent(message: string): string | undefined {
  try {
    const word = hexSlice(message, HOOK_DATA_OFFSET, 32)
    if (word.slice(0, 24) !== '0'.repeat(24)) return undefined
    const agent = `0x${word.slice(24)}`
    return /^0x0{40}$/.test(agent) ? undefined : agent
  } catch {
    return undefined
  }
}

export { BODY_FIXED_BYTES, HEADER_VERSION_BYTES, HOOK_DATA_OFFSET }
