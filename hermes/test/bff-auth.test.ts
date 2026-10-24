import { describe, expect, it } from 'vitest'
import { createPublicClient, http } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { parseSiweMessage } from 'viem/siwe'
import {
  createSessionToken,
  createSiweChallenge,
  NonceStore,
  parseCookies,
  verifySessionToken,
  verifySiweLogin,
} from '../src/bff/auth'

const account = privateKeyToAccount(generatePrivateKey())
const now = Date.parse('2026-10-24T12:00:00.000Z')
const publicOrigin = 'http://localhost:5173'
const client = createPublicClient({ transport: http('http://127.0.0.1:1') })

describe('BFF auth primitives', () => {
  it('issues a one-time nonce and consumes it once', () => {
    const store = new NonceStore(60_000, () => now)
    const entry = store.issue(account.address)
    expect(store.consume(entry.nonce)?.address).toBe(account.address)
    expect(store.consume(entry.nonce)).toBeNull()
  })

  it('expires an unused nonce', () => {
    let clock = now
    const store = new NonceStore(1_000, () => clock)
    const entry = store.issue(account.address)
    clock += 1_001
    expect(store.consume(entry.nonce)).toBeNull()
  })

  it('creates a SIWE challenge bound to the origin, chain, and nonce', () => {
    const store = new NonceStore(60_000, () => now)
    const entry = store.issue(account.address)
    const challenge = createSiweChallenge({
      address: account.address,
      publicOrigin,
      chainId: 5042,
      nonce: entry.nonce,
      expiresAt: entry.expiresAt,
      now,
    })
    const parsed = parseSiweMessage(challenge.message)
    expect(parsed.address).toBe(account.address)
    expect(parsed.domain).toBe('localhost:5173')
    expect(parsed.uri).toBe(publicOrigin)
    expect(parsed.chainId).toBe(5042)
    expect(parsed.nonce).toBe(entry.nonce)
  })

  it('verifies a real EOA signature', async () => {
    const store = new NonceStore(60_000, () => now)
    const entry = store.issue(account.address)
    const challenge = createSiweChallenge({
      address: account.address,
      publicOrigin,
      chainId: 5042,
      nonce: entry.nonce,
      expiresAt: entry.expiresAt,
      now,
    })
    const signature = await account.signMessage({ message: challenge.message })
    const address = await verifySiweLogin({
      client,
      message: challenge.message,
      signature,
      publicOrigin,
      chainId: 5042,
      nonce: entry,
      now,
    })
    expect(address).toBe(account.address)
  })

  it('rejects a challenge signed for a different domain', async () => {
    const store = new NonceStore(60_000, () => now)
    const entry = store.issue(account.address)
    const challenge = createSiweChallenge({
      address: account.address,
      publicOrigin: 'https://evil.example',
      chainId: 5042,
      nonce: entry.nonce,
      expiresAt: entry.expiresAt,
      now,
    })
    const signature = await account.signMessage({ message: challenge.message })
    await expect(
      verifySiweLogin({
        client,
        message: challenge.message,
        signature,
        publicOrigin,
        chainId: 5042,
        nonce: entry,
        now,
      }),
    ).rejects.toThrow('domain')
  })

  it('creates and verifies a signed session cookie payload', () => {
    const secret = 'a'.repeat(64)
    const session = createSessionToken(account.address, secret, 3_600, now)
    const verified = verifySessionToken(session.token, secret, now + 1_000)
    expect(verified?.address).toBe(account.address)
    expect(verified?.expiresAt).toBe(session.expiresAt)
  })

  it('rejects a tampered or expired session', () => {
    const secret = 'a'.repeat(64)
    const session = createSessionToken(account.address, secret, 60, now)
    const [body, signature] = session.token.split('.')
    expect(verifySessionToken(`${body}.${signature.slice(0, -1)}x`, secret, now)).toBeNull()
    expect(verifySessionToken(session.token, secret, now + 61_000)).toBeNull()
  })

  it('parses cookies without losing encoded values', () => {
    expect(parseCookies('a=1; at_hermes_session=abc.def; b=')).toEqual({
      a: '1',
      at_hermes_session: 'abc.def',
      b: '',
    })
  })
})
