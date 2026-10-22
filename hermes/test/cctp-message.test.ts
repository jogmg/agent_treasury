import { describe, expect, it } from 'vitest'
import {
  getCctpMessageAmount,
  getCctpMessageDestinationCaller,
  getCctpMessageDestinationDomain,
  getCctpMessageHookAgent,
  getCctpMessageMintRecipient,
  getCctpMessageNonce,
  getCctpMessageSourceDomain,
} from '../../shared/cctp-message'

describe('shared CCTP v2 message parser', () => {
  const RECEIVER = '91f1eb97a40fdab05d150c10566cf9aa3546a375'
  const AGENT = 'd00fd0b006c01342522caf4fa04d5f8910ab268c'
  const word = (value: string) => value.padStart(64, '0')

  const message = `0x${[
    '00000001',
    '00000006',
    '0000001a',
    '11'.repeat(32),
    word('1111'),
    word('2222'),
    word(RECEIVER),
    '000007d0',
    '000007d0',
    '00000001',
    word('3600000000000000000000000000000000000000'),
    word(RECEIVER),
    word('5f5e100'),
    word('1111'),
    word('0'),
    word('0'),
    word('0'),
    word(AGENT),
  ].join('')}`

  it('reads the header and fixed body', () => {
    expect(getCctpMessageSourceDomain(message)).toBe(6)
    expect(getCctpMessageDestinationDomain(message)).toBe(26)
    expect(getCctpMessageDestinationCaller(message)).toBe(`0x${word(RECEIVER)}`)
    expect(getCctpMessageMintRecipient(message)).toBe(`0x${RECEIVER}`)
    expect(getCctpMessageAmount(message)).toBe(100_000_000n)
    expect(getCctpMessageNonce(message)).toBe(`0x${'11'.repeat(32)}`)
  })

  it('reads raw hook data at absolute byte 376', () => {
    expect(getCctpMessageHookAgent(message)).toBe(`0x${AGENT}`)
  })

  it('does not truncate a dirty agent word', () => {
    const dirty = `${message.slice(0, 2 + 376 * 2)}${'01'.padEnd(64, '0')}`
    expect(getCctpMessageHookAgent(dirty)).toBeUndefined()
  })

  it('rejects a short message', () => {
    expect(() => getCctpMessageNonce('0x1234')).toThrow('Invalid CCTP message header')
  })
})
