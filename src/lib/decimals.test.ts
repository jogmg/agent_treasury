import { describe, it, expect } from 'vitest'
import {
  parseUsdc,
  formatUsdc,
  formatShares,
  formatUsdcDollar,
  formatApy,
  projectYield,
  addrToBytes32,
  USDC_DECIMALS,
  NATIVE_GAS_DECIMALS,
} from './decimals'

describe('constants', () => {
  it('USDC_DECIMALS is 6', () => expect(USDC_DECIMALS).toBe(6))
  it('NATIVE_GAS_DECIMALS is 18 (never use for token math)', () => expect(NATIVE_GAS_DECIMALS).toBe(18))
})

describe('parseUsdc', () => {
  it('parses integer', ()   => expect(parseUsdc('10')).toBe(10_000_000n))
  it('parses decimal',  ()  => expect(parseUsdc('10.50')).toBe(10_500_000n))
  it('parses 6-dec',    ()  => expect(parseUsdc('0.000001')).toBe(1n))
  it('clamps extra dec', () => expect(parseUsdc('1.1234567')).toBe(1_123_456n))
  it('empty string → 0',()  => expect(parseUsdc('')).toBe(0n))
  it('zero',            ()  => expect(parseUsdc('0')).toBe(0n))
  it('handles commas',  ()  => expect(parseUsdc('1,000')).toBe(1_000_000_000n))
  it('handles leading dot', () => expect(parseUsdc('.5')).toBe(500_000n))
  it('invalid input → 0 (no render crash)', () => {
    expect(parseUsdc('abc')).toBe(0n)
    expect(parseUsdc('-1')).toBe(0n)
    expect(parseUsdc('1e3')).toBe(0n)
  })
})

describe('formatShares', () => {
  it('formats 18-dec shares', () => {
    expect(formatShares(1_500_000_000_000_000_000n, 18, 4)).toBe('1.5000')
  })
  it('formats 6-dec shares', () => {
    expect(formatShares(1_500_000n, 6, 2)).toBe('1.50')
  })
  it('zero', () => expect(formatShares(0n, 18, 4)).toBe('0.0000'))
})

describe('formatUsdc', () => {
  it('formats integer', ()     => expect(formatUsdc(10_000_000n)).toBe('10.00'))
  it('formats decimal', ()     => expect(formatUsdc(10_500_000n)).toBe('10.50'))
  it('formats 1 unit', ()      => expect(formatUsdc(1n, 6)).toBe('0.000001'))
  it('zero', ()                => expect(formatUsdc(0n)).toBe('0.00'))
  it('rounds dp=0', ()         => expect(formatUsdc(10_000_000n, 0)).toBe('10'))
})

describe('formatUsdcDollar', () => {
  it('adds dollar sign', ()    => expect(formatUsdcDollar(1_000_000n)).toBe('$1.00'))
  it('groups thousands', ()    => expect(formatUsdcDollar(1_234_567_890n)).toBe('$1,234.56'))
})

describe('formatApy', () => {
  it('4.2% APY', () => expect(formatApy(42_000_000_000_000_000n)).toBe('4.20%'))
  it('100% APY', () => expect(formatApy(BigInt('1000000000000000000'))).toBe('100.00%'))
  it('zero APY', () => expect(formatApy(0n)).toBe('0.00%'))
})

describe('projectYield', () => {
  it('no yield on zero principal', () =>
    expect(projectYield(0n, 42_000_000_000_000_000n, 365)).toBe(0n))
  it('no yield when apy=0, returns principal unchanged', () =>
    expect(projectYield(1_000_000_000n, 0n, 365)).toBe(1_000_000_000n))
  it('grows over 365 days at 4.2%', () => {
    const result = projectYield(1_000_000_000n, 42_000_000_000_000_000n, 365)
    expect(result).toBeGreaterThan(1_000_000_000n)
    expect(result).toBeLessThan(1_100_000_000n)
  })
  it('returns principal for 0 days', () =>
    expect(projectYield(100_000_000n, 42_000_000_000_000_000n, 0)).toBe(100_000_000n))
})

describe('addrToBytes32', () => {
  it('pads 20-byte address to 32 bytes', () => {
    const addr = '0xD00fD0B006c01342522cAf4FA04D5f8910aB268c'
    const b32 = addrToBytes32(addr)
    expect(b32).toHaveLength(66) // '0x' + 64 hex chars
    expect(b32.startsWith('0x')).toBe(true)
    expect(b32.toLowerCase()).toContain(addr.slice(2).toLowerCase())
  })
})
