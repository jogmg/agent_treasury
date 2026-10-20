import { describe, expect, it } from 'vitest'
import { getCctpDestination, CCTP_DESTINATIONS } from './cctp'

describe('CCTP destinations', () => {
  it('maps Ethereum Sepolia (domain 0)', () => {
    const destination = getCctpDestination(0)
    expect(destination?.chain.id).toBe(11155111)
    expect(destination?.transmitter).toBe('0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275')
  })

  it('maps every configured destination to a unique chain', () => {
    const chainIds = Object.values(CCTP_DESTINATIONS).map((destination) => destination.chain.id)
    expect(new Set(chainIds).size).toBe(chainIds.length)
  })

  it('does not treat Arc as a destination', () => {
    expect(getCctpDestination(26)).toBeUndefined()
  })
})
