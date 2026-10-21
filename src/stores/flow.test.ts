import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFlowStore } from './flow'

const BURN_HASH = `0x${'33'.repeat(32)}`

// Reset store between tests
beforeEach(() => {
  useFlowStore.setState({
    depositStep:  'idle', depositHash:  '', approveHash:  '', depositError:  '',
    withdrawStep: 'idle', withdrawHash: '', withdrawError: '',
    cctpStep:     'idle', cctpHash:     '', cctpError:     '', cctpWithdrawalId: '',
    cctpOwner:    '',
    cctpCompletionStatus: 'idle', cctpDestinationDomain: 0, cctpAmount: '',
    cctpRecipient: '', cctpMessage: '', cctpAttestation: '', cctpMintHash: '', cctpCompletionError: '',
    cctpHistory: [],
    settingsStep: 'idle', settingsHash: '', settingsError: '',
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
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

describe('cctp transfer history', () => {
  function confirmBurn() {
    useFlowStore.getState().setCctp({
      cctpStep: 'success',
      cctpOwner: '0xabc',
      cctpCompletionStatus: 'waiting',
      cctpHash: BURN_HASH,
      cctpDestinationDomain: 0,
      cctpAmount: '1000000',
      cctpRecipient: '0x88ee5051',
      cctpMessage: '',
      cctpAttestation: '',
      cctpMintHash: '',
      cctpCompletionError: '',
    })
  }

  it('records the transfer only after the burn receipt confirms', () => {
    const { setCctp } = useFlowStore.getState()
    // 'confirming' burns may revert — they must not linger as pending.
    setCctp({ cctpStep: 'confirming', cctpHash: BURN_HASH, cctpOwner: '0xabc' })
    expect(useFlowStore.getState().cctpHistory).toHaveLength(0)

    confirmBurn()
    const history = useFlowStore.getState().cctpHistory
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      owner: '0xabc',
      burnHash: BURN_HASH,
      destinationDomain: 0,
      amount: '1000000',
      status: 'waiting',
    })
  })

  it('updates the record through completion and keeps it after reset', () => {
    const { setCctp, resetCctp } = useFlowStore.getState()
    confirmBurn()
    setCctp({
      cctpCompletionStatus: 'done',
      cctpMintHash: '0xmint',
      cctpMessage: '0xmessage',
      cctpAttestation: '0xattestation',
    })

    resetCctp()
    const state = useFlowStore.getState()
    expect(state.cctpStep).toBe('idle')
    expect(state.cctpHash).toBe('')
    expect(state.cctpHistory).toHaveLength(1)
    expect(state.cctpHistory[0].status).toBe('done')
    expect(state.cctpHistory[0].mintHash).toBe('0xmint')
  })

  it('does not duplicate the same burn hash', () => {
    confirmBurn()
    confirmBurn()
    expect(useFlowStore.getState().cctpHistory).toHaveLength(1)
  })

  it('forgets a transfer on demand', () => {
    confirmBurn()
    useFlowStore.getState().forgetCctpTransfer(BURN_HASH)
    expect(useFlowStore.getState().cctpHistory).toHaveLength(0)
  })

  it('persists the history to localStorage', () => {
    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => backing.set(key, value),
      removeItem: (key: string) => backing.delete(key),
      clear: () => backing.clear(),
    })

    confirmBurn()
    const saved = [...backing.values()][0]
    expect(saved).toContain(BURN_HASH)
    expect(saved).toContain('"status":"waiting"')

    useFlowStore.getState().forgetCctpTransfer(BURN_HASH)
    expect(backing.get('agent-treasury-cctp-outbound-v1')).not.toContain(BURN_HASH)
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
