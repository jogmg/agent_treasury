# Agent Treasury

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## Session discipline (IMPORTANT for future agent sessions)

This project is being built for a hackathon on a metered Arc Studio AI quota. Every session must conserve it:

- **Never run `arc-studio upgrade`** or any other quota-consuming Arc Studio CLI flow unless the user explicitly asks.
- **Do all local work (code, tests, lint, build, docs, git) directly in this repo without touching Arc Studio.**
- **Prefer reading this file first** over re-exploring the codebase; it already documents architecture, addresses, cul-de-sacs (CCTP uint64 return bug, hooks are not automatic, etc.), and current status.
- **Keep edits small and targeted**; batch verification (typecheck + lint + tests + build in one command) instead of cycling on each file.
- **Write findings back here** so the next session does not need to rediscover them.
- The user will compact conversations before context usage gets high; do not restart work that this file already covers.

## What This App Does

Cross-chain USDC treasury for AI agents. Accepts USDC from any CCTP-supported chain via CCTP v2, auto-deploys into a Morpho yield vault on Arc, and allows withdrawals to any destination chain. Three Circle products: CCTP v2 + Circle Gateway + Earn Kit (Morpho). Outbound burns use standard finality (2000) for reliable Arc-origin attestations.

## Arc Mainnet Deployment (LIVE, Oct 21, 2026) — UNAUDITED, GUARDRAILED

The app defaults to **Arc mainnet** (`VITE_ARC_NETWORK=mainnet`, chain `5042`). Testnet remains
available by building with `VITE_ARC_NETWORK=testnet`.

