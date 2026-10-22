# Architecture

## System shape

Agent Treasury is a **single-tenant-per-agent** treasury primitive plus a client-side dashboard. There is no backend, no database, and no server-held key. The chain is the source of truth; the app reconstructs state from contract reads and event logs.

```
┌─────────────────────────────┐        ┌──────────────────────────────────────────┐
│  Vite / React / wagmi       │        │  Arc                                     │
│                             │        │                                          │
│  TanStack Query ──reads────►│───────►│  AgentTreasury ──► MorphoVaultAdapter ──►│──► Morpho ERC-4626 vault
│        │                    │        │        ▲                                 │
│        │ select()           │        │        │ recordDeposit                   │
│        ▼                    │        │  CCTPReceiver ◄── MessageTransmitterV2   │
│  Zustand stores             │        │        ▲                                 │
│  (cross-component + flow)   │        │        │ CCTP v2 message                 │
│                             │        │  TokenMessengerV2 ◄── requestWithdrawal  │
│  user wallet ──writes──────►│───────►│                                          │
└─────────────────────────────┘        └──────────────────────────────────────────┘
```

## Hermes control plane (Phase 1 implemented)

The SPA remains the transaction surface and works without a backend. The Hermes Agent control
plane adds ops monitoring and user assistance without becoming a treasury authority:

- Hermes runtime (gateway, Discord, cron, MCP, sessions) in a container
- Arc MCP server for read-only chain/CCTP tools
- deterministic monitor + Postgres for snapshots, transfer state, alerts, and audit
- a thin SIWE BFF before any public chat or typed intent flow
- no owner key in the cloud; user transactions are always signed in the user's EIP-1193 wallet
  (MetaMask, Rabby, Coinbase Wallet, Brave, Frame, or similar)

Phase 1 is ops-only and read-only. Full plan: [`docs/HERMES.md`](./HERMES.md). VPS setup and
connectivity: [`docs/HERMES_VPS.md`](./HERMES_VPS.md).

## Contracts

### AgentTreasury

Per-agent accounting is stored in `AgentAccount`:

| Field | Meaning |
|---|---|
| `principal` | Total USDC credited minus withdrawals. Includes deployed and idle. |
| `deployedPrincipal` | Portion of `principal` currently in the vault. Invariant: `deployedPrincipal <= principal`. |
| `vaultShares` | ERC-4626 shares held via the adapter. |
| `activeVaultId` | Selected vault (default `1`). |
| `chainDeposits[domain]` | Lifetime deposits by source CCTP domain. |
| `dailyLimit` / `weeklyLimit` | Rolling spending caps (0 = unlimited). |
| `dailySpent` / `weeklySpent` | Rolling counters. |

`getTotalBalance(agent)` = `(principal - deployedPrincipal) + previewRedeem(vaultShares)`, with a try/catch fallback to `principal` if the vault preview reverts. It never reverts.

Writes:

| Function | Auth | Notes |
|---|---|---|
| `deposit(amount)` | anyone for self | Arc-local fast path; pulls USDC, credits sender, deploys to vault. |
| `recordDeposit(agent, amount, sourceDomain)` | CCTPReceiver or owner | Called after a CCTP mint. |
| `withdrawLocal(amount)` | self | Redeems and transfers USDC to the caller. Supports `max`. |
| `requestWithdrawal(agent, amount, domain, recipient)` | agent or owner | Redeems, enforces limits, burns via CCTP v2. Rejects `domain == 26`. |
| `setYieldStrategy(agent, vaultId)` | agent or owner | Atomically moves shares between allowlisted vaults. |
| `claimYield(agent)` | agent or owner | Re-syncs shares and emits yield delta. |
| `rebalance(agent)` | keeper or owner | Re-compounds. |
| `executeWithdrawal(id)` | keeper or owner | Bookkeeping only; no funds move. |
| `setWithdrawalMessageHash(id, hash)` | keeper or owner | Records the CCTP message hash. |
| `setSpendingLimit(agent, daily, weekly)` | agent or owner | 6-decimal USDC amounts. |
| `pause` / `unpause` | owner | Blocks deposits, withdrawals, strategy changes. |

All state-changing paths are `nonReentrant`. Where funds move, effects are written before the final interaction (CEI), or the interaction is the first step and reverts atomically.

### MorphoVaultAdapter

Allowlisted ERC-4626 vaults. The owner registers a vault with `addVault(id, vault, name, symbol, minDeposit)`; only the treasury or owner can `deposit`/`withdraw`. The adapter holds shares, never user funds between transactions. `vaultAPY(id)` is an owner-set cache used by the UI (mainnet: `2.65%`, testnet: `4.2%`). `previewRedeem(shares, id)` and `pricePerShare(id)` come from the vault.

### CCTPReceiver

Implements the CCTP v2 hook handler:

```
handleReceiveMessage(uint32 sourceDomain, bytes32 sender, bytes calldata messageBody) returns (bool)
```

It extracts the agent from `hookData` (encoded by `CCTPMessageLib`), tolerates the versioned and unversioned `BurnMessageV2` layouts, and calls `treasury.recordDeposit(agent, amount, sourceDomain)`. If the hook data is malformed or the agent is unknown, it routes the minted USDC to `defaultBeneficiary` instead of reverting.

### CCTP outbound

`requestWithdrawal` calls:

```
TokenMessengerV2.depositForBurnWithHook(
  amount, destinationDomain, mintRecipient, usdc,
  destinationCaller = bytes32(0),
  maxFee, minFinalityThreshold = FAST,
  hookData = encode(agent, withdrawalId)
)
```

The burn emits a CCTP message. The user (or a relayer) fetches the Iris attestation and calls `MessageTransmitterV2.receiveMessage` on the destination. This build surfaces the attestation; it does not run a relayer.

## Frontend state

- **TanStack Query** owns server/chain state: balances, APY, TVL, allowances, logs. Polling every 10s for account state, 30s for activity.
- **Zustand** owns cross-component state and the transaction wizard (`flow`), UI preferences, and chart snapshots.
- The bridge is explicit: a `useEffect` in `useTreasuryData` writes query results into `useTreasuryStore`. Components read from Zustand for display; mutations invalidate queries.
- **Decimals:** USDC is 6 decimals everywhere in token math. Native gas on Arc is 18 decimals. `src/lib/decimals.ts` is the only place that converts.
- **No mock data:** empty states are real zeros. Gateway balances are not fabricated.

## Failure modes

| Failure | Behavior |
|---|---|
| Vault `previewRedeem` reverts | `getTotalBalance` falls back to principal. |
| Adapter not set / vault not registered | `deposit` keeps USDC idle; UI still shows principal. |
| Malformed CCTP hook data | Receiver routes USDC to `defaultBeneficiary`. |
| Spending limit exceeded | Withdrawal reverts before the burn/transfer. |
| Wrong network | App blocks writes and shows a switch-network banner. |
| RPC log limit | Activity scanner chunks 9,000 blocks and skips failed chunks. |
| Owner loses gas | Wiring/ownership actions are blocked; funds are not. |
