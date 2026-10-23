# Hermes Agent Implementation Plan

> Status: **Phase 1 deployed on the current InstaBox production host; Discord gateway credentials
> pending.** The read-only stack lives in `hermes/`; the VPS runbook is `docs/HERMES_VPS.md`. No
> cloud signer, no owner key, no automated bookkeeping, and no changes to the live mainnet
> contracts.
>
> Phase 1 implementation: shared CCTP parser, Arc/CCTP MCP server, Postgres schema, deterministic
> monitor, Discord alerts, Ops profile, Docker Compose, and read-only smoke test. The MCP smoke
> test passed against Arc mainnet and the known id 3 burn resolved `done` from destination
> `usedNonces`, with delivery verified. Mint tx links are best-effort and may be absent for manual
> mints; Hermes reports one only when Circle supplies a forwarder transaction.
>
> Deployment: the free InstaBox 4 vCPU / 8 GiB / 20 GiB machine is running Postgres, `arc-mcp`, and
> the monitor. The database verified 3 snapshots, 12 activity events, 3 completed transfers, 3
> bookkeeping rows, and the open `keeper-is-owner` alert. The real Hermes runtime registered the
> Ops profile and `hermes -p ops mcp test arc-treasury` connected with seven tools. The gateway is
> not started until Discord and Anthropic credentials are installed. InstaBox auto-pauses after 30
> minutes idle; the private `jogmg/workflows` repository runs `wake` + `exec true` every 15 minutes
> to keep it alive. This free-plan workaround can still leave monitoring gaps, and GitHub may delay
> scheduled runs.

## 1. Decision

Hermes Agent is the **agent runtime and control plane**, not the treasury ledger.

We will reuse Hermes for the things it already does well:

- long-running gateway and Discord bot
- scheduled jobs, including script-only jobs with no LLM call
- MCP tool integration
- API server for a future web chat bridge
- sessions, memory, logs, profiles, and Docker deployment

We will **not** build a custom chat service, cron runner, Discord bot, session store, or webhook
receiver.

We will still build a small domain backend because Hermes cannot be the source of truth for money:

- an Arc/CCTP MCP tool server
- a deterministic monitor and alert worker
- Postgres for treasury snapshots, transfer state, alerts, and audit records
- a thin authenticated BFF before any public user chat or transaction intent flow
- an isolated keeper signer only after the keeper is rotated away from the owner EOA

The existing Vite/React app remains fully functional without Hermes. Hermes is additive.

### Implemented Phase 1 files

| Path | Purpose |
|---|---|
| `shared/cctp-message.ts` | Shared CCTP v2 parser (header, nonce, amount, recipient, hook agent) |
| `hermes/src/arc.ts` | Read-only treasury, adapter, USDC, withdrawal reads |
| `hermes/src/cctp.ts` | Iris attestation + destination `usedNonces` / `MessageReceived` |
| `hermes/src/activity.ts` | Chunked Arc scanner, Postgres event index, bounded live fallback |
| `hermes/src/monitor/` | Rules, Discord delivery, dedupe, snapshots, transfer refresh, health |
| `hermes/src/mcp/` | Streamable HTTP MCP server, bearer scopes, seven read-only tools |
| `hermes/migrations/001_init.sql` | Business state, separate from Hermes `state.db` |
| `hermes/profiles/ops/` | Private Ops profile with terminal/file/browser/web disabled |
| `hermes/docker-compose.yml` | Private Postgres, migrate, MCP, monitor, Hermes services |

### What Phase 1 intentionally does not do

- It does not sign, broadcast, pause, or rotate the keeper.
- It does not execute `executeWithdrawal`.
- It does not expose a public chat or API port.
- It does not treat `AgentTreasury.executed` as completion.
- It does not write treasury balances to Hermes `state.db`.

## 2. Non-negotiable rules

1. **No private keys in Hermes, Postgres, logs, chat, or the repo.** Owner actions are signed by the
   user in any EIP-1193 wallet or by a Safe. A future keeper key lives in KMS/HSM or a dedicated
   signer service.
2. **Hermes never signs a user transaction.** It may explain, prepare a draft intent, or deep-link
   into the existing app. The user signs in their own wallet.
3. **Wallet support is wallet-agnostic.** Intents use standard EVM transaction requests and work with
   MetaMask, Rabby, Coinbase Wallet, Brave Wallet, Frame, and other EIP-1193/EIP-6963 wallets. Do not
   branch on `window.ethereum.isMetaMask`, inject a provider directly, or assume a specific wallet's
   UI. Use wagmi's injected/connector flow, EIP-6963 discovery where available, and the connected
   wallet's `eth_sendTransaction` / `wallet_switchEthereumChain` behavior. If a wallet cannot switch
   chains programmatically, show the chain name and ask the user to switch manually.
4. **The LLM is not the source of truth.** Completion, balances, and bookkeeping are derived by
   deterministic code from Arc logs, Circle Iris, and destination `usedNonces`/`MessageReceived`.