| Contract | Address | Explorer |
|---|---|---|
| AgentTreasury | `0xf71b5d1a19d72b98675785123fae811698be6f63` | [link](https://explorer.arc.io/address/0xf71b5d1a19d72b98675785123fae811698be6f63) |
| MorphoVaultAdapter | `0x5102057330f5bb5f3e4eb0925b7d1eac8a563c23` | [link](https://explorer.arc.io/address/0x5102057330f5bb5f3e4eb0925b7d1eac8a563c23) |
| CCTPReceiver (abandoned) | `0x91f1eb97a40fdab05d150c10566cf9aa3546a375` | [link](https://explorer.arc.io/address/0x91f1eb97a40fdab05d150c10566cf9aa3546a375) |
| CCTPReceiverV2 #1 (superseded) | `0x54776bc9551b0dC8c1c83c21F81F11eF3A59Da98` | [link](https://explorer.arc.io/address/0x54776bc9551b0dC8c1c83c21F81F11eF3A59Da98) |
| **CCTPReceiverV2 (corrected)** | **`0x847F55221F30675791d2fAaf84f93B1fa86399E2`** | [link](https://explorer.arc.io/address/0x847F55221F30675791d2fAaf84f93B1fa86399E2) |

`CCTPReceiverV2` #1 deployed at block `27199918` (tx
`0xeeac642b5f68e4cd489764c3409d3bb48099c010aae03f8031a227d829c413da`) and wired at
block `27199934` (tx `0x5a8a5e2a0c3d8882feef3463de2fc3bd01e8327419f7f34fed04071b195df907`).
It was superseded by the corrected receiver `0x847F55221F30675791d2fAaf84f93B1fa86399E2`,
deployed at block `27315893` (tx
`0x5aa620ba929d7e921ee7ea02b8f5a34f1975c1487db6f81073cd34a2bf9cf1fe`) and wired at
block `27315906` (tx `0x8d0f4d1b7330ee6cb6c1937c57927b3b250ce950a2ba926e98f3fd27d799e7ba`).
`treasury.gatewayReceiver()` now points at the corrected receiver. No inbound burn
targeted V2 #1, so no funds were at risk; the treasury was not redeployed. The
earlier mainnet Base→Arc 5 USDC inbound used the legacy mint-to-wallet path and
recorded domain 26. The corrected mainnet receiver path passed live on 2026-10-22
(5 USDC Base→Arc, `0xdd79d20a…d873b86`, `DepositRecorded.sourceDomain = 6`).

- Deploy block `27153175` (adapter), treasury `27153209`. Owner/keeper:
  `0xD00fD0B006c01342522cAf4FA04D5f8910aB268c`.
- Vault 1: **Galaxy USDC** `0x8E357432CC12ff425c36432F312968aEb16112AF` (`arcUSDC`), 18-dec shares,
  ~2.65% net APY, 0 fees, ~12.2M USDC instant liquidity. Fallback: Steakhouse Prime
  `0xbeef0016cb2Fd5C352ea7CA08a9f54739DFa7298` (~1.97% APY).
- **Mainnet minimum deposit is 5 USDC** (`5_000_000`), economics-based. It is far above the
  zero-share threshold; `previewDeposit(5 USDC)` > 0 and `previewMint(1 wei)` = 1 wei.
- Spending limit for the owner agent: **25 USDC/day, 50 USDC/week**. Keeper = owner EOA for launch.
- Mainnet CCTP differs from testnet: TokenMessengerV2 `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`,
  MessageTransmitterV2 `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`, domain `26`.
  The testnet CCTP addresses have **no code** on mainnet.
- Independently verified after deploy: bytecode at the original three contracts + vault, all owner/keeper
  wiring, `morphoAdapter`/`gatewayReceiver`, `ARC_DOMAIN == 26`, `defaultVaultId == 1`, both
  `paused == false`, vault active with `minDeposit == 5_000_000`, `asset() == USDC`.
- Rehearsed first on a live Arc mainnet fork: `contracts/test/fork/MainnetDeploy.t.sol` PASS,
  5,761,118 gas (~0.12 USDC) for the full 10-tx sequence.
- Deployment was driven by the user's MetaMask from `scripts/mainnet-deploy/` (template + artifact
  injector). No private key ever touched this repo or the chat.
- **Live mainnet E2E passed (Oct 21, 2026)**: 5 USDC deposited into Galaxy USDC and 1 USDC
  withdrawn locally. Approve `0xce4676…e375`, deposit `0xf48c28…0225` (minted
  `4,996,584,486,017,754,953` shares), withdraw `0x5caf81…76b0` (resolved `0.999999`, burned
  `999,316,858,421,847,964` shares). After: principal `4.000001`, shares `3,997,267,627,595,906,989`,
  `getTotalBalance` = `4` USDC, wallet `9.286509` USDC. The 1-unit gap is ERC-4626 rounding.
- **Live mainnet CCTP E2E passed (Oct 21, 2026)**: two outbound withdrawals (1.999999 and
  4.999999 USDC, ids 1–2) burned on Arc to Base domain `6`; both Iris attestations are `complete`
  and both mints landed on Base (`0x58c3eb…59fa`, `0x68045f…7609`, relayed by `0xecfe41…c717`).
  Then 5 USDC was burned on Base (`0xadf19a…b280`) and minted on Arc via `receiveMessage`
  (`0xb2a7ba…246c`), followed by `deposit()` (`0xb1e34e…026b`, `4,996,555,771,054,222,485` shares).
  Post-state: principal `9.000003`, shares `8,993,822,921,076,662,356`, total `9.000028` USDC.
  Note: `DepositRecorded` shows source domain `26` (the app deposits from the Arc wallet after mint);
  source-domain accounting is still TODO #10. Withdrawal ids 1–2 are still `executed=false` on-chain —
  run keeper `executeWithdrawal` to clear them.
- **Live mainnet receiver inbound proof passed (Oct 22, 2026)**: withdrawal id 3 burned
  `4.999999` USDC on Arc (`0x79006a…2b13`, block `27317380`); Iris status `complete`
  (nonce `0xfb087f…bf75`) and Base minted `4.999999` USDC to the owner (`0x875d82…8a94`,
  block `52950067`). Then 5 USDC was burned on Base
  (`0x0b4aa4f9…a735`, block `52950088`) and sent Base→Arc through the corrected receiver
  `0x847F…99E2` (`0xdd79d2…3b86`, block `27319900`): `DepositRecorded.sourceDomain = 6`,
  amount `5000000`, vault id `1`, shares `4,996,190,411,368,419,803`; receiver and treasury
  USDC both returned to `0`. Post-state: principal `10.000001`, shares
  `9,992,387,766,924,438,899`, total `10.000011`, `depositsByChain(6) = 5000000`,
  `depositsByChain(26) = 27000000`. Withdrawal id 3 remains `executed=false` (bookkeeping
  only; the app derives completion from Iris/destination state).
- **Mainnet treasury is now fully withdrawn (observed 2026-10-22, block `27346931`)**:
  `WithdrawalToWallet` tx `0x181942ba…5aa2c`, amount `10.000156` USDC, shares burned
  `9,992,387,005,757,887,292`. Current view: principal `0`, total `0`, vault dust
  `761,166,551,607` shares, `previewRedeem` `0`, treasury USDC `0`, owner wallet `11.151658`
  USDC. `depositsByChain` remains cumulative (`27,000,000` domain 26 + `5,000,000` domain 6).
- Full record: `deployments/arc-mainnet.json`. Audit: not done (owner chose "ship with guardrails":
  low caps, small live test, external audit before raising limits).

## Hermes Agent (Phase 1 deployed on InstaBox; standalone Ops gateway running)

Full plan: `docs/HERMES.md`. User execution contract: `docs/HERMES_USER_EXECUTION.md`. VPS
runbook: `docs/HERMES_VPS.md`.

- Phase 1 code is in `hermes/`: shared CCTP parser, read-only Arc/CCTP MCP server, Postgres
  migrations, deterministic monitor, Discord webhook alerts, Ops profile, and Docker Compose.
  Hermes tests: 29 passing on Vitest 5 (including MCP tool registration/scope enforcement,
  migration SQL, alert dedupe/throttle persistence, distinct read-warning alerts, JSON
  timestamp conversion, managed-Postgres TLS config, and fail-closed MCP token validation).
  `npm audit` is clean. Root Vitest remains 63 passing.
- Live read-only MCP smoke passed against Arc mainnet: `arc_get_config`, `arc_get_treasury_state`,
  bounded `arc_list_activity`, and `arc_get_cctp_status` for burn `0x79006a…2b13` returned `done`
  with `delivered: true`. Mint tx links are best-effort and may be absent for manual mints.
- Hardening notes: blank `.env` values are normalized to unset (so an empty
  `DISCORD_WEBHOOK_URL` is valid); withdrawal transfer indexing only inserts burns not already in
  `transfers`; MCP authenticates before JSON parsing and closes the stateless transport/server per
  request; PGlite tests cover the migration SQL and alert dedupe/throttle.
- Local services bind loopback by default (`MCP_HOST`/`MONITOR_HOST`), while Compose sets both to
  `0.0.0.0` on the private network. The Ops profile uses NVIDIA Build free endpoints
  (`provider: nvidia`, `NVIDIA_API_KEY`) with a ranked `fallback_providers` chain and short
  aliases for `/model`; the User profile remains a separate Phase 2 template. Managed Postgres can
  opt into TLS with `DATABASE_SSL=true`.
- Transfer refresh runs four at a time. Delivery comes from destination `usedNonces` plus Iris; the
  mint tx link is only a forwarder-tx receipt when Iris supplies one, so manual mints may have no
  link. Two fresh monitor runs indexed 11 + 1 catch-up activity events and resolved withdrawal ids
  1–3; the first run took about 17s, under the 60s interval. The monitor refuses to persist a
  snapshot when a core Arc read is missing, so partial RPC failures become incidents instead of
  zero balances.
- **Live InstaBox deployment (Oct 22–23, 2026).** The private Compose stack is running on the
  free `agent-browser` machine (4 vCPU, 8 GiB, 20 GiB `/data`): `postgres`, `arc-mcp`, and
  `monitor` are healthy; `migrate` exited 0. Verified rows: 3 treasury snapshots, 12 activity
  events, 3 done transfers (ids 1–3), 3 `ready_for_keeper` queue rows, 1 open `keeper-is-owner`
  alert. In-container `scripts/smoke.mjs` passed against Arc mainnet, including a live
  `arc_get_cctp_status` for id 3 (`done`, delivered, no mint link). The real Hermes runtime
  registered the Ops profile, and `hermes -p ops mcp test arc-treasury` connected with all seven
  read-only tools. The standalone Ops gateway is running (`gateway.standalone: true` is required
  because Hermes otherwise expects the default profile to own the host gateway). NVIDIA MiniMax
  M3.1 Flash is primary because it returned tool calls quickly during setup; GLM-5.3 and
  DeepSeek-V4.1-Flash were timing out/over quota and sit later in the fallback chain. Hermes
  one-shot tests returned `OK` and live `arc_get_treasury_state` values. A live Discord mention at
  `2026-10-24 01:15 UTC` produced a 1,966-character status reply at `01:16` in the auto-created
  thread (70.8s, 5 model calls, 13 read-only tool calls). Hermes auto-threads mentions; check the
  thread, not only the parent channel. The first `/sethome` was run inside that thread; the runtime
  home channel was corrected to the main `#treasury-ops` channel (`1562985975234170940`). The
  gateway logged transient Discord WebSocket 503s but reconnected and reported `discord=connected`
  after restart.
- **Secret-handling lesson (2026-10-23):** do not source `profiles/ops/.env` under `set -x` or
  `bash -x`; a debug trace printed the Discord bot token, NVIDIA key, and MCP token. All three were
  rotated (MCP token replaced on both service and profile), the gateway was stopped during
  rotation, and the new values were installed directly on the server. Scripts must print only
  `set`/`EMPTY` and never environment values.
- Disk layout: Docker's `data-root` and the containerd image store were moved to `/data`
  (`/data/docker`, `/data/containerd`, with `/var/lib/containerd` symlinked). After pulling the
  Hermes image, root has ~11 GB free and `/data` ~15 GB free. Pulling the image without moving
  containerd filled root; Docker 29 uses the containerd image store, so `data-root` alone is not
  enough on a 16 GB root disk.
- The free plan has `manualLifecycle: false`; `auto-suspend 0` is refused and auto-pause is fixed
  at 30 minutes. Production keepalive is the **Cloudflare Worker** `instabox-keepalive` in
  `hermes/infra/cloudflare-keepalive/`, with a `*/10 * * * *` cron trigger. Each run calls
  `POST /v1/machines/{id}/wake` and `POST /v1/machines/{id}/exec` with `{"cmd":"true"}` using the
  encrypted `INSTABOX_API_KEY` Worker secret (`machines:read` + `machines:write`, 90-day rotation).
  A manual `pause`/`stop` is not overridden; `wake` only resumes idle auto-pause. Cloudflare was
  adopted because GitHub Free does not run `schedule` events in private repositories, and even the
  public `agent_treasury` schedule was delayed for hours and failed once on an InstaBox CLI
  checksum error. The public `.github/workflows/instabox-keepalive.yml` remains as a
  `workflow_dispatch` manual fallback only.
- Dockerfile fix `f196fca`: the image copies `shared/` to `/shared`, matching the
  `../../shared/cctp-message` import from `/app/src`; the initial `/app/shared` copy failed the
  Docker build. Local Docker Desktop is still absent, so all Compose verification is on InstaBox.
  MCP tokens fail closed if missing, shorter than 32 characters, or left as placeholders.

- Hermes Agent is the **agent runtime/control plane**, not the treasury ledger. Reuse its gateway,
  Discord adapter, cron, MCP client, API server, sessions, logs, and Docker deployment; do not build
  those from scratch.
- Phase 1 is **ops-only and read-only**: Hermes Ops in a private Discord, an Arc/CCTP MCP server,
  a deterministic monitor, Postgres, and a Discord webhook. No public chat, no transaction intents,
  no signer, no keeper, no contract changes.
- The **product path is Phase 2 frontend Hermes User**, not the Ops bot. A user states an intent
  (“send 10 USDC to Base”); Hermes calls the right read tools and deterministic BFF draft endpoints,
  returns a reviewable unsigned action, and the user signs in their EIP-1193/EIP-6963 wallet. Hermes
  never signs, broadcasts, or accepts arbitrary calldata. The full endpoint/tool map, intent schema,
  UX, and acceptance tests are in `docs/HERMES_USER_EXECUTION.md`.
- Postgres is business state. Hermes' SQLite `state.db` is internal and changes between releases; do
  not use it for treasury balances, transfer status, or bookkeeping.
- The LLM never decides completion. Outbound CCTP status comes from Arc `WithdrawalRequested` ->
  Iris -> destination `usedNonces`/`MessageReceived`; the treasury `executed` flag is ignored for
  user-facing completion.
- Public User and private Ops are separate profiles with separate credentials and tool scopes.
  Public profile: no terminal/filesystem/browser, read tools plus deterministic BFF draft actions;
  no execute/sign tool. Ops profile: allowlisted Discord, read-only MCP. Neither profile gets an
  owner key.
- Draft typed intents (Phase 2) are created by the BFF, re-simulated by the app, and signed in the
  user's wallet. The BFF derives `to`/`data` from an allowlisted method and binds the wallet from
  the SIWE session; the model supplies only semantic parameters (kind, amount, destination domain,
  recipient). The user can ask “send 10 USDC to Base” and get an unsigned CCTP draft plus a review
  deep link, not a broadcast. Support is wallet-agnostic across EIP-1193/EIP-6963 wallets (MetaMask,
  Rabby, Coinbase Wallet, Brave, Frame, etc.); never branch on `window.ethereum.isMetaMask` or
  assume a specific wallet UI. Hermes may explain or deep-link; it never signs.
- Keeper automation (Phase 3) stays blocked until the keeper is rotated from the owner EOA to a
  dedicated KMS/HSM-backed key. `executeWithdrawal` is bookkeeping only, but still a write.
- Current deployment: InstaBox free machine with a persistent `/data` volume and private Postgres.
  Fly.io/Railway remains reference material. No public InstaBox port for Hermes API, MCP, monitor,
  Postgres, or the keepalive path; only SSH is reachable, and all service traffic is outbound or on
  the private Compose network. The Cloudflare Worker exposes a public HTTPS URL, but its manual
  trigger requires the `KEEPALIVE_TRIGGER_TOKEN` secret and every other request returns 404.

## Stage 2 + Hardening Pass Contract Summary

### Contract files (contracts/src/)
- `AgentTreasury.sol` - Per-agent accounting, Morpho vault deployment, two withdrawal paths (see below), spending limits, pause
- `MorphoVaultAdapter.sol` - Whitelisted ERC-4626 vault management (deposit/withdraw/preview/APY cache)
- `CCTPReceiver.sol` - inbound CCTP relayer adapter; tolerant BurnMessageV2 decoder (Layout A versioned + Layout B); routes malformed hookData to defaultBeneficiary. CCTP v2 hooks are opaque metadata, so the frontend does **not** rely on automatic hook execution; it mints to the user's Arc wallet and calls `deposit()`.
- `interfaces/` - IAgentTreasury, IMorphoVaultAdapter, ICCTPReceiver, IMorphoVault, ITokenMessengerV2, IMessageTransmitterV2
- `libraries/Errors.sol` - Custom errors (gas-efficient)
- `libraries/CCTPMessageLib.sol` - Hook data encode/decode helpers
- `script/ArcConfig.sol` - All resolved Arc + CCTP network constants (chain IDs, domains, addresses)

### AgentTreasury public interface (frontend-facing functions)

**Arc-local MVP fast path (no bridging):**
- `deposit(uint256 amount)` — pull USDC from msg.sender, credit principal, deploy to active vault
- `withdrawLocal(uint256 amount)` — redeem shares, enforce spending limit, transfer USDC to msg.sender. Pass `type(uint256).max` for everything.

**CCTP cross-chain path (burn on Arc, mint on destination):**
- `requestWithdrawal(agent, amount, destinationDomain, mintRecipient)` — CCTP burn. `amount == type(uint256).max` withdraws all. Spending limits enforced on the RESOLVED amount (fix A).
- `executeWithdrawal(id)` / `cancelWithdrawal(id)` — keeper/owner bookkeeping

**Shared:**
- `recordDeposit(agent, amount, sourceDomain)` — called by CCTPReceiver after CCTP mint
- `getTotalBalance(agent)` — view, never reverts; idle + vault value (try/catch fallback)
- `getPrincipal / getVaultShares / getDepositsByChain / getActiveVault / getWithdrawal`
- `setYieldStrategy / rebalance / claimYield / setSpendingLimit`
- `pause() / unpause()`

### Security properties
- `onlyAgentOrOwner`: requestWithdrawal, withdrawLocal, setSpendingLimit, setYieldStrategy, claimYield — keeper excluded
- `onlyKeeperOrOwner`: rebalance, executeWithdrawal, setWithdrawalMessageHash
- Spending limit bypass fixed: `_redeemAndAccount` resolves the actual amount first; `_enforceSpendingLimit` is called on the resolved amount for BOTH max and partial withdrawals, in both CCTP and local paths

### Test results (forge test) — latest pass
104 tests PASS, 1 skipped (mainnet fork) across:
- AgentTreasury.t.sol (39 tests)
- MorphoVaultAdapter.t.sol (22 tests)
- CCTPReceiver.t.sol (11 tests)
- CCTPReceiverV2.t.sol (23 tests)
- Invariants.t.sol (9 tests)

### Test results (vitest / frontend) — latest pass
63 tests PASS, 0 fail across:
- src/lib/decimals.test.ts (29 tests) — includes formatShares 18-dec coverage
- src/lib/cctp.test.ts (6 tests) — destination map + message nonce
- src/stores/flow.test.ts (12 tests) — flow steps + persisted outbound CCTP transfer history
- src/stores/bridgeDeposit.test.ts (5 tests) — inbound CCTP deposit state + recent source burns

Tests use `vi.restoreAllMocks()` + `Object.defineProperty` for the
`localStorage` stub instead of `vi.stubGlobal`/`vi.unstubAllGlobals` — the Arc
Studio sandbox runs Vitest 5, where the stubGlobal API was removed.

### Deploy scripts
- `contracts/script/Deploy.s.sol` - Deploys all 3 contracts; reads addresses from ArcConfig + env
- `contracts/script/Configure.s.sol` - Wires references, sets keeper, registers vaults, initiates Ownable2Step transfer
- `contracts/script/DeployFixedTestnet.s.sol` - **current** full-stack hotfix deployment + wiring + handoff
- `scripts/complete-cctp.ts` - fetch Iris attestation and call `receiveMessage` on Sepolia

### Resolved constants (contracts/script/ArcConfig.sol)
- Arc testnet chain ID: 5042002 / mainnet: 5042
- CCTP domain (both networks): 26
- USDC (both networks): 0x3600000000000000000000000000000000000000 (ERC-20, 6 dec)
- TokenMessengerV2 testnet: `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`
- MessageTransmitterV2 testnet: `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`
- TokenMessengerV2 mainnet: `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`
- MessageTransmitterV2 mainnet: `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`
- Morpho vault testnet (conservative, ~4.2% APY): `0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88`
- Morpho vault mainnet: Galaxy USDC `0x8E357432CC12ff425c36432F312968aEb16112AF` (`minDeposit` 5 USDC)
- Mainnet deploy script: `contracts/script/DeployMainnet.s.sol` (chain-id, code, vault-asset, and
  min-deposit guards). Requires `ARC_MAINNET_RPC` only for the fork test, not for the script.

## CCTP Hotfix Deployment (testnet, Oct 2026) — WIRED + E2E VERIFIED

| Contract | Address | Explorer |
|---|---|---|
| MorphoVaultAdapter | `0x333deccbf9091540e849b7af80f2f10b72197b71` | [link](https://explorer.testnet.arc.io/address/0x333deccbf9091540e849b7af80f2f10b72197b71) |
| CCTPReceiver (abandoned) | `0x8066bcf8e6b17e2d84082179a89f0972cc6e31c1` | [link](https://explorer.testnet.arc.io/address/0x8066bcf8e6b17e2d84082179a89f0972cc6e31c1) |
| CCTPReceiverV2 #1 (superseded) | `0xa0d233e24B7B2280bC4f9a2447F59860050aCb4D` | [link](https://explorer.testnet.arc.io/address/0xa0d233e24B7B2280bC4f9a2447F59860050aCb4D) |
| **CCTPReceiverV2 (corrected)** | **`0x344466B00BED1BD5bdFa3E21392E776144323f4c`** | [link](https://explorer.testnet.arc.io/address/0x344466B00BED1BD5bdFa3E21392E776144323f4c) |
| AgentTreasury | `0x5e2e3da19533ebf85bc916612eff5cdc7bf4d489` | [link](https://explorer.testnet.arc.io/address/0x5e2e3da19533ebf85bc916612eff5cdc7bf4d489) |

`CCTPReceiverV2` #1 deployed at block `68434709` (tx
`0x3aa59c55cca7e1f8b1614ac78dd6d818d786bc2cb15db05eee92985a0c8add91`) and wired at
block `68434720` (tx `0xd82842a828f3a115a2ce1a938c23f4a40b58ba908a773876a9d3f30e388e9f66`);
it was superseded the same day (burnToken bug). The corrected receiver
`0x344466B00BED1BD5bdFa3E21392E776144323f4c` deployed at block `68444166` (tx
`0xd11d7f70cd421fa860cc68b930fe011b011f27d1787940318221ad57660f067a`) and wired at
block `68444182` (tx `0x882c79a0dc6cd932145150cb9c635234b395f71d2c7efbc691101b942934c801`).
The old `CCTPReceiver` and V2 #1 are abandoned; `treasury.gatewayReceiver()` points at the
corrected receiver. `TESTNET_ADDRESSES.receiver` was updated accordingly.

Deploy block: `68193025`. Owner/keeper: `0xD00fD0B006c01342522cAf4FA04D5f8910aB268c`.
Full record: `deployments/arc-testnet-fixed.json`.

### CCTP root cause + fix
Arc's `TokenMessengerV2.depositForBurnWithHook` returns **no data**. The original
`ITokenMessengerV2` declared `returns (uint64 nonce)`, so every burn succeeded and
then the treasury reverted while decoding the empty return buffer, rolling back the
whole withdrawal. Fix: no return values; `CCTP_MIN_FINALITY_THRESHOLD = 2000`.

### Live E2E proof (real testnet USDC)
- Approve 10 USDC: `0x158ed9048899e22ef6d087bdd2489cf70a215ae6b6ca602e6828e997a2df69fe`
- Deposit 10 USDC: `0xbab5877074904d17fb21b49aed8c3d2a956ee8d16d3ddc3ec523046d464a04c4`
  → balance `9999999`, shares `9989427554595819468`
- CCTP withdraw 1 USDC to domain 0: `0x3f0f256843ee4e1498cafceea9978725397904899bb527f684eb98c171e28a1c`
  → withdrawal id `1`, burned `999999`, `MessageSent` finality `2000`, balance `9000000`
- Iris attestation: `complete`, `finalityThresholdExecuted=2000`; destination mint pending Sepolia gas.
- Use `scripts/complete-cctp.ts` to finish the Sepolia mint once funded.

### Live inbound CCTP proof (2026-10-22) — PASS
- Base Sepolia -> Arc, 3 USDC, source domain `6`.
- Burn `0xf07a1cff21a97fa89bd53fc45c2ae6a967e2887f62a3c609195e94e53f198750`
  block `48561808`; Iris status `complete`; nonce
  `0x84d93b61681105269d8be01e1af0885cbead2ac9c2cac462cc3479878e34768d`.
- Arc `receiveAndProcess` `0x7eabd5bcdd25163fde02e8621f93e840b703cb138d2ea9cf932e29079447d409`
  block `68550820`; `DepositRecorded` amount `3000000`, `sourceDomain = 6`, vaultId `1`,
  shares `2996828265797596427`; `MessageProcessed` also reports source domain `6`.
- Accounting after: `principal = 12000001`, `totalBalance = 12000000`,
  `depositsByChain(6) = 3000000`, `depositsByChain(26) = 10000000`,
  receiver USDC balance `0`, treasury USDC balance `0`, `paused = false`.
- The earlier 10 USDC Sepolia burn (`0x2f62e2...9501`) exercised the legacy
  mint-to-wallet path, not `CCTPReceiverV2`.

### Frontend hotfix additions
- `LegacyRecoveryCard` in the Withdraw tab recovered funds from the old stack via `withdrawLocal`. **Removed Oct 2026** (no user funds remain in the legacy treasury for the current wallet); the legacy addresses below are kept only as a historical record.
- `OwnershipCard` in Settings accepts the Ownable2Step handoff on all three contracts.
- `CctpCompletionCard` polls Circle Iris after a burn, switches to the destination chain, and submits `receiveMessage`. It also lists recent CCTP requests and accepts a pasted Arc burn tx hash. The destination mint still needs destination-chain gas.
- `CrossChainDepositCard` implements inbound CCTP in the Deposit tab as a **collapsible `<details>` panel** (summary shows a live status badge and auto-opens while in flight): source-chain `depositForBurnWithHook` (`mintRecipient` = `destinationCaller` = `CCTPReceiverV2`, `hookData` = `abi.encode(agent)`) → Iris poll → Arc `receiveAndProcess` (mints to the receiver and credits the real source domain in one tx). It requires source USDC, source gas, and a little Arc gas. Legacy burns that mint to the connected wallet still fall back to Arc `approve` + `treasury.deposit()`. It has a **Track a source transaction** recovery form (validates destination domain, mintRecipient, and destinationCaller) and the Activity tab shows a pending bridge banner with the source tx link, since source-chain burns do not appear in Arc logs until the mint/deposit.
- **Zero-share deposit guard:** `MorphoVaultAdapter.deposit()` reverts `Errors.ZeroShares()` if the vault mints 0 shares (test: `test_deposit_zero_shares_reverts`). The **mainnet adapter includes this guard**; the live testnet adapter predates it. The frontend still covers both: `useDepositShares` calls `previewDeposit(amount)` + `previewMint(1)` and blocks zero-share deposits in the Deposit tab and cross-chain card (the card re-checks just before `treasury.deposit()`). Mainnet `minDeposit` was set to **5 USDC** from share price + unit economics (gas vs. yield), not a hardcoded guess, and is adjustable with `updateVault` as the share price moves. Testnet remains at 1 USDC for demos.
- The in-flight flow and its burn hash survive a reload: the active bridge-deposit state and a recent-burns list are persisted (`agent-treasury-bridge-deposit-v1`), and outbound CCTP withdrawals are persisted in `flow.ts` (`agent-treasury-cctp-outbound-v1`) once the burn receipt confirms. Activity rows render through one uniform `ActivityRow` UI (`EventRow.tsx`): `eventRowData` maps chain events, `pendingRowData` (PendingCctpRow.tsx) maps transfers with explicit **CCTP Deposit** / **CCTP Withdrawal** kind badges, status, chains, amount, burn/mint tx links in the expandable panel, timestamp, and a Resume CTA that restores the active flow and switches tabs (completed transfers render no CTA). Resume is gated on a real answer from either the persisted transfer history or the off-chain status: while the Iris/destination check is still loading, no CTA is shown; `done` records never get Resume, and only known `waiting`/`ready`/`error` rows do. This prevents a completed withdrawal from briefly flashing Resume on first load before the status query resolves. Rows are merged and sorted most-recent first: `fetchActivityEvents` enriches each event with its block timestamp (`getBlocks` cached per block, linear interpolation when a fetch fails); if any timestamp is missing the UI falls back to block order with pending rows first. Expanded chain panels show `Block N · date time`. Filters are **All / In flight / Deposits / Withdrawals / Yield** (the old Pending value was renamed to `inflight`); chain-event rows are relabeled (`WithdrawalRequested` → "CCTP Withdrawal", local → "Local Withdraw", `DepositRecorded` shows the source chain). The Withdraw tab has **no** recent-request list (transfers live in the Activity tab) — only the paste-hash recovery remains. The growth chart has 24h/7d/30d/All range buttons. `resetCctp`/`resetBridgeDeposit` intentionally keep the history lists. The Withdraw tab's destination selector is a chain-name dropdown built from `CCTP_DESTINATIONS`.
- `ADDRESSES` / `ARC_TREASURY_DEPLOY_BLOCK` are selected at build time: mainnet defaults are the
  Galaxy stack above; `VITE_ARC_NETWORK=testnet` switches to the hotfix stack. `LEGACY_ADDRESSES`
  keep the pre-hotfix testnet stack for recovery.
- **`getVaultConfig` ABI quirk:** the deployed adapter returns `VaultConfig` as a SINGLE struct (one tuple output). `ADAPTER_ABI` must declare `returns ((uint256 id, address vaultAddress, string name, string symbol, uint256 minDeposit, bool isActive))` and callers read `data.minDeposit`. Declaring six flat outputs makes viem decode `name` from the vault address and throw `IntegerOutOfRangeError`, silently killing the live min-deposit read.

## CCTPReceiverV2 (inbound source-domain fix) — corrected, wired, and live-proofed on both networks

The deployed `CCTPReceiver` (`0x91f1…` mainnet, `0x8066…` testnet) decodes the
wrong offset: it expects a 32-byte length word at BurnMessageV2 body byte 228,
but real CCTP v2 messages have raw hook data starting there. It is abandoned,
not upgraded. The treasury stays at its current address; only the receiver is
replaced.

### New contract
`contracts/src/CCTPReceiverV2.sol` / `ICCTPReceiverV2.sol`
- Constructor: `(initialOwner, transmitter, usdc, treasury)`, Arc-only
  (`ARC_DOMAIN = 26`).
- Normal path: `receiveAndProcess(message, attestation)` is permissionless. It
  validates the full message (domain, `destinationCaller` 0 or receiver,
  `burnToken`, `mintRecipient`, amount, clean 32-byte agent word at byte 376),
  calls `MessageTransmitterV2.receiveMessage`, verifies the USDC balance delta,
  transfers the minted USDC to the treasury, and calls
  `recordDeposit(agent, amount, sourceDomain)` atomically. This records the real
  source domain (e.g. Base `6`), not Arc `26`.
- Replay guard: `processedMessages[keccak256(message)]` is set before external
  calls (CEI).
- Owner fallbacks: `processDeliveredMessage(message)` for a relayer-delivered
  message, `receiveAndRescue(message, attestation, to)` for malformed hookData,
  and `rescueUSDC(to, amount)` for stray USDC. `pause`/`unpause` block the
  normal path only.
- `MockMessageTransmitterV2` + `CCTPReceiverV2.t.sol` cover 23 cases: true
  source domain, a real source-chain `burnToken`, replay, wrong
  domain/caller/mintRecipient, malformed hook, zero amount/agent, owner
  fallbacks, pause, and rescue. The builder uses Base Sepolia USDC as
  `burnToken` so the original live bug cannot regress.

### Frontend
- `src/lib/cctp.ts` parses the real layout (`HEADER_LENGTH = 148`,
  `BODY_FIXED_LENGTH = 228`, hookData at byte `376`), fetches Iris messages,
  resolves outbound status via destination `usedNonces` + `MessageReceived`, and
  falls back across destination RPCs.
- `src/hooks/useCctpWithdrawals.ts` polls every 30s; Activity merges
  `WithdrawalRequested` rows with off-chain status and suppresses duplicate
  fallback rows.
- `CrossChainDepositCard` now burns with
  `depositForBurnWithHook(amount, 26, receiver, USDC, receiver, 0, 2000,
  abi.encode(agent))`, then calls `receiver.receiveAndProcess` once on Arc. It
  branches on the attested message's `mintRecipient`: receiver = new path,
  wallet = legacy wallet-mint + approve + deposit fallback.
- `CctpCompletionCard` uses `resolveCctpWithdrawal` for the destination status
  and mint link; the treasury's legacy `executed` flag is intentionally ignored.

### Deploy page
`scripts/receiver-deploy/` deploys `CCTPReceiverV2` and calls
`treasury.setGatewayReceiver(newReceiver)`. It supports mainnet and testnet,
verifies owner/transmitter/USDC/treasury/domain before wiring, and can wire an
already-deployed receiver without redeploying. Build:
`forge build && node scripts/receiver-deploy/build.mjs`, then serve the folder.
No private key is requested; MetaMask signs.

### Live-test bug (2026-10-22) — corrected receiver deployed on both networks
The first V2 deployments (`0x5477…` mainnet, `0xa0d2…` testnet) compared
`BurnMessageV2.burnToken` to Arc USDC. Real CCTP v2 messages carry the
**source-chain** token there (e.g. Base Sepolia USDC
`0x036CbD53842c5426634e7929541eC2318f3dCF7e`). A live Base Sepolia burn
(`0x8ebbab…afea`) reverted `WrongBurnToken()` (`0x206898e8`). The check is
removed; the minted token is proven by the USDC balance delta in `_receive`.
The corrected testnet receiver `0x344466B00BED1BD5bdFa3E21392E776144323f4c`
and mainnet receiver `0x847F55221F30675791d2fAaf84f93B1fa86399E2` (runtime code
on both has no `206898e8`) are deployed and wired. A burn already bound to a
superseded receiver (`mintRecipient`/`destinationCaller` = that receiver) cannot
be re-routed; start a new burn. The app now shows a specific error for those.

### Status
- `forge test`: 104 passing (23 new + 11 old receiver + 39 treasury + 22
  adapter + 9 invariants; mainnet fork test skipped).
- `vitest`: 63 passing (real-layout parser tests + discard-burn store test + Resume-action gating).
- Typecheck, oxlint, and production builds for both networks pass.
- **Testnet corrected receiver deployed + wired (2026-10-22).** `CCTPReceiverV2`
  is `0x344466B00BED1BD5bdFa3E21392E776144323f4c`; `treasury.gatewayReceiver()`
  is verified on-chain, and the runtime code no longer contains the
  `WrongBurnToken` selector. `TESTNET_ADDRESSES.receiver` points at it. V2 #1
  (`0xa0d2…`) is abandoned.
- **Mainnet corrected receiver deployed + wired (2026-10-22).** `CCTPReceiverV2`
  is `0x847F55221F30675791d2fAaf84f93B1fa86399E2`; deploy block `27315893`, wire
  block `27315906`. On-chain verification: owner, transmitter, USDC, treasury,
  `ARC_DOMAIN = 26`; `treasury.gatewayReceiver()` matches; receiver USDC balance
  `0`; runtime code has no `WrongBurnToken` selector. `MAINNET_ADDRESSES.receiver`
  now points at it. No inbound burn targeted V2 #1; the earlier Base→Arc 5 USDC
  inbound used the legacy mint-to-wallet path and recorded domain 26.
- **Testnet live inbound proof: PASS (2026-10-22).** A 3 USDC Base Sepolia burn
  (`0xf07a1cff21a97fa89bd53fc45c2ae6a967e2887f62a3c609195e94e53f198750`) to
  the corrected receiver was processed atomically on Arc
  (`0x7eabd5bcdd25163fde02e8621f93e840b703cb138d2ea9cf932e29079447d409`):
  `DepositRecorded.sourceDomain = 6`, amount `3000000`, shares
  `2996828265797596427`, receiver balance `0`. The earlier 5 USDC burn
  (`0x8ebbab2f02e04ef6885704f1f0ef3f567f8fdd61b8685f655372d830e84fafea`) was
  bound to superseded V2 #1 and is unrecoverable (testnet only).
- **Mainnet live inbound proof: PASS (2026-10-22).** A 5 USDC Base mainnet burn
  (`0x0b4aa4f9bcaa3f78de7725f17725bb5cc500e752622d7e34fca92936c54da735`) was
  processed atomically by the corrected receiver
  (`0xdd79d20a0cf3c09a9bb85baeb7d0aafdf35fc95cf7f63c5d7c3ff80f0d873b86`):
  `DepositRecorded.sourceDomain = 6`, amount `5000000`, shares
  `4996190411368419803`, receiver and treasury USDC balances `0`. This closes the
  source-domain bug on mainnet without redeploying the treasury.
- **Mainnet outbound id 3 also passed** in the same round trip: burn
  `0x79006af075136d77abb5724fc1124e7ee2b61c8a58ceea3cd943e50423042b13`
  (`4.999999` USDC), Iris `complete`, Base mint
  `0x875d8220284648e79920f3f3603d111cdc4628b43c747cf0f126039cf2118a94`.

## Pre-hotfix Deployment (legacy — do not use for new CCTP tests)

| Contract | Address | Explorer |
|---|---|---|
| MorphoVaultAdapter | `0xe1dafeef6762c672bb5e4a8ff62c3812e111b2e3` | [link](https://explorer.testnet.arc.io/address/0xe1dafeef6762c672bb5e4a8ff62c3812e111b2e3) |
| CCTPReceiver | `0x7697c83c23339ccfdcf2d8e979b26ee5d731e7ee` | [link](https://explorer.testnet.arc.io/address/0x7697c83c23339ccfdcf2d8e979b26ee5d731e7ee) |
| AgentTreasury | `0x9b390bb10bd30a25b5a07dfb9e0a058d7993ae0d` | [link](https://explorer.testnet.arc.io/address/0x9b390bb10bd30a25b5a07dfb9e0a058d7993ae0d) |

Owner/deployer/keeper: `0xD00fD0B006c01342522cAf4FA04D5f8910aB268c`
Wired: true (legacy). Historical record: `deployments/arc-testnet.json`

### Wiring tx hashes (ConfigureTestnet.s.sol broadcast, Oct 2026)
- adapter.setTreasury: `0xc3af3d9611766bf675e3588fa4228f06f10ee61de209b1d5620c5697ed078a99`
- receiver.setTreasury: `0x3b41581af7bf91df36a33f6d995a6bb9c02da3ff032a34e84356ed78cfe64631`
- treasury.setMorphoAdapter: `0x81edc3bc25bfd72e3c98cbfac1868dbac303352d2e6a002763b52a1a79c23500`
- treasury.setGatewayReceiver: `0xf61b4171c499ef67cf1288be6f73d09bfd4517d5932d8fe7a0c2711e573eb377`
- adapter.setKeeper: `0xb5f4ab214a24601013f54a144f47f59aaf76fe5631df8bfbb99dd8eb137ea958`
- treasury.setKeeper: `0x2c41265b2eefd4ac0d1ae82060d9dc1f106393ef330cad07c358b57aa9c96651`
- adapter.addVault(1): `0x2af5b816735d0b6d634b9dfe7dcf64e959bacc2969bb5e38d1f26fe3a617b1a9`
- adapter.setVaultAPY(1): `0xfe621ffd46cf642dd9ce55092ee1b21b2734f3e77dd73c433632004ae38047bb`
- treasury.setDefaultVaultId(1): `0x60dd7ea949764b61d96bbaa04f5996ff470c06ee6482551923aeb2b58fb82dbc`

### Post-wire smoke tests (all PASS)
- treasury.morphoAdapter() == 0xE1DAFEeF6762C672Bb5e4a8fF62c3812e111b2E3
- treasury.gatewayReceiver() == 0x7697C83C23339cCFdCF2d8e979B26EE5d731e7eE
- adapter.getVaultConfig(1): active=true, vault=0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88, minDeposit=10e6
- treasury.paused() == false
- treasury.defaultVaultId() == 1
- treasury.keeper() == 0xD00fD0B006c01342522cAf4FA04D5f8910aB268c
- adapter.vaultAPY(1) == 42000000000000000 (4.2e16, 4.20%)

### APY fixed + E2E verified (Oct 2026)
The original wiring literal `4_200_000_000_000_000` was 4.2e15 (0.42%). It was corrected on-chain to
`42000000000000000` (4.2e16 = 4.20%) via tx `0x36f5c8a7575ebab7a8bdc49bc732a9587e452b10bab7c8b38b1b30e51ba3243e`.
The local `ConfigureTestnet.s.sol` literal is now `42_000_000_000_000_000` for future runs.

Real testnet E2E (owner `0xD00fD0B006c01342522cAf4FA04D5f8910aB268c`):
- deposit 10 USDC: `0xa4fc0034c4f2c20a9f308a705fe1439f281981f6b24466a8aff148f1b5b3a520`
  → principal 10000000, shares 9989427554789604143 (18 dec), previewRedeem 9999999
- withdrawLocal 1 USDC: `0x27cf6628ffb0d1e3ce45f9d542bc065169b3cc98b28c23c8a09d64e50f11b826`
  → principal 9000001, total 9000000, wallet +991307 (rest is gas)
- ERC-4626 rounding leaves a 1-unit difference; withdrawal uses the actual redeemed amount, no stranded dust.

### 18-dec vault shares caveat
The real Morpho/Earn Kit vault issues shares with 18 decimals (not USDC's 6).
`getVaultShares(agent)` returns 18-dec raw units. Frontend uses `formatShares(raw, vaultShareDecimals, 4)`
where `vaultShareDecimals` is read live from `vault.decimals()`. USDC amounts remain 6-dec throughout.

### Remaining TODOs
1. ✅ Mainnet deployed + verified (Oct 21, 2026) — see the mainnet section above.
2. ✅ Mainnet `minDeposit` set to **5 USDC**; zero-share guard shipped in the mainnet adapter.
3. ✅ Mainnet deposit → Galaxy USDC vault → `withdrawLocal` proven live (Oct 21, 2026).
4. ✅ Mainnet CCTP proven live: Arc→Base burns (ids 1–3) with complete production Iris attestations and
   Base mints, plus two Base→Arc 5 USDC burns (legacy path and corrected `CCTPReceiverV2` path). Hashes
   in `deployments/arc-mainnet.json`.
5. Clear the completed withdrawal bookkeeping with keeper `executeWithdrawal(1)`, `(2)`, and `(3)` (ids
   are still `executed=false`; funds are unaffected). The app has no button for this yet.
6. Rotate the keeper role from the owner EOA to a dedicated hot key before scaling volume.
7. Book an external audit before raising the 25/50 USDC spending limits or onboarding third-party agents.
8. Verify contract source on the Arc mainnet explorer.
9. Validate BurnMessageV2 Layout A/B offsets against the live Arc MessageTransmitterV2; `CCTPReceiver`
   is deployed and wired but unused by the current app path.
10. Source-domain accounting for inbound deposits: inbound burns target `CCTPReceiverV2`
    (mintRecipient = destinationCaller = receiver, hookData = abi.encode(agent)), which credits
    `recordDeposit(agent, amount, sourceDomain)` in one Arc tx. **Testnet corrected receiver deployed,
    wired, and live-proofed (2026-10-22); mainnet corrected receiver deployed/wired and live-proofed
    (2026-10-22, `0xdd79d20a…d873b86`, source domain 6).** The earlier mainnet
    Base→Arc 5 USDC inbound used the legacy mint-to-wallet path and recorded domain 26. **Do not
    backfill with owner-signed `recordDeposit`**: it is additive and would double-credit
    `principal`/`totalDeposited` and try to deploy the same USDC again.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected, wallet-agnostic EIP-1193/EIP-6963 (MetaMask, Rabby, Coinbase Wallet, Brave,
  Frame, etc.); never branch on `window.ethereum.isMetaMask`.
- Chain: selected at build time by `VITE_ARC_NETWORK` — **mainnet** (Arc, `5042`) by default,
  `testnet` (`5042002`) for the demo build. Mainnet RPC `https://rpc.mainnet.arc.io`, explorer
  `https://explorer.arc.io`.
- Token: USDC (6 decimals) at `0x3600000000000000000000000000000000000000` on both networks. Arc's
  native gas token is also USDC but with 18 decimals; never mix the two.
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```
