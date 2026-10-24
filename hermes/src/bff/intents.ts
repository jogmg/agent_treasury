import { randomBytes } from 'node:crypto'
import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  type PublicClient,
} from 'viem'
import { z } from 'zod'
import { ADAPTER_ABI, ERC20_ABI, TREASURY_ABI } from '../abis'
import { getCctpDestination } from '../cctp-destinations'
import type { HermesConfig } from '../config'
import type { DbPool } from '../db'
import type { BffConfig } from './config'
import { BffHttpError } from './errors'
import type { Logger } from 'pino'

export const MAX_U256 = (1n << 256n) - 1n
const USDC_FACTOR = 1_000_000n
const MAX_USDC_AMOUNT = 10n ** 30n

export type IntentKind = 'deposit' | 'withdrawLocal' | 'cctpWithdraw'
export type IntentStatus =
  | 'draft'
  | 'reviewed'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'expired'

export interface IntentSimulation {
  ok: boolean
  warning?: 'approval_required'
  error?: string
}

export interface IntentRecord {
  id: string
  wallet: `0x${string}`
  kind: IntentKind
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
  amount: string
  isMax: boolean
  destinationDomain: number | null
  mintRecipient: `0x${string}` | null
  status: IntentStatus
  simulation: IntentSimulation
  txHash: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string
  submittedAt: string | null
}

export interface IntentDraftRequest {
  kind: IntentKind
  amount?: string
  all?: boolean
  destinationDomain?: number
  mintRecipient?: string
}

export interface CreateIntentResult {
  intent: IntentRecord
  created: boolean
}

export interface BffIntentService {
  create(
    wallet: `0x${string}`,
    request: IntentDraftRequest,
    idempotencyKey?: string,
  ): Promise<CreateIntentResult>
  get(id: string, wallet: `0x${string}`): Promise<IntentRecord>
  submit(id: string, wallet: `0x${string}`, txHash: string): Promise<IntentRecord>
}

export interface IntentChainState {
  paused: boolean
  walletUsdc: bigint
  treasuryTotal: bigint
  allowance: bigint
  minDeposit: bigint
}

/** Narrow chain boundary so intent validation can be tested without an RPC. */
export interface IntentChain {
  readState(wallet: `0x${string}`): Promise<IntentChainState>
  simulateDeposit(wallet: `0x${string}`, amount: bigint): Promise<void>
  simulateWithdrawLocal(
    wallet: `0x${string}`,
    amount: bigint,
    isMax: boolean,
  ): Promise<void>
  simulateCctpWithdraw(
    wallet: `0x${string}`,
    amount: bigint,
    isMax: boolean,
    destinationDomain: number,
    recipient: `0x${string}`,
  ): Promise<void>
}

export class ArcIntentChain implements IntentChain {
  constructor(
    private readonly config: HermesConfig,
    private readonly client: PublicClient,
  ) {}

  async readState(wallet: `0x${string}`): Promise<IntentChainState> {
    const { treasury, adapter, usdc } = this.config.network.addresses
    const [paused, defaultVaultId, walletUsdc, treasuryTotal, allowance] =
      await Promise.all([
        this.client.readContract({
          address: treasury,
          abi: TREASURY_ABI,
          functionName: 'paused',
        }),
        this.client.readContract({
          address: treasury,
          abi: TREASURY_ABI,
          functionName: 'defaultVaultId',
        }),
        this.client.readContract({
          address: usdc,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [wallet],
        }),
        this.client.readContract({
          address: treasury,
          abi: TREASURY_ABI,
          functionName: 'getTotalBalance',
          args: [wallet],
        }),
        this.client.readContract({
          address: usdc,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [wallet, treasury],
        }),
      ])

    const vault = await this.client.readContract({
      address: adapter,
      abi: ADAPTER_ABI,
      functionName: 'getVaultConfig',
      args: [defaultVaultId],
    })

    return {
      paused,
      walletUsdc,
      treasuryTotal,
      allowance,
      minDeposit: vault.minDeposit,
    }
  }

