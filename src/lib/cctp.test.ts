import { describe, expect, it } from 'vitest'
import {
  CCTP_DESTINATIONS,
  getCctpDestination,
  getCctpMessageAmount,
  getCctpMessageDestinationCaller,
  getCctpMessageDestinationDomain,
  getCctpMessageHookAgent,
  getCctpMessageMintRecipient,
  getCctpMessageNonce,
  getCctpMessageSourceDomain,
} from './cctp'
import { IS_ARC_MAINNET } from './contracts'

describe('CCTP destinations', () => {
  it('maps domain 0 to the selected network', () => {
    const destination = getCctpDestination(0)
    if (IS_ARC_MAINNET) {
      expect(destination?.chain.id).toBe(1)
      expect(destination?.transmitter).toBe('0x81D40F21F12A8F0E3252Bccb954D722d4c464B64')
      expect(destination?.usdc).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
    } else {
      expect(destination?.chain.id).toBe(11155111)
      expect(destination?.transmitter).toBe('0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275')
      expect(destination?.usdc).toBe('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238')
    }
  })

  it('has a source USDC address for every chain', () => {
    for (const destination of Object.values(CCTP_DESTINATIONS)) {
      expect(destination.usdc).toMatch(/^0x[0-9a-fA-F]{40}$/)
    }
  })

  it('maps every configured destination to a unique chain', () => {
    const chainIds = Object.values(CCTP_DESTINATIONS).map((destination) => destination.chain.id)
    expect(new Set(chainIds).size).toBe(chainIds.length)
  })

  it('does not treat Arc as a destination', () => {
    expect(getCctpDestination(26)).toBeUndefined()
  })
})

describe('CCTP message header', () => {
  it('extracts the nonce from a v2 message', () => {
    const message = `0x${'00000001'}${'0000001a'}${'00000000'}${'11'.repeat(32)}${'22'.repeat(32)}`
    expect(getCctpMessageNonce(message)).toBe(`0x${'11'.repeat(32)}`)
  })

  it('rejects a malformed message', () => {
    expect(() => getCctpMessageNonce('0x1234')).toThrow('Invalid CCTP message header')
  })
})

describe('CCTP v2 BurnMessageV2 layout', () => {
  const RECEIVER = '91f1eb97a40fdab05d150c10566cf9aa3546a375'
  const AGENT = 'd00fd0b006c01342522caf4fa04d5f8910ab268c'
  const word = (value: string) => value.padStart(64, '0')

  // Real layout: 148-byte header, 228-byte fixed body, then raw hookData.
  // The old receiver read a 32-byte length word at body byte 228, which is
  // exactly where the first hookData byte lives.
  const message = `0x${[
    '00000001', // header version
    '00000006', // sourceDomain = Base
    '0000001a', // destinationDomain = Arc (26)
    '11'.repeat(32), // nonce
    word('1111'), // sender
    word('2222'), // recipient (Arc TokenMessenger)
    word(RECEIVER), // destinationCaller
    '000007d0', // minFinalityThreshold
    '000007d0', // finalityThresholdExecuted
    '00000001', // BurnMessageV2 version (body byte 0)
    word('3600000000000000000000000000000000000000'), // burnToken
    word(RECEIVER), // mintRecipient
    word('5f5e100'), // amount = 100 USDC (100_000_000)
    word('1111'), // messageSender
    word('0'), // maxFee
    word('0'), // feeExecuted
    word('0'), // expirationBlock
    word(AGENT), // raw hookData at body byte 228
  ].join('')}`

  it('reads the header and fixed body fields', () => {
    expect(getCctpMessageSourceDomain(message)).toBe(6)
    expect(getCctpMessageDestinationDomain(message)).toBe(26)
    expect(getCctpMessageDestinationCaller(message)).toBe(`0x${word(RECEIVER)}`)
    expect(getCctpMessageMintRecipient(message)).toBe(`0x${RECEIVER}`)
    expect(getCctpMessageAmount(message)).toBe(100_000_000n)
    expect(getCctpMessageNonce(message)).toBe(`0x${'11'.repeat(32)}`)
  })

  it('reads raw hookData at body byte 228 as the agent', () => {
    expect(getCctpMessageHookAgent(message)).toBe(`0x${AGENT}`)
  })

  it('returns undefined when hookData is missing', () => {
    expect(getCctpMessageHookAgent(message.slice(0, 2 + 376 * 2))).toBeUndefined()
  })

  it('rejects a dirty agent word instead of truncating it', () => {
    const dirty = `${message.slice(0, 2 + 376 * 2)}${'01'.padEnd(64, '0')}`
    expect(getCctpMessageHookAgent(dirty)).toBeUndefined()
  })
})
