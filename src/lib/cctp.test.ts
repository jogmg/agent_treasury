import { describe, expect, it } from 'vitest'
import { getCctpDestination, getCctpMessageNonce, CCTP_DESTINATIONS } from './cctp'
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
