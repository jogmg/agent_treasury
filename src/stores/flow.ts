/**
 * Transaction flow store: tracks approval + deposit/withdraw step states.
 *
 * Outbound CCTP transfers (Arc burn -> destination mint) are also kept in a
 * small persisted history list. A page reload clears the in-memory flow, but
 * the Activity tab's Pending filter keeps the Arc burn hash, destination,
 * amount, and status so the transfer can always be resumed.
 */
import { create } from 'zustand'

export type FlowStep = 'idle' | 'approving' | 'pending' | 'confirming' | 'success' | 'error'

export type CctpCompletionStatus = 'idle' | 'waiting' | 'ready' | 'minting' | 'done' | 'error'

export type CctpTransferStatus = Exclude<CctpCompletionStatus, 'idle'>

export interface CctpTransferRecord {
  owner:        string
  burnHash:     string   // Arc burn tx (source of the outbound transfer)
  destinationDomain: number
  amount:       string   // raw 6-decimals USDC, may be '' until Iris reports it
  recipient:    string   // 0x mintRecipient on the destination chain
  status:       CctpTransferStatus
  mintHash:     string   // destination receiveMessage tx once known
  updatedAt:    number
}

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
  cctpOwner:     string    // wallet that signed the burn (scopes the Pending list)

  // CCTP destination completion (attestation + mint)
  cctpCompletionStatus: CctpTransferStatus | 'idle'
  cctpDestinationDomain: number
  cctpAmount:            string
  cctpRecipient:         string
  cctpMessage:           string
  cctpAttestation:       string
  cctpMintHash:          string
  cctpCompletionError:   string

  // Persisted outbound transfer history (survives reloads)
  cctpHistory: CctpTransferRecord[]

  // Settings flow
  settingsStep:  FlowStep
  settingsHash:  string
  settingsError: string

  // Setters
  setDeposit:  (patch: Partial<Pick<FlowState, 'depositStep'|'depositHash'|'approveHash'|'depositError'>>) => void
  setWithdraw: (patch: Partial<Pick<FlowState, 'withdrawStep'|'withdrawHash'|'withdrawError'>>) => void
  setCctp:     (patch: Partial<Pick<FlowState,
    'cctpStep'|'cctpHash'|'cctpError'|'cctpWithdrawalId'|'cctpOwner'|
    'cctpCompletionStatus'|'cctpDestinationDomain'|'cctpAmount'|'cctpRecipient'|
    'cctpMessage'|'cctpAttestation'|'cctpMintHash'|'cctpCompletionError'
  >>) => void
  setSettings: (patch: Partial<Pick<FlowState, 'settingsStep'|'settingsHash'|'settingsError'>>) => void
  resetDeposit:  () => void
  resetWithdraw: () => void
  resetCctp:     () => void
  forgetCctpTransfer: (burnHash: string) => void
  resetSettings: () => void
}

const DEPOSIT_INIT  = { depositStep: 'idle' as FlowStep,  depositHash: '',  approveHash: '',  depositError: '' }
const WITHDRAW_INIT = { withdrawStep: 'idle' as FlowStep, withdrawHash: '', withdrawError: '' }
const CCTP_INIT     = {
  cctpStep: 'idle' as FlowStep,
  cctpHash: '',
  cctpError: '',
  cctpWithdrawalId: '',
  cctpOwner: '',
  cctpCompletionStatus: 'idle' as CctpCompletionStatus,
  cctpDestinationDomain: 0,
  cctpAmount: '',
  cctpRecipient: '',
  cctpMessage: '',
  cctpAttestation: '',
  cctpMintHash: '',
  cctpCompletionError: '',
}
const SETTINGS_INIT = { settingsStep: 'idle' as FlowStep, settingsHash: '', settingsError: '' }

const HISTORY_KEY = 'agent-treasury-cctp-outbound-v1'
const MAX_RECORDS = 10
const BURN_HASH_RE = /^0x[0-9a-fA-F]{64}$/

function isTransferStatus(value: unknown): value is CctpTransferStatus {
  return (
    value === 'waiting' ||
    value === 'ready' ||
    value === 'minting' ||
    value === 'done' ||
    value === 'error'
  )
}

