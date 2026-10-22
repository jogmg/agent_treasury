import type { TreasuryState } from '../arc'
import { getCctpDestination } from '../cctp-destinations'
import type { HermesConfig } from '../config'

export type Severity = 'info' | 'warning' | 'critical'

export interface MonitorAlert {
  dedupeKey: string
  severity: Severity
  kind: string
  subject: string
  payload: Record<string, unknown>
}

export interface TransferRow {
  id: number
  direction: 'in' | 'out'
  withdrawalId: number | null
  burnTxHash: string
  burnBlock: string
  sourceDomain: number
  destinationDomain: number | null
  amount: string
  phase: 'waiting' | 'ready' | 'done' | 'error'
  nonce: string | null
  mintTxHash: string | null
  createdAt: string
  lastCheckedAt: string | null
}

function minutesSince(value: string | null | undefined, now: Date): number | null {
  if (!value) return null
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return null
  return Math.max(0, Math.floor((now.getTime() - time) / 60_000))
}

function alert(
  severity: Severity,
  kind: string,
  subject: string,
  payload: Record<string, unknown>,
): MonitorAlert {
  return {
    dedupeKey: `${kind}:${subject}`,
    severity,
    kind,
    subject,
    payload,
  }
}

export function evaluateTreasury(
  config: HermesConfig,
  state: TreasuryState,
  now = new Date(),
): MonitorAlert[] {
  const alerts: MonitorAlert[] = []
  const subject = `${state.chainId}:${state.agent}`

  if (state.paused === true) {
    alerts.push(
      alert('critical', 'treasury-paused', subject, {
        treasury: state.treasury,
        block: state.asOfBlock,
        message: 'Treasury is paused.',
      }),
    )
  }

  const owner = state.owner?.toLowerCase()
  const keeper = state.keeper?.toLowerCase()
  if (owner && keeper && owner === keeper) {
    alerts.push(
      alert('warning', 'keeper-is-owner', subject, {
        owner: state.owner,
        keeper: state.keeper,
        message:
          'Keeper still equals the owner EOA. Do not enable automated bookkeeping until rotated.',
      }),
    )
  }

  const expectedReceiver = config.network.addresses.receiver.toLowerCase()
  if (state.gatewayReceiver && state.gatewayReceiver.toLowerCase() !== expectedReceiver) {
    alerts.push(
      alert('critical', 'receiver-mismatch', subject, {
        expected: config.network.addresses.receiver,
        actual: state.gatewayReceiver,
        message: 'Treasury gatewayReceiver does not match the configured receiver.',
      }),
    )
  }

  if (state.principal && state.totalBalance) {
    const principal = BigInt(state.principal)
    const total = BigInt(state.totalBalance)
    // ERC-4626 rounding and yield can move total slightly. A one-USDC
    // shortfall is still worth investigating.
    if (total + 1_000_000n < principal) {
      alerts.push(
        alert('critical', 'balance-shortfall', subject, {
          principal: state.principal,
          totalBalance: state.totalBalance,
          principalUsdc: state.principalUsdc,
          totalBalanceUsdc: state.totalBalanceUsdc,
          message: 'Total balance is more than 1 USDC below principal.',
        }),
      )
    }
  }

  for (const warning of state.warnings) {
    alerts.push(
      alert('warning', 'read-warning', `${subject}:${warning}`, {
        warning,
        block: state.asOfBlock,
      }),
    )
  }

  const checkedMinutes = minutesSince(state.asOfTime, now)
  if (checkedMinutes !== null && checkedMinutes > 10) {
    alerts.push(
      alert('warning', 'stale-snapshot', subject, {
        asOfTime: state.asOfTime,
        ageMinutes: checkedMinutes,
      }),
    )
  }

  return alerts
}

export function evaluateTransfer(
  config: HermesConfig,
  transfer: TransferRow,
  now = new Date(),
): MonitorAlert[] {
  if (transfer.phase === 'done') return []

  const subject = transfer.burnTxHash
  const ageMinutes = minutesSince(transfer.createdAt, now) ?? 0
  const destination = transfer.destinationDomain === null
    ? undefined
    : getCctpDestination(config, transfer.destinationDomain)
  const base = {
    burnTx: transfer.burnTxHash,
    withdrawalId: transfer.withdrawalId,
    amount: transfer.amount,
    sourceDomain: transfer.sourceDomain,
    destinationDomain: transfer.destinationDomain,
    phase: transfer.phase,
    ageMinutes,
    burnUrl: `${config.network.explorer}/tx/${transfer.burnTxHash}`,
    mintUrl:
      transfer.mintTxHash && destination
        ? `${destination.explorer}/tx/${transfer.mintTxHash}`
        : undefined,
  }

  if (transfer.phase === 'error') {
    return [
      alert('warning', 'transfer-error', subject, {
        ...base,
        message: 'CCTP status resolver returned an error.',
      }),
    ]
  }

  if (transfer.phase === 'waiting' && ageMinutes > 45) {
    return [
      alert('warning', 'transfer-waiting', subject, {
        ...base,
        message: 'Burn is older than 45 minutes and Iris has not attested it yet.',
      }),
    ]
  }

  if (transfer.phase === 'ready' && ageMinutes > 15) {
    return [
      alert('warning', 'transfer-ready', subject, {
        ...base,
        message: 'Attestation is complete but the destination mint is still pending.',
      }),
    ]
  }

  return []
}

export function collectAlerts(
  config: HermesConfig,
  state: TreasuryState,
  transfers: TransferRow[],
  now = new Date(),
): MonitorAlert[] {
  return [
    ...evaluateTreasury(config, state, now),
    ...transfers.flatMap((transfer) => evaluateTransfer(config, transfer, now)),
  ]
}