5. **The treasury's `executed` flag is not user-facing completion.** A CCTP withdrawal is complete
   only when Iris is complete and the destination nonce is used.
6. **Public and ops are separate Hermes profiles with separate credentials and tool scopes.**
   A public profile must never have terminal, filesystem, browser, or unrestricted webhook access.
7. **The app's current UX is preserved.** Activity rows, chain-name CCTP dropdown, growth-chart
   ranges, collapsible cross-chain deposit card, and the single CCTP section in Withdraw stay as-is.
8. **No contract redeploy and no mainnet fund movement in Phase 1.**
9. **Read-only first.** Any write capability is a separate, reviewed phase.

## 3. Target architecture

```text
                         ┌──────────────────────────────────────────┐
                         │ Existing Vite / React app                │
                         │ deposit · withdraw · activity · settings │
                         └───────────────┬──────────────────────────┘
                                         │ Phase 2: SIWE + HTTPS
                                         ▼
                         ┌──────────────────────────────────────────┐
                         │ BFF / auth gateway (Phase 2)             │
                         │ SIWE · sessions · rate limit · intents   │
                         └───────┬───────────────────────┬──────────┘
                                 │                       │
                    private HTTP │                       │ private HTTP
                                 ▼                       ▼
                 ┌────────────────────────┐   ┌────────────────────────┐
                 │ Hermes "User" profile  │   │ Postgres               │
                 │ read-only chat tools   │   │ snapshots · transfers  │
                 │ no terminal/filesystem │   │ intents · alerts       │
                 └───────────┬────────────┘   └───────────▲────────────┘
                             │ MCP                        │
                             ▼                            │
                 ┌────────────────────────┐               │
                 │ Arc MCP server         │───────────────┘
                 │ chain reads + CCTP     │
                 │ no private keys        │
                 └───────────▲────────────┘
                             │
                 ┌───────────┴────────────┐
                 │ Deterministic monitor  │
                 │ Arc · Iris · dest RPC  │
                 │ Discord webhook alerts │
                 └───────────┬────────────┘
                             │
                             ▼
                 ┌────────────────────────┐
                 │ Hermes "Ops" profile   │
                 │ private Discord only   │
                 │ read-only MCP tools    │
                 └────────────────────────┘

Phase 3 only:
  monitor ──verified complete──► isolated keeper signer ──► executeWithdrawal(id)
  owner-only actions ──► human approval in any EIP-1193 wallet or Safe
```

### Why this split

- Hermes is good at conversation, routing, scheduling, and tool use.
- Postgres is good at durable state, idempotency, and audit.
- The monitor is good at deterministic verification and alert dedupe.
- The app is good at user review and signing through the user's chosen EVM wallet.
- No single component is trusted with both the keys and the decision.

## 4. Components

### 4.1 Hermes runtime

Use the official Docker image: `nousresearch/hermes-agent:latest`.

- One container can host multiple profiles.
- `/opt/data` is the persistent `HERMES_HOME`.
- `--profile ops gateway run` is supervised by s6 inside the image; the profile
  keeps the Ops config, `.env`, SOUL, memory, and sessions isolated.
- Logs are per-profile under `${HERMES_HOME}/logs/gateways/<profile>/current`.
- The Ops profile has no public HTTP listener in Phase 1.
- The User profile, when added in Phase 2, binds its API server only to the private network and is
  reachable only through the BFF.

Profiles:

| Profile | Surface | Tools | Credentials |
|---|---|---|---|
| `ops` | Private Discord channel | Arc MCP read tools + monitor status; no terminal/filesystem/browser | Discord bot token, MCP ops token, LLM key |
| `user` | BFF-only API server | Arc MCP read tools; no terminal/filesystem/browser; no cron | Separate API server key, MCP user token, LLM key |

The profiles must not share `.env` files, API keys, Discord tokens, or MCP tokens.

### 4.2 Arc MCP server

A small Node/TypeScript service using `viem` and the official MCP SDK.

- Transport: Streamable HTTP at `/mcp`.
- Auth: bearer token mapped to a scope (`user` or `ops`).
- No private keys, no signing, no transaction broadcasting.
- All read tools annotated `readOnlyHint: true`.
- Draft tools, when added, are annotated `readOnlyHint: false` and require approval.
- Mark the server `trust: untrusted` in Hermes config so the tool annotations, not the server's
  claims, govern approval behavior.

Tool surface for Phase 1:

