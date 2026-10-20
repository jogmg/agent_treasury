/**
 * Transaction flow store: tracks approval + deposit/withdraw step states.
 */
import { create } from 'zustand'

export type FlowStep = 'idle' | 'approving' | 'pending' | 'confirming' | 'success' | 'error'

export interface FlowState {
  // Deposit flow
  depositStep:   FlowStep
  depositHash:   string
  approveHash:   string
  depositError:  string

  // Withdraw local flow
  withdrawStep:  FlowStep
  withdrawHash:  string
  withdrawError: string

  // CCTP request flow
  cctpStep:      FlowStep
  cctpHash:      string
  cctpError:     string
  cctpWithdrawalId: string

  // Settings flow
  settingsStep:  FlowStep
  settingsHash:  string
  settingsError: string

  // Setters
  setDeposit:  (patch: Partial<Pick<FlowState, 'depositStep'|'depositHash'|'approveHash'|'depositError'>>) => void
  setWithdraw: (patch: Partial<Pick<FlowState, 'withdrawStep'|'withdrawHash'|'withdrawError'>>) => void
  setCctp:     (patch: Partial<Pick<FlowState, 'cctpStep'|'cctpHash'|'cctpError'|'cctpWithdrawalId'>>) => void
  setSettings: (patch: Partial<Pick<FlowState, 'settingsStep'|'settingsHash'|'settingsError'>>) => void
  resetDeposit:  () => void
  resetWithdraw: () => void
  resetCctp:     () => void
  resetSettings: () => void
}

const DEPOSIT_INIT  = { depositStep: 'idle' as FlowStep,  depositHash: '',  approveHash: '',  depositError: '' }
const WITHDRAW_INIT = { withdrawStep: 'idle' as FlowStep, withdrawHash: '', withdrawError: '' }
const CCTP_INIT     = { cctpStep: 'idle' as FlowStep,     cctpHash: '',    cctpError: '',    cctpWithdrawalId: '' }
const SETTINGS_INIT = { settingsStep: 'idle' as FlowStep, settingsHash: '', settingsError: '' }

export const useFlowStore = create<FlowState>((setState) => ({
  ...DEPOSIT_INIT,
  ...WITHDRAW_INIT,
  ...CCTP_INIT,
  ...SETTINGS_INIT,
  setDeposit:  (p) => setState((s) => ({ ...s, ...p })),
  setWithdraw: (p) => setState((s) => ({ ...s, ...p })),
  setCctp:     (p) => setState((s) => ({ ...s, ...p })),
  setSettings: (p) => setState((s) => ({ ...s, ...p })),
  resetDeposit:  () => setState((s) => ({ ...s, ...DEPOSIT_INIT })),
  resetWithdraw: () => setState((s) => ({ ...s, ...WITHDRAW_INIT })),
  resetCctp:     () => setState((s) => ({ ...s, ...CCTP_INIT })),
  resetSettings: () => setState((s) => ({ ...s, ...SETTINGS_INIT })),
}))
