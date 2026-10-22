import { describe, expect, it, vi } from 'vitest'
import { eventRowData } from './EventRow'
import type { ActivityEvent } from '../lib/activity'
import type { CctpWithdrawalStatus } from '../lib/cctp'

const burnTx = `0x${'11'.repeat(32)}`
const mintTx = `0x${'22'.repeat(32)}`
const owner = `0x${'33'.repeat(20)}`

const withdrawalEvent: ActivityEvent = {
  id: `${burnTx}-0`,
  type: 'WithdrawalRequested',
  blockNumber: 100n,
  txHash: burnTx,
  logIndex: 0,
  timestamp: 1_700_000_000,
  args: {
    id: 1n,
    agent: owner,
    amount: 5_000_000n,
    destinationDomain: 6,
    mintRecipient: `0x${'0'.repeat(24)}${owner.slice(2)}`,
    messageHash: `0x${'44'.repeat(32)}`,
  },
}

function status(
  phase: CctpWithdrawalStatus['phase'],
  extra: Partial<CctpWithdrawalStatus> = {},
): CctpWithdrawalStatus {
  return {
    burnTx,
    sourceDomain: 26,
    destinationDomain: 6,
    phase,
    attestationComplete: phase === 'ready' || phase === 'done',
    delivered: phase === 'done',
    ...extra,
  }
}

describe('eventRowData Resume action', () => {
  it('does not show Resume until the off-chain status is known', () => {
    const row = eventRowData(withdrawalEvent, { onResume: vi.fn() })

    expect(row.action).toBeUndefined()
  })

  it('hides Resume when persisted history already says done', () => {
    const row = eventRowData(withdrawalEvent, {
      cctpCompleted: true,
      onResume: vi.fn(),
    })

    expect(row.action).toBeUndefined()
  })

  it('shows Resume from persisted history while the status query loads', () => {
    const row = eventRowData(withdrawalEvent, {
      cctpCompleted: false,
      onResume: vi.fn(),
    })

    expect(row.action?.label).toBe('Resume')
  })

  it('shows Resume while the transfer is still waiting', () => {
    const row = eventRowData(withdrawalEvent, {
      cctpStatus: status('waiting'),
      onResume: vi.fn(),
    })

    expect(row.action?.label).toBe('Resume')
  })

  it('shows Resume while the attested mint is pending', () => {
    const row = eventRowData(withdrawalEvent, {
      cctpStatus: status('ready'),
      onResume: vi.fn(),
    })

    expect(row.action?.label).toBe('Resume')
  })

  it('never shows Resume for a completed withdrawal', () => {
    const row = eventRowData(withdrawalEvent, {
      cctpStatus: status('done', { mintTxHash: mintTx }),
      onResume: vi.fn(),
    })

    expect(row.action).toBeUndefined()
    expect(row.links?.some((link) => link.label === 'Mint tx')).toBe(true)
  })
})