| Tool | Scope | Purpose |
|---|---|---|
| `arc_get_config` | user, ops | Network, chain ID, contract addresses, vault, deploy block, Iris endpoint |
| `arc_get_treasury_state` | user, ops | Principal, total balance, shares, vault, paused, owner, keeper, deposits by chain |
| `arc_list_activity` | user, ops | Normalized Arc events with block timestamps and tx links |
| `arc_get_cctp_status` | user, ops | Iris + destination status for a burn tx: `waiting`, `ready`, `done`, `error` |
| `arc_get_transfer` | user, ops | Persisted transfer record from Postgres |
| `arc_get_bookkeeping_queue` | ops | Withdrawals that are delivered but still `executed=false` on-chain |
| `arc_get_incidents` | ops | Open/closed monitor incidents and last alert state |

Phase 2 draft tools, not enabled in Phase 1:

| Tool | Purpose |
|---|---|
| `arc_draft_deposit` | Create an unsigned deposit intent and return an app deep link |
| `arc_draft_withdraw_local` | Create an unsigned local-withdraw intent |
| `arc_draft_cctp_withdraw` | Create an unsigned CCTP withdrawal intent |

There is **no** `arc_execute_*`, `arc_send_*`, or `arc_sign_*` tool. Ever, in the LLM-facing server.

Important implementation details:

- The CCTP parser must use the existing layout:
  - header length `148`
  - `BurnMessageV2` fixed body `228`
  - hook data at byte `376`
  - nonce is the raw 32-byte value from the header, not a hash
- `usedNonces` is keyed by that raw nonce.
- Fallback across destination RPCs, as `src/lib/cctp.ts` already does.
- Return structured JSON, not prose. The agent turns it into prose.
- Include `asOfBlock`, `asOfTime`, and `stale` so the agent can say when data is old.

### 4.3 Deterministic monitor

A long-running Node/TypeScript worker with a Postgres connection and a Discord webhook.

It is intentionally not LLM-driven. The agent may summarize its findings; it does not decide them.

Phase 1 checks, every 60 seconds:

- Arc RPC health and latest block.
- Treasury snapshot for the tracked agent(s):
  - principal
  - total balance
  - vault shares
  - idle USDC
  - `paused`
  - `keeper`
  - `gatewayReceiver`
- New `WithdrawalRequested` events since the last cursor.
- For every open outbound transfer:
  - Iris status
  - attestation presence
  - destination domain
  - nonce
  - destination `usedNonces`
  - mint tx when Iris supplies a forwarder tx (best-effort; no destination log
    scan, because `usedNonces` already proves delivery)
- Inbound CCTP deposits that are known from a source burn but not yet recorded on Arc.
- Alert conditions:
  - `paused == true`
  - `keeper == owner` (launch guardrail warning; not an incident by itself)
  - `gatewayReceiver` does not match the configured receiver
  - balance or principal mismatch above a small tolerance
  - transfer `waiting` beyond the expected attestation window
  - transfer `ready` with no destination mint beyond the expected window
  - Iris or destination RPC unavailable
  - monitor heartbeat stale
- Alert dedupe key: `kind + subject + state`, with a cooldown and a re-alert window.
- Every alert includes: severity, chain, amount, age, burn tx, mint tx when available, current
  phase, and the exact verification command or MCP tool that produced it.

The monitor writes to Postgres and sends Discord webhooks. It also exposes:

- `GET /health` for liveness
- `GET /ready` for Postgres/RPC/Iris readiness
- `POST /run` for an on-demand check (ops-only, internal token)

Hermes cron can call `POST /run` for a manual or scheduled watchdog, but the monitor's own interval
is the primary scheduler. This avoids making correctness depend on an LLM scheduler.

### 4.4 Postgres

Postgres is the business source of truth for off-chain state. Hermes' SQLite `state.db` is internal
and changes between releases; it is not used for treasury records.

Phase 1 tables:

```sql
create table treasury_snapshots (
  id bigserial primary key,
  chain_id integer not null,
  block_number bigint not null,
  treasury_address text not null,
  agent_address text not null,
  principal numeric(78,0) not null,
  total_balance numeric(78,0) not null,
  vault_shares numeric(78,0) not null,
  idle_usdc numeric(78,0) not null,
  active_vault_id numeric(78,0),
  paused boolean not null,
  keeper text not null,
  gateway_receiver text not null,
  captured_at timestamptz not null default now(),
  unique (chain_id, block_number, treasury_address, agent_address)
);

create table transfers (
  id bigserial primary key,
  direction text not null check (direction in ('in', 'out')),
  withdrawal_id bigint,
  burn_tx_hash text not null,
  burn_block bigint not null,
  source_domain integer not null,
  destination_domain integer,
  amount numeric(78,0) not null,
  nonce text,
  iris_status text,
  phase text not null check (phase in ('waiting', 'ready', 'done', 'error')),
  mint_tx_hash text,
  mint_block bigint,
  message_hash text,
  last_checked_at timestamptz,
  completed_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  unique (burn_tx_hash, direction)
);

create table withdrawal_bookkeeping (
  withdrawal_id bigint primary key,
  burn_tx_hash text not null,
  executed_on_chain boolean not null default false,
  verified_complete_at timestamptz,
  keeper_tx_hash text,
  status text not null default 'pending',
  updated_at timestamptz not null default now()
);

create table alerts (
  id bigserial primary key,
  dedupe_key text not null unique,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  kind text not null,
  subject text not null,
  payload jsonb not null,
  first_seen_at timestamptz not null default now(),
  last_sent_at timestamptz,
  resolved_at timestamptz
);

create table audit_events (
  id bigserial primary key,
  actor text not null,
  action text not null,
  subject text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table monitor_cursor (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
```