  async simulateDeposit(wallet: `0x${string}`, amount: bigint): Promise<void> {
    await this.client.simulateContract({
      account: wallet,
      address: this.config.network.addresses.treasury,
      abi: TREASURY_ABI,
      functionName: 'deposit',
      args: [amount],
    })
  }

  async simulateWithdrawLocal(
    wallet: `0x${string}`,
    amount: bigint,
    isMax: boolean,
  ): Promise<void> {
    await this.client.simulateContract({
      account: wallet,
      address: this.config.network.addresses.treasury,
      abi: TREASURY_ABI,
      functionName: 'withdrawLocal',
      args: [isMax ? MAX_U256 : amount],
    })
  }

  async simulateCctpWithdraw(
    wallet: `0x${string}`,
    amount: bigint,
    isMax: boolean,
    destinationDomain: number,
    recipient: `0x${string}`,
  ): Promise<void> {
    await this.client.simulateContract({
      account: wallet,
      address: this.config.network.addresses.treasury,
      abi: TREASURY_ABI,
      functionName: 'requestWithdrawal',
      args: [
        wallet,
        isMax ? MAX_U256 : amount,
        destinationDomain,
        recipient,
      ],
    })
  }
}

function addressToBytes32(address: `0x${string}`): `0x${string}` {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}`
}

/** Parse a human-readable USDC amount with at most 6 decimal places. */
export function parseUsdcAmount(value: string): bigint {
  const clean = value.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{1,6})?$/.test(clean)) {
    throw new BffHttpError(
      400,
      'invalid_amount',
      'Enter a USDC amount with up to 6 decimal places.',
    )
  }
  const [whole, fraction = ''] = clean.split('.')
  const amount =
    BigInt(whole) * USDC_FACTOR +
    BigInt(fraction.padEnd(6, '0'))
  if (amount <= 0n) {
    throw new BffHttpError(400, 'invalid_amount', 'Enter an amount greater than zero.')
  }
  if (amount > MAX_USDC_AMOUNT) {
    throw new BffHttpError(400, 'invalid_amount', 'That amount is too large.')
  }
  return amount
}

function formatUsdcAmount(amount: bigint): string {
  return formatUnits(amount, 6)
}

/**
 * Compare a stored draft with a replayed semantic request. A withdraw-all
 * draft stores a balance snapshot, so its amount is intentionally not compared;
 * the max flag and route are the stable identity.
 */
function matchesStoredRequest(
  intent: IntentRecord,
  request: IntentDraftRequest,
  account: `0x${string}`,
): boolean {
  if (intent.kind !== request.kind) return false
  const isMax = request.all === true
  if (intent.isMax !== isMax) return false

  if (request.kind === 'cctpWithdraw') {
    if (intent.destinationDomain !== request.destinationDomain) return false
    let recipient = account
    if (request.mintRecipient && request.mintRecipient.trim() !== '') {
      try {
        recipient = getAddress(request.mintRecipient.trim())
      } catch {
        return false
      }
    }
    return intent.mintRecipient?.toLowerCase() === recipient.toLowerCase()
  }

  if (intent.destinationDomain !== null || intent.mintRecipient !== null) return false
  if (isMax) return true

  try {
    return intent.amount === parseUsdcAmount(request.amount ?? '').toString()
  } catch {
    return false
  }
}

function simulationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/LimitExceeded/i.test(message)) {
    return 'This amount exceeds the treasury daily or weekly spending limit.'
  }
  if (/Paused/i.test(message)) {
    return 'The treasury is paused, so this action cannot be submitted.'
  }
  if (/NothingToWithdraw|InsufficientBalance|ERC20InsufficientBalance/i.test(message)) {
    return 'The treasury does not have enough available USDC for this withdrawal.'
  }
  if (/ZeroShares/i.test(message)) {
    return 'That deposit is too small to mint vault shares.'
  }
  return 'This action would revert on-chain. Check the amount and try again.'
}

function isoTimestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
}

function nullableIso(value: unknown): string | null {
  return value === null || value === undefined ? null : isoTimestamp(value)
}

function parseSimulation(value: unknown): IntentSimulation {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as IntentSimulation
    } catch {
      return { ok: false, error: 'Stored simulation is unreadable.' }
    }
  }
  if (value && typeof value === 'object') return value as IntentSimulation
  return { ok: false, error: 'Stored simulation is unreadable.' }
}

interface IntentRow {
  id: string
  wallet: string
  kind: IntentKind
  chain_id: number
  treasury: string
  to_address: string
  data: string
  value: string
  amount: string
  is_max: boolean
  destination_domain: number | null
  mint_recipient: string | null
  status: IntentStatus
  simulation: unknown
  tx_hash: string | null
  expires_at: unknown
  created_at: unknown
  updated_at: unknown
  submitted_at: unknown
}

function rowToIntent(row: IntentRow): IntentRecord {
  return {
    id: row.id,
    wallet: row.wallet.toLowerCase() as `0x${string}`,
    kind: row.kind,
    chainId: row.chain_id,
    to: row.to_address as `0x${string}`,
    data: row.data as `0x${string}`,
    value: String(row.value),
    amount: String(row.amount),
    isMax: Boolean(row.is_max),
    destinationDomain: row.destination_domain,
    mintRecipient: row.mint_recipient as `0x${string}` | null,
    status: row.status,
    simulation: parseSimulation(row.simulation),
    txHash: row.tx_hash,
    expiresAt: isoTimestamp(row.expires_at),
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
    submittedAt: nullableIso(row.submitted_at),
  }
}

function newIntentId(): string {
  return `int_${randomBytes(16).toString('hex')}`
}

export class IntentService implements BffIntentService {
  constructor(
    private readonly config: BffConfig,
    private readonly pool: DbPool | null,
    private readonly chain: IntentChain,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  private requirePool(): DbPool {
    if (!this.pool) {
      throw new BffHttpError(
        503,
        'db_unavailable',
        'Draft actions need the Postgres intent store.',
      )
    }
    return this.pool
  }

  async create(
    wallet: `0x${string}`,
    request: IntentDraftRequest,
    idempotencyKey?: string,
  ): Promise<CreateIntentResult> {
    const pool = this.requirePool()
    const account = getAddress(wallet)
    const normalizedWallet = account.toLowerCase() as `0x${string}`

    // A replay must not re-run chain reads or simulation: the original draft is
    // the idempotent result even if balances changed after it was created.
    if (idempotencyKey) {
      const prior = await pool.query<IntentRow>(
        `select * from intents where wallet = $1 and idempotency_key = $2 limit 1`,
        [normalizedWallet, idempotencyKey],
      )
      if (prior.rows[0]) {
        const intent = rowToIntent(prior.rows[0])
        if (!matchesStoredRequest(intent, request, account)) {
          throw new BffHttpError(
            409,
            'idempotency_conflict',
            'That idempotency key was already used for a different draft.',
          )
        }
        return { intent, created: false }
      }
    }

    let state: IntentChainState
    try {
      state = await this.chain.readState(account)
    } catch (error) {
      this.logger.error({ err: error }, 'intent chain state read failed')
      throw new BffHttpError(
        503,
        'chain_unavailable',
        'Could not read the treasury right now. Try again.',
      )
    }
    if (state.paused) {
      throw new BffHttpError(
        409,
        'treasury_paused',
        'The treasury is paused. Unpause it before preparing a transaction.',
      )
    }

    const isMax = request.all === true
    if (isMax && request.kind === 'deposit') {
      throw new BffHttpError(400, 'invalid_request', 'Deposits need an explicit amount.')
    }
    if (isMax && request.kind === 'cctpWithdraw') {
      throw new BffHttpError(
        400,
        'invalid_request',
        'Enter an exact amount for a cross-chain withdrawal.',
      )
    }
    if (
      isMax &&
      request.amount !== undefined &&
      request.amount.trim() !== ''
    ) {
      throw new BffHttpError(
        400,
        'invalid_request',
        'Provide either an amount or all=true, not both.',
      )
    }

    let amount: bigint
    if (isMax) {
      if (state.treasuryTotal <= 0n) {
        throw new BffHttpError(
          400,
          'nothing_to_withdraw',
          'There is no available treasury balance to withdraw.',
        )
      }
      amount = state.treasuryTotal
    } else {
      if (!request.amount) {
        throw new BffHttpError(400, 'invalid_amount', 'Enter a USDC amount.')
      }
      amount = parseUsdcAmount(request.amount)
    }

    if (request.kind === 'deposit') {
      if (amount < state.minDeposit) {
        throw new BffHttpError(
          400,
          'below_minimum',
          `The minimum deposit is ${formatUsdcAmount(state.minDeposit)} USDC.`,
        )
      }
      if (amount > state.walletUsdc) {
        throw new BffHttpError(
          400,
          'insufficient_balance',
          'The connected wallet does not have enough USDC for this deposit.',
        )
      }
    } else if (amount > state.treasuryTotal) {
      throw new BffHttpError(
        400,
        'insufficient_balance',
        'The requested amount exceeds the treasury balance.',
      )
    }

    let destinationDomain: number | null = null
    let mintRecipient: `0x${string}` | null = null
    let calldata: `0x${string}`

    if (request.kind === 'deposit') {
      calldata = encodeFunctionData({
        abi: TREASURY_ABI,
        functionName: 'deposit',
        args: [amount],
      })
    } else if (request.kind === 'withdrawLocal') {
      calldata = encodeFunctionData({
        abi: TREASURY_ABI,
        functionName: 'withdrawLocal',
        args: [isMax ? MAX_U256 : amount],
      })
    } else {
      const domain = request.destinationDomain
      if (domain === undefined || !Number.isInteger(domain)) {
        throw new BffHttpError(
          400,
          'invalid_destination',
          'Choose a supported CCTP destination chain.',
        )
      }
      if (domain === this.config.hermes.network.cctpDomain) {
        throw new BffHttpError(
          400,
          'invalid_destination',
          'Arc is already the source chain. Choose another CCTP destination.',
        )
      }
      if (!getCctpDestination(this.config.hermes, domain)) {
        throw new BffHttpError(
          400,
          'invalid_destination',
          'That CCTP destination is not supported.',
        )
      }

      let recipient = account
      if (request.mintRecipient && request.mintRecipient.trim() !== '') {
        try {
          recipient = getAddress(request.mintRecipient.trim())
        } catch {
          throw new BffHttpError(
            400,
            'invalid_recipient',
            'Enter a valid destination wallet address.',
          )
        }
      }
      destinationDomain = domain
      mintRecipient = recipient
      calldata = encodeFunctionData({
        abi: TREASURY_ABI,
        functionName: 'requestWithdrawal',
        args: [
          account,
          isMax ? MAX_U256 : amount,
          domain,
          addressToBytes32(recipient),
        ],
      })
    }

    let simulation: IntentSimulation = { ok: true }
    try {
      if (request.kind === 'deposit' && state.allowance < amount) {
        // The existing review flow performs the approval first. A missing
        // allowance is expected, not a reason to reject the draft.
        simulation = { ok: true, warning: 'approval_required' }
      } else if (request.kind === 'deposit') {
        await this.chain.simulateDeposit(account, amount)
      } else if (request.kind === 'withdrawLocal') {
        await this.chain.simulateWithdrawLocal(account, amount, isMax)
      } else {
        await this.chain.simulateCctpWithdraw(
          account,
          amount,
          isMax,
          destinationDomain as number,
          addressToBytes32(mintRecipient as `0x${string}`),
        )
      }
    } catch (error) {
      this.logger.warn({ err: error, kind: request.kind }, 'intent simulation failed')
      throw new BffHttpError(422, 'simulation_failed', simulationError(error))
    }

    const id = newIntentId()
    const expiresAt = new Date(this.now() + this.config.intentTtlSeconds * 1000)
    const treasury = this.config.hermes.network.addresses.treasury
    const result = await pool.query<IntentRow>(
      `insert into intents
         (id, wallet, kind, chain_id, treasury, to_address, data, value, amount,
          is_max, destination_domain, mint_recipient, simulation, idempotency_key,
          expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, '0', $8, $9, $10, $11, $12::jsonb,
               $13, $14)
       on conflict (wallet, idempotency_key) where idempotency_key is not null
       do nothing
       returning *`,
      [
        id,
        normalizedWallet,
        request.kind,
        this.config.hermes.network.chainId,
        treasury,
        treasury,
        calldata,
        amount.toString(),
        isMax,
        destinationDomain,
        mintRecipient,
        JSON.stringify(simulation),
        idempotencyKey ?? null,
        expiresAt.toISOString(),
      ],
    )

    if (result.rows[0]) {
      const intent = rowToIntent(result.rows[0])
      await pool
        .query(
          `insert into audit_events (actor, action, subject, payload)
           values ($1, $2, $3, $4::jsonb)`,
          [
            normalizedWallet,
            `intent.${request.kind}.draft`,
            intent.id,
            JSON.stringify({
              amount: intent.amount,
              isMax: intent.isMax,
              destinationDomain: intent.destinationDomain,
              mintRecipient: intent.mintRecipient,
              simulation: intent.simulation,
            }),
          ],
        )
        .catch((error: unknown) => {
          this.logger.warn({ err: error, intentId: intent.id }, 'intent audit insert failed')
        })
      return { intent, created: true }
    }

    if (!idempotencyKey) {
      throw new BffHttpError(500, 'intent_not_stored', 'The draft could not be stored.')
    }
    const existing = await pool.query<IntentRow>(
      `select * from intents where wallet = $1 and idempotency_key = $2 limit 1`,
      [normalizedWallet, idempotencyKey],
    )
    if (!existing.rows[0]) {
      throw new BffHttpError(500, 'intent_not_stored', 'The draft could not be stored.')
    }

    const intent = rowToIntent(existing.rows[0])
    if (!matchesStoredRequest(intent, request, account)) {
      throw new BffHttpError(
        409,
        'idempotency_conflict',
        'That idempotency key was already used for a different draft.',
      )
    }
    return { intent, created: false }
  }

  async get(id: string, wallet: `0x${string}`): Promise<IntentRecord> {
    const pool = this.requirePool()
    const normalizedWallet = wallet.toLowerCase()
    const result = await pool.query<IntentRow>(
      `select * from intents where id = $1 and lower(wallet) = $2 limit 1`,
      [id, normalizedWallet],
    )
    const row = result.rows[0]
    if (!row) throw new BffHttpError(404, 'intent_not_found', 'Draft not found.')

    if (
      (row.status === 'draft' || row.status === 'reviewed') &&
      Date.parse(isoTimestamp(row.expires_at)) <= this.now()
    ) {
      const expired = await pool.query<IntentRow>(
        `update intents
            set status = 'expired', updated_at = now()
          where id = $1 and lower(wallet) = $2
            and status in ('draft', 'reviewed')
          returning *`,
        [id, normalizedWallet],
      )
      if (expired.rows[0]) return rowToIntent(expired.rows[0])
    }

    return rowToIntent(row)
  }

  async submit(
    id: string,
    wallet: `0x${string}`,
    txHash: string,
  ): Promise<IntentRecord> {
    const pool = this.requirePool()
    const normalizedWallet = wallet.toLowerCase()
    const normalizedTx = txHash.toLowerCase()
    const existing = await this.get(id, wallet)

    if (existing.txHash && existing.txHash.toLowerCase() === normalizedTx) {
      return existing
    }
    if (existing.status === 'expired') {
      throw new BffHttpError(409, 'intent_expired', 'This draft expired. Ask Hermes for a new one.')
    }
    if (existing.status === 'confirmed' || existing.status === 'failed') {
      throw new BffHttpError(409, 'intent_closed', 'This draft is already closed.')
    }
    if (existing.status === 'submitted') {
      throw new BffHttpError(409, 'intent_already_submitted', 'A different transaction is already recorded.')
    }

    try {
      const result = await pool.query<IntentRow>(
        `update intents
            set status = 'submitted', tx_hash = $3, submitted_at = now(),
                updated_at = now()
          where id = $1 and lower(wallet) = $2
            and status in ('draft', 'reviewed')
          returning *`,
        [id, normalizedWallet, normalizedTx],
      )
      const row = result.rows[0]
      if (!row) {
        throw new BffHttpError(404, 'intent_not_found', 'Draft not found or already closed.')
      }
      return rowToIntent(row)
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        throw new BffHttpError(
          409,
          'tx_already_used',
          'That transaction hash is already attached to another draft.',
        )
      }
      throw error
    }
  }
}

const proposalSchema = z
  .object({
    kind: z.enum(['deposit', 'withdrawLocal', 'cctpWithdraw']),
    amount: z
      .union([z.string(), z.number().finite()])
      .transform((value) => String(value))
      .optional(),
    all: z.boolean().optional(),
    destinationDomain: z
      .union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)])
      .optional(),
    mintRecipient: z.string().optional(),
  })
  .strict()
  .refine((value) => value.all === true || (value.amount ?? '').trim() !== '', {
    message: 'A draft needs an amount or all=true.',
  })

export interface ExtractedAction {
  proposal: IntentDraftRequest | null
  reply: string
  error?: string
}

/**
 * Extract the single server-validated action block from a User chat reply.
 * The block is a transport envelope only; every value is re-validated by
 * `IntentService` and the wallet still comes from the SIWE session.
 */
export function extractActionProposal(reply: string): ExtractedAction {
  const tagged = [...reply.matchAll(/<hermes_action>([\s\S]*?)<\/hermes_action>/gi)]
  const fenced = [...reply.matchAll(/```hermes-action\s*([\s\S]*?)```/gi)]
  const matches = [...tagged, ...fenced].sort(
    (left, right) => (left.index ?? 0) - (right.index ?? 0),
  )
  if (matches.length === 0) return { proposal: null, reply: reply.trim() }
  if (matches.length > 1) {
    const clean = reply
      .replace(/<hermes_action>[\s\S]*?<\/hermes_action>/gi, '')
      .replace(/```hermes-action[\s\S]*?```/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return {
      proposal: null,
      reply: clean,
      error: 'Hermes returned more than one action. Ask again for a single draft.',
    }
  }

  const match = matches[0]
  const clean = reply
    .replace(match[0], '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  try {
    const parsed = proposalSchema.parse(JSON.parse(match[1].trim()))
    return { proposal: parsed, reply: clean }
  } catch {
    return {
      proposal: null,
      reply: clean,
      error: 'Hermes returned an action I could not validate. Ask again with the amount and chain.',
    }
  }
}

/**
 * Server-owned instructions appended by the BFF. A browser cannot override this
 * because `/api/chat` drops any client-supplied system/tools fields.
 */
export const INTENT_CHAT_SYSTEM_PROMPT = `You are Hermes, the treasury assistant inside the Agent Treasury app.