function normalizeRecord(input: unknown): CctpTransferRecord | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Partial<CctpTransferRecord>
  const owner = typeof raw.owner === 'string' ? raw.owner : ''
  const burnHash = typeof raw.burnHash === 'string' ? raw.burnHash : ''
  const destinationDomain = Number(raw.destinationDomain)
  const updatedAt = Number(raw.updatedAt)

  if (!owner || !BURN_HASH_RE.test(burnHash) || !Number.isInteger(destinationDomain)) {
    return null
  }

  return {
    owner,
    burnHash,
    destinationDomain,
    amount:    typeof raw.amount === 'string' ? raw.amount : '',
    recipient: typeof raw.recipient === 'string' ? raw.recipient : '',
    status:    isTransferStatus(raw.status) ? raw.status : 'waiting',
    mintHash:  typeof raw.mintHash === 'string' ? raw.mintHash : '',
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  }
}

function loadHistory(): CctpTransferRecord[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeRecord)
      .filter((record): record is CctpTransferRecord => record !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_RECORDS)
  } catch {
    return []
  }
}

function persistHistory(history: CctpTransferRecord[]) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_RECORDS)))
  } catch {
    // Quota/unavailable: keep the in-memory copy.
  }
}

/**
 * Snapshot the active CCTP flow as a history record. Only runs once the burn
 * receipt has succeeded (cctpStep === 'success'): a 'confirming' burn that
 * reverts must not linger as pending forever. The attestation poll keeps
 * calling setCctp, so the record picks up destination, amount, recipient,
 * mint hash, and status changes automatically.
 */
function recordFromState(state: FlowState): CctpTransferRecord | null {
  if (state.cctpStep !== 'success' || state.cctpCompletionStatus === 'idle') return null
  if (!BURN_HASH_RE.test(state.cctpHash)) return null
  if (!state.cctpOwner) return null

  return {
    owner:              state.cctpOwner,
    burnHash:           state.cctpHash,
    destinationDomain:  state.cctpDestinationDomain,
    amount:             state.cctpAmount,
    recipient:          state.cctpRecipient,
    status:             state.cctpCompletionStatus,
    mintHash:           state.cctpMintHash,
    updatedAt:          Date.now(),
  }
}

const initialHistory = loadHistory()

export const useFlowStore = create<FlowState>((setState) => ({
  ...DEPOSIT_INIT,
  ...WITHDRAW_INIT,
  ...CCTP_INIT,
  cctpHistory: initialHistory,
  ...SETTINGS_INIT,
  setDeposit:  (p) => setState((s) => ({ ...s, ...p })),
  setWithdraw: (p) => setState((s) => ({ ...s, ...p })),
  setCctp:     (p) =>
    setState((s) => {
      const next = { ...s, ...p }
      const record = recordFromState(next)
      if (!record) return next

      const history = [
        record,
        ...s.cctpHistory.filter(
          (r) => r.burnHash.toLowerCase() !== record.burnHash.toLowerCase(),
        ),
      ]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_RECORDS)
      persistHistory(history)
      return { ...next, cctpHistory: history }
    }),
  setSettings: (p) => setState((s) => ({ ...s, ...p })),
  resetDeposit:  () => setState((s) => ({ ...s, ...DEPOSIT_INIT })),
  resetWithdraw: () => setState((s) => ({ ...s, ...WITHDRAW_INIT })),
  // Clears the active flow but deliberately KEEPS cctpHistory: the pending
  // records are the only client-side copy of the burn hash.
  resetCctp:     () => setState((s) => ({ ...s, ...CCTP_INIT })),
  forgetCctpTransfer: (burnHash) =>
    setState((s) => {
      const history = s.cctpHistory.filter(
        (r) => r.burnHash.toLowerCase() !== burnHash.toLowerCase(),
      )
      persistHistory(history)
      return { ...s, cctpHistory: history }
    }),
  resetSettings: () => setState((s) => ({ ...s, ...SETTINGS_INIT })),
}))