Phase 2 adds:

- `users` (wallet address, created_at, last_seen_at)
- `sessions` (opaque session id, wallet, expiry, CSRF secret)
- `intents` (owner, kind, chain_id, to, data, value, amount, destination_domain, mint_recipient,
  status, tx_hash, expires_at, created_at)

Use `numeric(78,0)` for raw token units. Never use floating point for money.

### 4.5 BFF and user chat (Phase 2)

The BFF is the only public entry point. It holds the Hermes User API key; the browser never does.

Endpoints:

- `POST /auth/siwe/nonce`
- `POST /auth/siwe/verify` -> HttpOnly, Secure, SameSite session cookie
- `GET /api/treasury`
- `GET /api/activity`
- `GET /api/transfers`
- `POST /api/intents`
- `GET /api/intents/:id`
- `POST /api/chat` -> Hermes `/p/user/v1/chat/completions` or `/v1/responses`
- `GET /health`

Rules:

- Verify SIWE with `viem` and a one-time nonce.
- Bind every session and intent to a wallet address.
- Rate-limit by wallet and IP.
- Never expose `API_SERVER_KEY`, `ARC_MCP_TOKEN_USER`, or `DATABASE_URL` to the browser.
- Proxy chat with `X-Hermes-Session-Key` derived from the authenticated wallet, and
  `Idempotency-Key` per user message.
- Strip or reject browser-supplied system prompts, tool names, and model overrides.
- The User Hermes profile has read-only tools. It cannot create intents in Phase 2 unless the BFF
  explicitly adds a scoped draft tool later.

Intent flow:

1. User enters amount/chain in the existing app.
2. BFF creates a typed intent: `{ to, data, value, chainId, amount, expiresAt }`.
3. App re-simulates the call and shows the existing review UI.
4. User signs in their EIP-1193 wallet (MetaMask, Rabby, Coinbase Wallet, Brave, Frame, etc.).
5. App PATCHes the tx hash back to the BFF.
6. Monitor verifies the on-chain result independently.

No intent is a promise that the transaction succeeded. The chain is authoritative.

### 4.6 Keeper and bookkeeping (Phase 3 only)

Blocked until:

- the keeper is rotated from the owner EOA to a dedicated key
- the keeper key is held in KMS/HSM or a dedicated signer service
- the monitor has been stable in production
- the external audit is booked or the owner explicitly accepts the remaining risk

The keeper service is separate from Hermes:

- only allowlisted calls: `executeWithdrawal(id)`, optionally `rebalance(agent)`
- no `requestWithdrawal`, no `setSpendingLimit`, no owner functions
- verifies Iris complete + destination `usedNonces != 0` + N confirmations
- idempotent per withdrawal id, with a transaction lock
- daily spend/action cap and a kill switch
- every action written to `audit_events`

`executeWithdrawal` is bookkeeping only; it does not move funds. Still, it is a write and gets the
same review.

## 5. Phases

### Phase 0 — prerequisites (no code)

- Choose cloud: **Fly.io** (default) or Railway. Fly.io is the default because it supports Docker,
  persistent volumes, private networking, and managed Postgres.
- Create a private Discord server/channel and a bot application.
- Create Postgres (Fly Postgres, Neon, or Supabase).
- Choose an LLM provider/model. Nous Portal, OpenAI, Anthropic, or any OpenAI-compatible endpoint
  works. Use a low-cost model for ops summaries; escalate only for incident analysis.
- Confirm the Arc RPC and Iris endpoints. The app already has working fallbacks.
- Decide whether Phase 1 is ops-only (recommended) or also includes the public web chat.

Phase 1 is intentionally ops-only. It proves the runtime, MCP tools, monitor, and Discord path with
zero user-facing write risk.

### Phase 1 — Hermes Lite (ops-only, read-only)

Deliverables:

1. `hermes/` service scaffold:
   - Dockerfile for the MCP server and monitor
   - `compose.yaml` for local development
   - `.env.example`
   - profile templates for `ops` and `user`
   - bootstrap script for profiles and migrations
2. `hermes/src/core/`:
   - env-driven network config (no `import.meta.env`)
   - ABIs and addresses
   - CCTP parser and resolver
   - activity scanner
   - parity fixtures for known mainnet/testnet messages
3. `shared/cctp-message.ts`:
   - pure message parser shared by the app and the server
   - no network config, no browser globals
   - frontend re-exports it with no behavior change
