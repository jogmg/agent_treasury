# Agent Treasury

**Cross-chain USDC treasury for AI agents, with automated Morpho yield on Arc.**

Built with [Arc Studio](https://studio.arc.io) · Arc Testnet (chain ID `5042002`)

---

## What it is

AI agents are becoming economic actors, but they have nowhere safe to keep working capital. Agent Treasury gives each agent a non-custodial USDC account on Arc that:

1. **Receives USDC from any CCTP-supported chain** via CCTP v2.
2. **Automatically deploys idle USDC into a Morpho vault** through Circle's Earn Kit rails, earning ~4.2% APY on testnet.
3. **Withdraws to any destination chain** by burning USDC on Arc and minting it on the destination domain.
4. **Enforces per-agent spending limits, pausing, and a two-step owner model** so an agent can operate autonomously without unlimited custody.

The app is a single-page dashboard: Overview, Deposit, Yield, Withdraw, Activity, Settings.

> Testnet-first. Mainnet deployment is intentionally gated on a funded deployer; see [Mainnet status](#mainnet-status).

---

## Live contracts (Arc Testnet)

| Contract | Address |
|---|---|
| AgentTreasury | [`0x5e2e3da19533ebf85bc916612eff5cdc7bf4d489`](https://explorer.testnet.arc.io/address/0x5e2e3da19533ebf85bc916612eff5cdc7bf4d489) |
| MorphoVaultAdapter | [`0x333deccbf9091540e849b7af80f2f10b72197b71`](https://explorer.testnet.arc.io/address/0x333deccbf9091540e849b7af80f2f10b72197b71) |
| CCTPReceiver | [`0x8066bcf8e6b17e2d84082179a89f0972cc6e31c1`](https://explorer.testnet.arc.io/address/0x8066bcf8e6b17e2d84082179a89f0972cc6e31c1) |

Deployment block: `68193025`. Owner and keeper: `0xD00fD0B006c01342522cAf4FA04D5f8910aB268c`. Full record: `deployments/arc-testnet-fixed.json`.

Protocol constants (testnet and mainnet share the same CCTP contracts and domain):

| Item | Value |
|---|---|
| USDC (ERC-20, 6 decimals) | `0x3600000000000000000000000000000000000000` |
| TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| CCTP domain | `26` |
| Morpho Earn Kit USDC vault | `0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88` |
| RPC / Explorer | `https://rpc.testnet.arc.io` / `https://explorer.testnet.arc.io` |

> **Status: CCTP hotfix deployed and E2E verified on testnet.** The new stack is fully wired: adapter, receiver, vault 1, keeper, and default vault are live. A real 10 USDC deposit and real CCTP withdrawals from yield have succeeded. The burn produced a finalized Circle attestation for destination domain `0` (Ethereum Sepolia). The app now polls Iris automatically, shows the attestation, and submits the destination mint after the user switches networks and approves the transaction. That final mint still needs a little destination-chain gas. Full record: `deployments/arc-testnet-fixed.json`.

### CCTP hotfix

The original treasury (`0x9b390bb10bd30a25b5a07dfb9e0a058d7993ae0d`) burned successfully but reverted while ABI-decoding the return value of `depositForBurnWithHook`. Arc's TokenMessengerV2 returns **no data**, while the original interface declared `returns (uint64)`. The whole withdrawal rolled back after the burn. The fixed interface returns nothing, and `CCTP_MIN_FINALITY_THRESHOLD` is `2000` for reliable Arc-origin attestations.

### On-chain proof (Arc Testnet)

| Action | Transaction | Result |
|---|---|---|
| Approve 10 USDC | [`0x158ed904…69fe`](https://explorer.testnet.arc.io/tx/0x158ed9048899e22ef6d087bdd2489cf70a215ae6b6ca602e6828e997a2df69fe) | USDC allowance to the new treasury |
| Deposit 10 USDC | [`0xbab58770…04c4`](https://explorer.testnet.arc.io/tx/0xbab5877074904d17fb21b49aed8c3d2a956ee8d16d3ddc3ec523046d464a04c4) | balance `9,999,999`; 18-dec vault shares `9,989,427,554,595,819,468` |
| CCTP withdraw 1 USDC to domain 0 | [`0x3f0f2568…8a1c`](https://explorer.testnet.arc.io/tx/0x3f0f256843ee4e1498cafceea9978725397904899bb527f684eb98c171e28a1c) | withdrawal id `1`; burned `999,999`; `MessageSent` finality `2000`; balance `9,000,000` |

Circle Iris returned `status: complete` with `finalityThresholdExecuted: 2000` and `mintRecipient` set to the connected wallet. The one-unit difference between the requested `1,000,000` and burned `999,999` is ERC-4626 share rounding; the withdrawal path uses the actual redeemed amount, so no dust is stranded.

The pre-hotfix stack is still on-chain, but the legacy recovery card has been retired from the UI (no user funds remain in it for this wallet). If funds ever appear there again, any wallet holding the owner key can call `withdrawLocal` on the legacy treasury directly (address in the table below).

### Completing a pending transfer

The Withdraw tab does this automatically after a burn:

1. Polls Circle Iris for the attestation.
2. Shows **Attestation ready** with the destination chain and amount.
3. Switches to the destination chain and submits `receiveMessage` from the connected wallet.

The destination mint is a transaction on the destination chain, so its gas token is required there. If the app is opened later, use **Recent CCTP requests**, the Activity tab's **In flight** filter, or paste the Arc burn tx hash in the advanced CCTP section to resume. Requests that already minted are hidden from Recent (they now live in the Activity tab).

The script remains available for headless/CLI recovery:

```bash
npx tsx scripts/complete-cctp.ts 0x3f0f256843ee4e1498cafceea9978725397904899bb527f684eb98c171e28a1c
# or, with a funded key:
SEPOLIA_RPC_URL=... PRIVATE_KEY=... npx tsx scripts/complete-cctp.ts 0x3f0f... --send
# Bun is equivalent: bun scripts/complete-cctp.ts 0x3f0f... --send
```

---

## Architecture

```
Source chain                         Arc Testnet                              Destination chain
────────────                         ───────────                              ─────────────────
User / agent ── approve ──┐
                          ▼
                 TokenMessengerV2 ── CCTP v2 burn ──► MessageTransmitterV2
                                                          │
                                                          ▼
                                                   TokenMessengerV2
                                                          │ mint
                                                          ▼
                                                   user's Arc wallet
                                                          │ approve + deposit()
                                                          ▼
   ┌──────────────────────────────────────────── AgentTreasury ────────────────────────────────────────────┐
   │  per-agent accounting: principal, deployedPrincipal, vaultShares, chainDeposits, spending windows     │
   │                                                                                                        │
   │  deposit() ─────────────────────► MorphoVaultAdapter ──► Morpho ERC-4626 vault (Earn Kit)              │
   │  withdrawLocal() ──────────────► adapter.withdraw ──► USDC to agent wallet (Arc fast path)            │
   │  requestWithdrawal() ──────────► adapter.withdraw ──► TokenMessengerV2.depositForBurnWithHook ──► ...  │
   └────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

> CCTP v2 `hookData` is **opaque metadata**. The core MessageTransmitter does not
> execute arbitrary receiver logic; it calls the destination TokenMessenger,
> which mints to `mintRecipient`. The app therefore uses the direct path above:
> mint to the connected Arc wallet, then call `deposit()`. `CCTPReceiver` remains
> a relayer adapter for source-domain accounting, but the app does not depend on
> automatic hook execution.

### Contracts

- **`AgentTreasury.sol`** — per-agent accounts. Holds principal, deployed principal, vault shares, per-domain deposits, daily/weekly spending windows, pending CCTP withdrawals, keeper role, pause, two-step ownership. `getTotalBalance()` is non-reverting: it falls back to principal if the vault preview fails.
- **`MorphoVaultAdapter.sol`** — allowlisted ERC-4626 vault registry with per-vault min deposits, APY cache, and `previewRedeem`. Only the treasury (or owner) can move funds.
- **`CCTPReceiver.sol`** — relayer adapter for inbound CCTP. It decodes the agent from `hookData`, routes malformed hook data to a default beneficiary instead of reverting, and forwards USDC into the treasury. It is unit-tested but **not used by the current app**, because CCTP v2 hooks are opaque and require an integrator-run relayer. The direct app path mints to the user's Arc wallet and calls `deposit()`.
- **`libraries/CCTPMessageLib.sol`** — hook data encode/decode.
- **`libraries/Errors.sol`** — custom errors.

### App

- React 18 + Vite + TypeScript + Tailwind, wagmi v2 + viem + ConnectKit.
- TanStack Query owns on-chain freshness (10s polling); Zustand owns cross-component state and wizard flow, with a documented Query→Zustand bridge.
- No backend and no server-held keys. Reads go directly to the Arc RPC; writes are signed by the user's wallet.
- Activity is reconstructed from treasury event logs in 9,000-block chunks.

---

## Quick start

```bash
bun install
bun run dev          # http://localhost:5173
bun run build        # production build
bun run test         # Vitest (52 tests)
bun run check        # lint + typecheck
```

Contracts (Foundry). The Solidity dependencies are not vendored, so install them once:

```bash
cd contracts
forge install foundry-rs/forge-std --no-commit
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-commit
forge build
forge test           # 80 tests
```

Environment overrides (optional; sensible testnet fallbacks are compiled in):

```bash
VITE_TREASURY_ADDRESS=0x...
VITE_ADAPTER_ADDRESS=0x...
VITE_RECEIVER_ADDRESS=0x...
VITE_USDC_ADDRESS=0x...
VITE_TREASURY_DEPLOY_BLOCK=68193025
```

Fresh hotfix deployment (deploys and wires all three contracts, then starts the
Ownable2Step handoff):

```bash
cd contracts
forge script script/DeployFixedTestnet.s.sol \
  --rpc-url https://rpc.testnet.arc.io \
  --broadcast \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  -vv
```

Required env: `DEPLOYER_ADDRESS`, `FINAL_OWNER_ADDRESS`, `ARC_USDC`,
`ARC_TOKEN_MESSENGER`, `ARC_MESSAGE_TRANSMITTER`, `ARC_CCTP_DOMAIN`, and
`VAULT_1_ADDRESS`. See `docs/RUNBOOK.md`.

See `docs/RUNBOOK.md` for the exact env vars and smoke tests.

---

## Demo flow (testnet)

1. Connect a wallet on Arc Testnet; get USDC from https://faucet.circle.com.
2. **Deposit** 10+ USDC. The app approves USDC, calls `deposit()`, and the treasury deploys it into the Morpho vault; the dashboard shows shares, APY, and yield.
3. **Yield** tab: live APY/TVL from the adapter, compound projection, local growth chart with 24h/7d/30d/All time ranges.
4. **Withdraw** 25/50/75/MAX via `withdrawLocal()`; USDC lands in the wallet.
5. **Activity**: decoded `DepositRecorded`, `WithdrawalToWallet`, `YieldStrategyChanged`, etc., with explorer links and CSV export.
6. **Settings**: set daily/weekly spending limits; inspect owner/keeper/pause.

Cross-chain **inbound** deposits are in the Deposit tab. Pick a source chain, approve and burn USDC with CCTP v2, then the app polls Iris, switches to Arc, mints to the connected wallet, approves the treasury, and calls `deposit()`. Standard CCTP takes 15–30 minutes and needs a little Arc gas for the final transactions.

Cross-chain **outbound** (`requestWithdrawal`) is available in the Withdraw tab (Advanced: Cross-Chain Withdrawal). Destination is picked by **chain name in a dropdown** (Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, OP Sepolia, Avalanche Fuji, Polygon Amoy). It burns via CCTP v2 and then the app fetches the Circle attestation automatically. When the attestation is ready, the app switches to the destination chain and asks for one wallet confirmation to submit `receiveMessage`; the final mint needs destination-chain gas. There is no request list in this section (transfers live in the Activity tab); pasting an Arc burn tx hash resumes an older transfer. `scripts/complete-cctp.ts` is the headless fallback.

The Activity tab groups activity with **All / In flight / Deposits / Withdrawals / Yield** filters. Every row — chain event or in-flight transfer — renders through the same uniform row UI with a kind badge: **CCTP Deposit** (inbound cross-chain), **CCTP Withdrawal** (outbound burn), **Local Withdraw**, **Deposit**, **Yield**, etc. The **In flight** filter (with a live count) lists every cross-chain CCTP transfer still in progress, inbound and outbound, with the burn tx hash, chains, amount, status, and a Resume CTA (completed transfers show no CTA). In-flight transfers are persisted in the browser (`localStorage`), so a page reload never loses them — unlike chain events, they exist until the mint/deposit lands on Arc — and the unfinished ones also appear at the top of the **All** view.

---

## What is real vs. scaffolded

| Capability | Status |
|---|---|
| Per-agent treasury, spending limits, pause, keeper separation | ✅ implemented + tested |
| Morpho/Earn Kit vault deposit, redeem, strategy switch | ✅ implemented + tested (mock vaults) |
| CCTP v2 outbound burn with hook data | ✅ implemented, unit-tested, and verified live on Arc Testnet (domain 0 burn + finalized attestation) |
| CCTP v2 **inbound deposit** (source burn → mint to Arc wallet → `deposit()`) | ✅ implemented in the app; requires source USDC + source gas + Arc gas |
| CCTPReceiver relayer adapter + malformed-data fallback | ✅ unit-tested; ⚠️ not used by the app (CCTP v2 hooks are opaque; a relayer/forwarder is required) |
| Arc-local fast path (`deposit`, `withdrawLocal`) | ✅ implemented + tested |
| Dashboard, 6 tabs, event history, CSV export | ✅ built, lint/typecheck clean |
| Testnet deployment | ✅ deployed, wired, and E2E verified with real testnet USDC |
| Circle Gateway unified balance | ⚠️ contract hook (`gatewayReceiver`) is present; live Gateway balances need a server-side API key and are intentionally not faked in the UI |
| Automatic Iris attestation + in-app destination mint | ✅ implemented: poll Iris, switch chain, submit `receiveMessage`; destination gas required |
| Mainnet deployment | ⛔ not done; needs a funded mainnet deployer (real USDC) |

---

## Mainnet status

Mainnet is **not** deployed. The brief requires real USDC movement on Arc mainnet, which needs a deployer funded with real USDC for gas. The same `ArcConfig.sol` already contains mainnet RPC/chain ID/domain and the shared CCTP addresses; the only missing inputs are:

- a funded mainnet deployer key,
- a mainnet Morpho vault address (`TBD_MAINNET_VAULT` in `contracts/script/ArcConfig.sol`).

Do not point the app at mainnet until both are resolved and the testnet rehearsal has passed.

---

## Security notes

- Contracts are **unaudited**. Testnet only. Do not custody real funds.
- Keeper can rebalance, execute withdrawal bookkeeping, and set message hashes — it **cannot** initiate withdrawals or change spending limits (agent/owner only).
- Spending limits are enforced on the resolved withdrawal amount, including `type(uint256).max`.
- `getTotalBalance()` never reverts; a failing vault preview falls back to principal.
- Hook data is decoded tolerantly; malformed payloads route to the default beneficiary instead of bricking the mint.
- Frontend has no backend and no secrets. Never commit a private key.

See `docs/SECURITY.md` for the full threat model and known gaps.

---

## Repository layout

```
.
├── contracts/
│   ├── src/                 # AgentTreasury, MorphoVaultAdapter, CCTPReceiver, interfaces, libraries
│   ├── test/                # 80 Foundry tests + mocks
│   └── script/              # ArcConfig, Deploy/Configure, testnet scripts
├── src/
│   ├── components/          # Header, StatCard, TxStep, EventRow, 6 tab panels
│   ├── hooks/               # Query→Zustand bridge, activity
│   ├── lib/                 # contracts/ABIs, decimals, activity, errors
│   └── stores/              # treasury, flow, ui
├── deployments/             # arc-testnet.json (addresses, tx hashes, smoke tests)
├── docs/                    # architecture, runbook, security, demo
└── SUBMISSION.md            # hackathon submission copy
```

---

## License

MIT
