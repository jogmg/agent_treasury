/**
 * Cross-chain deposit flow (source-chain CCTP burn -> Arc mint).
 *
 * Kept separate from the Arc-local deposit flow so a long-running attestation
 * poll cannot overwrite the local deposit UI state.
 */
import { create } from 'zustand'

export type BridgeDepositStatus =
  | 'idle'
  | 'approving'
  | 'burning'
  | 'waiting'
  | 'ready'
  | 'minting'
  | 'arc-approving'
  | 'depositing'
  | 'done'
  | 'error'

export interface BridgeDepositState {
  status:        BridgeDepositStatus
  owner:         string
  sourceDomain:  number
  amount:        string
  approveHash:   string
  burnHash:      string
  mintHash:      string
  arcApproveHash: string
  depositHash:   string
  message:       string
  attestation:   string
  error:         string

  setBridgeDeposit: (patch: Partial<Omit<BridgeDepositState, 'setBridgeDeposit' | 'resetBridgeDeposit'>>) => void
  resetBridgeDeposit: () => void
}

const INIT = {
  status: 'idle' as BridgeDepositStatus,
  owner: '',
  sourceDomain: 0,
  amount: '',
  approveHash: '',
  burnHash: '',
  mintHash: '',
  arcApproveHash: '',
  depositHash: '',
  message: '',
  attestation: '',
  error: '',
}

export const useBridgeDepositStore = create<BridgeDepositState>((setState) => ({
  ...INIT,
  setBridgeDeposit: (patch) => setState((state) => ({ ...state, ...patch })),
  resetBridgeDeposit: () => setState(INIT),
}))