4. `hermes/src/mcp/`:
   - Streamable HTTP MCP server
   - bearer-token scopes
   - read tools listed in section 4.2
   - structured errors and `asOfBlock`/`stale` metadata
5. `hermes/src/monitor/`:
   - one-shot and interval modes
   - Postgres writes
   - Discord webhook alerts with dedupe
   - health/readiness endpoints
6. `hermes/profiles/ops/`:
   - `SOUL.md` with the ops contract
   - `config.yaml` with MCP server, Discord, and no terminal/filesystem/browser
   - `.env.example`
7. Deployment:
   - Hermes container with persistent `/opt/data`
   - `arc-mcp` and `monitor` services on the private network
   - Postgres
   - no public port for MCP, monitor, or the Hermes API
8. Verification:
   - unit tests for parser, tools, monitor rules, and dedupe
   - live read-only smoke test against Arc mainnet
   - Discord test message
   - secret scan

Acceptance criteria:

- `docker compose up` starts Postgres, Arc MCP, monitor, and Hermes.
- `GET /health` on the MCP server and monitor returns healthy.
- `arc_get_treasury_state` returns live values matching `cast` reads.
- `arc_list_activity` returns the known mainnet deposit/withdraw events.
- `arc_get_cctp_status` on burn `0x79006a…2b13` returns `done` with `delivered: true`.
  The mint tx link is best-effort; Hermes reports it only when Iris supplies a forwarder tx.
- `arc_get_cctp_status` on a fresh/unattested burn returns `waiting`, not `done`.
- The monitor writes a snapshot and a transfer row.
- A forced test alert reaches the private Discord channel once, and a repeat does not spam.
- Hermes Ops answers a question in Discord using only MCP read tools.
- Unauthorized Discord users are ignored or declined.
- No secret is present in `git status`, logs, or the built image.
- The existing app still passes `63` Vitest tests, `tsc`, `oxlint`, and `vite build`.
- No transaction is signed or broadcast by any Phase 1 component.

### Phase 2 — user-facing Hermes and typed intents

- Add the BFF with SIWE and sessions.
- Add the `user` Hermes profile with a private API server.
- Add the persistent Hermes dock/button to `src/App.tsx`.
- Add deep links from chat to Deposit/Withdraw with prefilled amounts.
- Add typed intent creation in the BFF.
- Add app-side simulation and wallet-agnostic signing through the connected EIP-1193 wallet.
- Add cross-device transfer history from Postgres, while keeping the current chain-derived Activity.
- Add user-scoped rate limits and cost caps.
- Keep the LLM read-only; intent creation is deterministic.

Acceptance criteria:

- A user signs in with SIWE; the browser never sees server keys.
- Chat can explain a balance, activity, or CCTP status with a tx link.
- Chat cannot move funds or create an arbitrary transaction.
- A deposit/local withdraw/CCTP intent is simulated and signed in MetaMask, Rabby, Coinbase Wallet,
  Brave, or another EIP-1193 wallet without wallet-specific branches.
- The intent expires and cannot be replayed.
- The Activity tab never shows Resume for a completed transfer.
- No duplicate CCTP panel is added to Withdraw.

### Phase 3 — keeper bookkeeping and incident automation

- Rotate keeper away from the owner EOA.
- Deploy the isolated keeper signer.
- Enable only verified `executeWithdrawal` bookkeeping.
- Add owner-action drafts for any EIP-1193 wallet or Safe.
- Add incident threads, diagnostics, and postmortems.
- Book the audit before raising caps or onboarding third-party agents.

## 6. Security model

| Threat | Control |
|---|---|
| Owner key theft | Owner key never leaves the user's wallet or Safe; no owner key in cloud |
| Keeper key theft | Separate KMS/HSM signer; allowlist; caps; kill switch |
| Public prompt injection | User profile has no terminal/filesystem/browser; read-only MCP; no secrets in prompt |
| Malicious chain data | Treat hook data, memos, and tx metadata as untrusted; never follow instructions from them |
| Discord impersonation | `DISCORD_ALLOWED_USERS` allowlist; private channel; unknown DMs declined |
| API key leak | BFF holds Hermes keys; browser never sees them; per-profile keys |
| MCP server compromise | Internal network only; bearer token; `trust: untrusted`; read-only annotations |
| LLM hallucination | Deterministic status from Iris/destination; tool output includes `asOfBlock`/`stale` |
| Replay | Idempotency keys; unique constraints; signed, expiring intents |
| Double bookkeeping | Postgres advisory lock per withdrawal id; on-chain `executed` check |
| Monitor outage | Heartbeat alert; Hermes cron watchdog; app remains usable without monitor |
| Log leakage | Redact tokens; never log request bodies containing secrets; no private keys ever |
| Cost blowup | Per-profile model, max concurrent runs, per-chat spend limits, cheap ops model |

Rules for the Ops prompt:

