import { beforeEach, describe, expect, it } from 'vitest'
import { useBridgeDepositStore } from './bridgeDeposit'

beforeEach(() => {
  useBridgeDepositStore.getState().resetBridgeDeposit()
})

describe('cross-chain deposit flow', () => {
  it('tracks the source burn and destination mint separately', () => {
    const { setBridgeDeposit } = useBridgeDepositStore.getState()
    setBridgeDeposit({
      status: 'waiting',
      owner: '0xabc',
      sourceDomain: 6,
      amount: '10000000',
      burnHash: '0xburn',
    })

    let state = useBridgeDepositStore.getState()
    expect(state.status).toBe('waiting')
    expect(state.sourceDomain).toBe(6)
    expect(state.burnHash).toBe('0xburn')
    expect(state.mintHash).toBe('')

    setBridgeDeposit({ status: 'ready', message: '0xmessage', attestation: '0xattestation' })
    state = useBridgeDepositStore.getState()
    expect(state.status).toBe('ready')
    expect(state.message).toBe('0xmessage')

    setBridgeDeposit({ status: 'done', mintHash: '0xmint' })
    state = useBridgeDepositStore.getState()
    expect(state.status).toBe('done')
    expect(state.mintHash).toBe('0xmint')
  })

  it('resets cleanly', () => {
    const { setBridgeDeposit, resetBridgeDeposit } = useBridgeDepositStore.getState()
    setBridgeDeposit({ status: 'error', error: 'reverted', burnHash: '0xburn' })
    resetBridgeDeposit()

    const state = useBridgeDepositStore.getState()
    expect(state.status).toBe('idle')
    expect(state.error).toBe('')
    expect(state.burnHash).toBe('')
  })
})
