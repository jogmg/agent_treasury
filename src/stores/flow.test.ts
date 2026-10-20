import { describe, it, expect, beforeEach } from 'vitest'
import { useFlowStore } from './flow'

// Reset store between tests
beforeEach(() => {
  useFlowStore.setState({
    depositStep:  'idle', depositHash:  '', approveHash:  '', depositError:  '',
    withdrawStep: 'idle', withdrawHash: '', withdrawError: '',
    cctpStep:     'idle', cctpHash:     '', cctpError:     '', cctpWithdrawalId: '',
    settingsStep: 'idle', settingsHash: '', settingsError: '',
  })
})

describe('deposit flow', () => {
  it('starts idle', () => {
    expect(useFlowStore.getState().depositStep).toBe('idle')
  })
  it('transitions through steps', () => {
    const { setDeposit } = useFlowStore.getState()
    setDeposit({ depositStep: 'approving' })
    expect(useFlowStore.getState().depositStep).toBe('approving')
    setDeposit({ depositStep: 'pending' })
    expect(useFlowStore.getState().depositStep).toBe('pending')
    setDeposit({ depositStep: 'confirming', depositHash: '0xabc' })
    expect(useFlowStore.getState().depositHash).toBe('0xabc')
    setDeposit({ depositStep: 'success' })
    expect(useFlowStore.getState().depositStep).toBe('success')
  })
  it('resets on resetDeposit', () => {
    const { setDeposit, resetDeposit } = useFlowStore.getState()
    setDeposit({ depositStep: 'success', depositHash: '0xfoo' })
    resetDeposit()
    const s = useFlowStore.getState()
    expect(s.depositStep).toBe('idle')
    expect(s.depositHash).toBe('')
  })
})

describe('withdraw flow', () => {
  it('tracks error state', () => {
    const { setWithdraw } = useFlowStore.getState()
    setWithdraw({ withdrawStep: 'error', withdrawError: 'Limit exceeded.' })
    const s = useFlowStore.getState()
    expect(s.withdrawStep).toBe('error')
    expect(s.withdrawError).toBe('Limit exceeded.')
  })
  it('resets cleanly', () => {
    const { setWithdraw, resetWithdraw } = useFlowStore.getState()
    setWithdraw({ withdrawStep: 'success', withdrawHash: '0x123' })
    resetWithdraw()
    expect(useFlowStore.getState().withdrawStep).toBe('idle')
  })
})

describe('cctp flow', () => {
  it('stores withdrawalId', () => {
    const { setCctp } = useFlowStore.getState()
    setCctp({ cctpStep: 'success', cctpWithdrawalId: '7' })
    expect(useFlowStore.getState().cctpWithdrawalId).toBe('7')
  })
})

describe('settings flow', () => {
  it('independent of deposit flow', () => {
    const { setDeposit, setSettings } = useFlowStore.getState()
    setDeposit({ depositStep: 'success' })
    setSettings({ settingsStep: 'pending' })
    expect(useFlowStore.getState().depositStep).toBe('success')
    expect(useFlowStore.getState().settingsStep).toBe('pending')
  })
})