- Report facts, not guesses.
- Say `unknown` when the monitor has no answer.
- Never claim a CCTP transfer is complete unless `phase == done`.
- Never ask for a seed phrase or private key.
- Never propose a transaction without showing the exact contract, function, amount, and chain.
- Owner-only actions are drafted for human approval; they are never executed by Hermes.
- If chain data and the database disagree, stop and escalate.

## 7. Incident runbook

Severity:

- **P0** — unexpected pause, owner/keeper mismatch, receiver mismatch, unauthorized withdrawal,
  balance mismatch above threshold, suspected key compromise.
- **P1** — CCTP `ready` with no mint beyond the window, `waiting` beyond the attestation window,
  monitor down, Iris/destination RPC down for a sustained period.
- **P2** — bot offline, stale snapshot, APY display change, Discord delivery failure.

Response:

1. **Detect** — monitor writes an alert with evidence and a dedupe key.
2. **Verify** — Hermes Ops reads the same evidence through MCP; it does not trust the alert text alone.
3. **Contain** — for P0, the human pauses via their EIP-1193 wallet or Safe if appropriate. Hermes
   never pauses.
4. **Communicate** — post a short Discord update: what happened, what is affected, what is not,
   next update time.
5. **Escalate** — owner action is drafted as calldata for the user's wallet or Safe; the human reviews
   and signs.
6. **Resolve** — mark the alert resolved only after the chain/monitor confirms the condition is gone.
7. **Postmortem** — append an `audit_events` record and a short markdown note.

Hermes may run read-only diagnostics automatically. It may not execute owner or keeper writes.

## 8. Observability and operations

- Structured JSON logs from the MCP server and monitor.
- Hermes per-profile gateway logs on the persistent volume.
- `GET /health` on the MCP server and monitor. Add `/ready` when a load balancer is introduced.
- Daily ops digest at 09:00 UTC: balances, open transfers, bookkeeping queue, incidents.
- Discord channels:
  - `#hermes-alerts` — webhook alerts, no chat
  - `#hermes-ops` — allowlisted interactive ops
  - `#hermes-status` — daily digest and incident updates
- Backup Postgres daily; test restore monthly.
- Keep the app deployable without Hermes. If Hermes is down, deposit/withdraw/activity still work.

## 9. Testing plan

Current Hermes tests: **29 passing** on Vitest 5 (`hermes/test/*`) covering the shared parser,
config, monitor rules, Discord delivery, MCP tool registration/scope enforcement, the
migration SQL, alert dedupe/throttle persistence, distinct read-warning alerts, JSON
timestamp conversion, managed-Postgres TLS config, and fail-closed MCP token validation.
`npm audit` reports no vulnerabilities. Root Vitest remains
**63 passing**, plus typecheck, lint, and production build. Live read-only smoke passed against
Arc mainnet (`arc_get_config`, `arc_get_treasury_state`, bounded `arc_list_activity`, and
`arc_get_cctp_status` for the known id 3 burn returning `done`).

Phase 1 coverage status:

- Completed:
  - CCTP parser against shaped mainnet/testnet messages
  - config defaults, overrides, blank-env normalization, and scope separation
  - monitor rule evaluation, dedupe/throttle persistence, and Discord delivery
  - migration SQL applies twice (idempotent) and enforces transfer phases
  - MCP tool registration, Ops/User scopes, and live Streamable HTTP client
  - missing/incorrect MCP token rejected; user scope cannot call ops tools
  - live read-only mainnet state, activity, and known `done` withdrawal id 3
- Verified without Docker against a PGlite Postgres wire server:
  - `npm run migrate` applied `001_init.sql`
  - monitor runs indexed 11 events on the first pass and 1 on catch-up
    (12 total), created 3 done transfers (withdrawal ids 1–3), and built the
    bookkeeping queue; incomplete Arc reads are rejected instead of being
    stored as zero balances
  - MCP DB tools returned queue ids `1,2,3` with `ready_for_keeper`, persisted
    transfer id 3 as `done`, and the open `keeper-is-owner` incident
- Still pending on a machine with Docker:
  - full Compose bring-up with real Postgres, `migrate`, MCP, and monitor
  - Hermes profile launch, `mcp test arc-treasury`, and Discord allowlist check
  - in-container smoke and monitor snapshot/transfer rows
- Still pending manual app check:
  - rebuilt mainnet `dist/` deployed and Activity tab checked (completed rows
    must not show **Resume**)
- Regression:
  - frontend `63` Vitest tests pass
  - `tsc --noEmit`, targeted `oxlint`, and production `vite build` pass

## 10. Deployment

### Local

```bash
cd hermes
bash bootstrap.sh
# edit .env and data/profiles/ops/.env
docker compose up -d --build
docker compose ps
```