Rules:
- You can read treasury and CCTP state with the available tools.
- You never sign, broadcast, or ask for a private key or seed phrase.
- When the user asks to deposit, withdraw to their Arc wallet, or withdraw to another chain, and the amount and destination are clear, prepare an unsigned draft.
- Do not claim a draft has been signed or executed.
- If the amount, destination chain, or recipient is missing or ambiguous, ask one short clarifying question instead of guessing.
- Deposits must meet the app's live minimum: 5 USDC on mainnet and 1 USDC on testnet. Never suggest a smaller deposit.
- For a full local wallet withdrawal use "all": true instead of inventing a balance. Cross-chain withdrawals need an exact amount.

To prepare a draft, append exactly one block at the very end of your reply:
<hermes_action>{"kind":"deposit","amount":"25"}</hermes_action>
or
<hermes_action>{"kind":"withdrawLocal","all":true}</hermes_action>
or
<hermes_action>{"kind":"cctpWithdraw","amount":"10","destinationDomain":6}</hermes_action>

Use Circle domain numbers: Ethereum 0, Avalanche 1, Optimism 2, Arbitrum 3, Base 6, Polygon 7. Include "mintRecipient" only when the user explicitly names a different destination address. The BFF validates the values, checks the treasury, simulates the call, and creates the unsigned intent. Do not include the block for read-only questions.`