For loopback-only debugging ports:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
```

See `docs/HERMES_VPS.md` for the full VPS, Discord, firewall, backup, and
connectivity checklist.

### Fly.io (default)

- App `agent-treasury-hermes`:
  - official Hermes image
  - persistent volume at `/opt/data`
  - no public IP
  - private network only
- App `agent-treasury-services`:
  - Arc MCP on `8788`
  - monitor on `8787`
  - private network only
- Postgres:
  - Fly Postgres, Neon, or Supabase
  - private connection string
- Secrets:
  - `DISCORD_BOT_TOKEN`
  - `DISCORD_ALLOWED_USERS`
  - `ARC_MCP_TOKEN_OPS`
  - `ARC_MCP_TOKEN_USER` (Phase 2)
  - `API_SERVER_KEY` (Phase 2)
  - `DATABASE_URL`
  - `DATABASE_SSL=true` when the managed provider requires TLS
  - the selected model provider key (for example `ANTHROPIC_API_KEY`)
  - `DISCORD_WEBHOOK_URL`
- Public HTTPS only on the BFF in Phase 2.
- No public port for Hermes API, MCP, monitor, or Postgres.

### Railway alternative

Same topology, one project with services for Hermes, Arc MCP, monitor, and Postgres. Use private
networking and volumes.

### Why not serverless-only

Hermes is a long-running gateway with a persistent home, cron, sessions, and Discord WebSocket
connections. A container platform with a volume is a better fit than a stateless edge worker.

## 11. Cost estimate

Approximate monthly, excluding LLM usage:

- Hermes container: $5–20
- Arc MCP + monitor: $5–15
- Postgres: $0–15
- Volume/egress: $1–5

LLM usage depends on model and chat volume. Phase 1 ops-only should be low. Use a cheap model for
summaries and cap concurrent runs.

## 12. Explicit non-goals

- No custom Discord bot framework.
- No custom cron scheduler.
- No custom session database.
- No custom webhook receiver.
- No vector database in Phase 1.
- No Kubernetes.
- No transaction signing inside Hermes.
- No owner key in the cloud.
- No contract redeploy in Phases 1–3.
- No automated bookkeeping before keeper rotation.

## 13. Phase 1 task checklist

- [x] Write `docs/HERMES.md` (this file).
- [x] Add `shared/cctp-message.ts` and switch the frontend parser to it without behavior change.
- [x] Scaffold `hermes/` with package.json, tsconfig, Dockerfile, `.dockerignore`, compose, env examples.
- [x] Add `hermes/src/config.ts`, `abis.ts`, `cctp.ts`, `activity.ts`.
- [x] Add MCP server with bearer scopes and read tools.
- [x] Add Postgres migrations and DB helpers.
- [x] Add monitor with snapshot, transfer tracking, dedupe, and Discord webhook.
- [x] Add Ops profile `SOUL.md` and `config.yaml`.
- [x] Add user profile templates, disabled in Phase 1.
- [x] Add unit and integration tests.
- [x] Run live read-only smoke tests.
- [ ] Deploy to Fly.io/Railway with private networking.
- [ ] Verify Discord and alerts.
- [x] Write findings back to `AGENTS.md`.

## 14. Open decisions

Defaults are chosen so Phase 1 can start immediately:

| Decision | Default |
|---|---|
| Cloud | Fly.io |
| Postgres | Fly Postgres or Neon |
| Phase 1 scope | Ops-only, read-only |
| LLM provider | Nous Portal or OpenAI-compatible; cheap ops model |
| Discord | Private server, allowlisted user IDs |
| Public web chat | Phase 2 |
| Keeper | Phase 3, after rotation |
| Contract changes | None |

If any default is wrong, only the deployment section changes; the architecture and Phase 1 code do not.

## Appendix A — initial configuration shapes

These are starting points, not final secrets. **The implemented files in `hermes/` are
authoritative** (`profiles/ops/config.yaml`, `.env.example`, `profiles/ops/.env.example`, and
`docker-compose.yml`). The snippets below are kept as design context; where they differ, use the
files and `docs/HERMES_VPS.md`.

### Ops profile

```yaml
# hermes/profiles/ops/config.yaml
model:
  provider: "anthropic"
  default: "claude-sonnet-4-6"

agent:
  # Ops answers questions and reads chain state. It does not need a shell.
  disabled_toolsets:
    - terminal
    - file
    - browser
    - web
    - search
    - skills
    - code_execution
    - delegation
    - cronjob
    - vision
    - image_gen
    - video_gen
    - tts
    - computer_use
    - connections
    - catalog
    - desktop_ui
    - project
    - kanban
    - discord_admin
    - x_search

mcp_servers:
  arc-treasury:
    url: "http://arc-mcp:8788/mcp"
    headers:
      Authorization: "Bearer ${ARC_MCP_TOKEN_OPS}"
    trust: untrusted
    timeout: 60
    tools:
      include:
        - arc_get_config
        - arc_get_treasury_state
        - arc_list_activity
        - arc_get_cctp_status
        - arc_get_transfer
        - arc_get_bookkeeping_queue
        - arc_get_incidents
      resources: false
      prompts: false

approvals:
  mode: smart
  cron_mode: deny
  single_query_mode: deny
  unattended_mode: deny
```

`data/profiles/ops/.env` (from `hermes/profiles/ops/.env.example`):

```dotenv
DISCORD_BOT_TOKEN=...
DISCORD_ALLOWED_USERS=...
ARC_MCP_TOKEN_OPS=...
```

Do not add `DISCORD_REQUIRE_MENTION=false` for Ops. Keep mention-only behavior.

### User profile (Phase 2)

```yaml
# hermes/profiles/user/config.yaml
model:
  provider: "anthropic"
  default: "claude-sonnet-4-6"

agent:
  # No terminal, filesystem, browser, cron, or code execution.
  # Memory and session search stay off until per-user isolation is proven.
  disabled_toolsets:
    - terminal
    - file
    - browser
    - web
    - search
    - skills
    - memory
    - session_search
    - code_execution
    - delegation
    - cronjob
    - vision
    - image_gen
    - video_gen
    - tts
    - computer_use
    - connections
    - catalog
    - desktop_ui
    - project
    - kanban
    - discord_admin
    - x_search

mcp_servers:
  arc-treasury:
    url: "http://arc-mcp:8788/mcp"
    headers:
      Authorization: "Bearer ${ARC_MCP_TOKEN_USER}"
    trust: untrusted
    timeout: 60
    tools:
      include:
        - arc_get_config
        - arc_get_treasury_state
        - arc_list_activity
        - arc_get_cctp_status
        - arc_get_transfer
      resources: false
      prompts: false

gateway:
  api_server:
    enabled: true
    host: 0.0.0.0
    port: 8642
    key: ${USER_API_SERVER_KEY}
    max_concurrent_runs: 4

approvals:
  mode: smart
  unattended_mode: deny
```

The BFF is the only caller. Do not set a permissive `API_SERVER_CORS_ORIGINS`; the BFF is
server-to-server.

### MCP tool annotation example

```ts
server.registerTool(
  "arc_get_treasury_state",
  {
    title: "Get Agent Treasury state",
    description: "Read-only Arc treasury balances and configuration. Never signs.",
    inputSchema: {
      agent: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ agent }) => {
    const state = await readTreasuryState(agent)
    return {
      content: [{ type: "text", text: JSON.stringify(state) }],
      structuredContent: state,
    }
  },
)
```

Read tools must carry `readOnlyHint: true`. Any future draft/intent tool must carry
`readOnlyHint: false` and must not broadcast.

### Compose shape

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: treasury
      POSTGRES_USER: treasury
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U treasury"]
      interval: 5s
      timeout: 5s
      retries: 10

  arc-mcp:
    build:
      context: ..
      dockerfile: hermes/Dockerfile
    image: agent-treasury-hermes:local
    command: node dist/mcp/server.js
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    expose:
      - "8788"

  monitor:
    build:
      context: ..
      dockerfile: hermes/Dockerfile
    image: agent-treasury-hermes:local
    command: node dist/monitor/run.js
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    expose:
      - "8787"

  hermes:
    image: nousresearch/hermes-agent:latest
    command: ["--profile", "ops", "gateway", "run"]
    environment:
      HERMES_HOME: /opt/data
    volumes:
      # All Hermes state lives here, including profiles/ops and its .env.
      - ./data:/opt/data
    depends_on:
      - arc-mcp
    # Phase 1 publishes no host ports. Add a BFF only in Phase 2.

volumes:
  pgdata:
```

Do not publish `8787`, `8788`, or Postgres publicly. The actual
`hermes/docker-compose.yml` publishes no ports at all; the optional
`docker-compose.local.yml` binds only to `127.0.0.1` for debugging. In production, put a BFF on
the public network only when Phase 2 adds one.

### Required `.env` keys

The actual split is:

- `hermes/.env` (service): `ARC_NETWORK`, `TRACKED_AGENTS`, `POSTGRES_*`, `DATABASE_URL`
  (host-only), `DATABASE_SSL` (managed Postgres only), `ARC_MCP_TOKEN_*`,
  `DISCORD_WEBHOOK_URL`, monitor intervals.
- `data/profiles/ops/.env` (Hermes profile): `DISCORD_BOT_TOKEN`, `DISCORD_ALLOWED_USERS`,
  `ARC_MCP_TOKEN_OPS`, the LLM provider key, and `API_SERVER_ENABLED=false`.

See `.env.example` and `profiles/ops/.env.example` for the current list.
MCP tokens must be at least 32 characters; known placeholders and short values
are rejected at startup, so a half-configured stack fails closed. Local runs bind
`MCP_HOST`/`MONITOR_HOST` to `127.0.0.1` by default; Compose sets both to
`0.0.0.0` inside the private network and publishes no host ports.

No key in this file may be an owner or keeper signing key.
