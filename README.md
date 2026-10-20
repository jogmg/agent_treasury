# Agent Treasury

**Cross-chain USDC treasury for AI agents, with automated Morpho yield on Arc.**

Built with [Arc Studio](https://studio.arc.io) · Arc Testnet (chain ID `5042002`)

---

## What it is

AI agents are becoming economic actors, but they have nowhere safe to keep working capital. Agent Treasury gives each agent a non-custodial USDC account on Arc that:

1. **Receives USDC from any CCTP-supported chain** via CCTP v2 Fast Transfer.
2. **Automatically deploys idle USDC into a Morpho vault** through Circle's Earn Kit rails, earning ~4.2% APY on testnet.
3. **Withdraws to any destination chain** by burning USDC on Arc and minting it on the destination domain.
4. **Enforces per-agent spending limits, pausing, and a two-step owner model** so an agent can operate autonomously without unlimited custody.

The app is a single-page dashboard: Overview, Deposit, Yield, Withdraw, Activity, Settings.

> Testnet-first. Mainnet deployment is intentionally gated on a funded deployer; see [Mainnet status](#mainnet-status).

---

## Live contracts (Arc Testnet)

| Contract | Address |
|---|---|
| AgentTreasury | [`0x9b390bb10bd30a25b5a07dfb9e0a058d7993ae0d`](https://explorer.testnet.arc.io/address/0x9b390bb10bd30a25b5a07dfb9e0a058d7993ae0d) |
| MorphoVaultAdapter | [`0xe1dafeef6762c672bb5e4a8ff62c3812e111b2e3`](https://explorer.testnet.arc.io/address/0xe1dafeef6762c672bb5e4a8ff62c3812e111b2e3) |
| CCTPReceiver | [`0x7697c83c23339ccfdcf2d8e979b26ee5d731e7ee`](https://explorer.testnet.arc.io/address/0x7697c83c23339ccfdcf2d8e979b26ee5d731e7ee) |

Protocol constants (testnet and mainnet share the same CCTP contracts and domain):

| Item | Value |
|---|---|
| USDC (ERC-20, 6 decimals) | `0x3600000000000000000000000000000000000000` |
| TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| CCTP domain | `26` |
| Morpho Earn Kit USDC vault | `0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88` |
| RPC / Explorer | `https://rpc.testnet.arc.io` / `https://explorer.testnet.arc.io` |

> **Status: wired and E2E verified on testnet.** The owner `0xD00fD0B006c01342522cAf4FA04D5f8910aB268c` broadcast the 9 wiring transactions; the adapter, receiver, vault, keeper, and default vault are live. A real 10 USDC deposit and a real 1 USDC withdrawal both settled against the Morpho Earn Kit vault. Full record: `deployments/arc-testnet.json`.

### On-chain proof (Arc Testnet)

| Action | Transaction | Result |
|---|---|---|
| Deposit 10 USDC | [`0xa4fc0034…3a520`](https://explorer.testnet.arc.io/tx/0xa4fc0034c4f2c20a9f308a705fe1439f281981f6b24466a8aff148f1b5b3a520) | 10,000,000 principal → 9,989,427,554,789,604,143 shares (18 dec), `previewRedeem` = 9,999,999 |
| Withdraw 1 USDC | [`0x27cf6628…1b826`](https://explorer.testnet.arc.io/tx/0x27cf6628ffb0d1e3ce45f9d542bc065169b3cc98b28c23c8a09d64e50f11b826) | principal 9,000,001, total 9,000,000, wallet +991,307 (rest is gas) |
| APY corrected to 4.2% | [`0x36f5c8a7…3243e`](https://explorer.testnet.arc.io/tx/0x36f5c8a7575ebab7a8bdc49bc732a9587e452b10bab7c8b38b1b30e51ba3243e) | `vaultAPY(1) = 42000000000000000` |

The one-unit difference between `principal` and `previewRedeem` is ERC-4626 rounding — the withdrawal path uses the actual redeemed amount, so no dust is stranded.

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
                                                   CCTPReceiver
                                                          │ recordDeposit
                                                          ▼
   ┌──────────────────────────────────────────── AgentTreasury ────────────────────────────────────────────┐
   │  per-agent accounting: principal, deployedPrincipal, vaultShares, chainDeposits, spending windows     │
   │                                                                                                        │
   │  deposit() / recordDeposit() ──► MorphoVaultAdapter ──► Morpho ERC-4626 vault (Earn Kit)              │
   │  withdrawLocal() ──────────────► adapter.withdraw ──► USDC to agent wallet (Arc fast path)            │
   │  requestWithdrawal() ──────────► adapter.withdraw ──► TokenMessengerV2.depositForBurnWithHook ──► ...  │
   └────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Contracts

- **`AgentTreasury.sol`** — per-agent accounts. Holds principal, deployed principal, vault shares, per-domain deposits, daily/weekly spending windows, pending CCTP withdrawals, keeper role, pause, two-step ownership. `getTotalBalance()` is non-reverting: it falls back to principal if the vault preview fails.
- **`MorphoVaultAdapter.sol`** — allowlisted ERC-4626 vault registry with per-vault min deposits, APY cache, and `previewRedeem`. Only the treasury (or owner) can move funds.
- **`CCTPReceiver.sol`** — CCTP v2 hook receiver. Decodes the agent from `hookData`, routes malformed hook data to a default beneficiary instead of reverting, and forwards minted USDC into the treasury.
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
bun run test         # Vitest (36 tests)
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
```

Deploy / wire:

```bash
cd contracts
forge script script/DeployTestnet.s.sol --rpc-url https://rpc.testnet.arc.io --broadcast
forge script script/ConfigureTestnet.s.sol --rpc-url https://rpc.testnet.arc.io --broadcast
```

See `docs/RUNBOOK.md` for the exact env vars and smoke tests.

---

## Demo flow (testnet)

1. Connect a wallet on Arc Testnet; get USDC from https://faucet.circle.com.
2. **Deposit** 10+ USDC. The app approves USDC, calls `deposit()`, and the treasury deploys it into the Morpho vault; the dashboard shows shares, APY, and yield.
3. **Yield** tab: live APY/TVL from the adapter, compound projection, local growth chart.
4. **Withdraw** 25/50/75/MAX via `withdrawLocal()`; USDC lands in the wallet.
5. **Activity**: decoded `DepositRecorded`, `WithdrawalToWallet`, `YieldStrategyChanged`, etc., with explorer links and CSV export.
6. **Settings**: set daily/weekly spending limits; inspect owner/keeper/pause.

Cross-chain outbound (`requestWithdrawal`) is available in the Withdraw tab's advanced section. It burns via CCTP v2 and links to the Iris attestation; the destination mint is a manual relay in this build.

---

## What is real vs. scaffolded

| Capability | Status |
|---|---|
| Per-agent treasury, spending limits, pause, keeper separation | ✅ implemented + tested |
| Morpho/Earn Kit vault deposit, redeem, strategy switch | ✅ implemented + tested (mock vaults) |
| CCTP v2 outbound burn with hook data | ✅ implemented + tested (mock messenger) |
| CCTP v2 inbound hook receiver + malformed-data fallback | ✅ implemented + tested |
| Arc-local fast path (`deposit`, `withdrawLocal`) | ✅ implemented + tested |
| Dashboard, 6 tabs, event history, CSV export | ✅ built, lint/typecheck clean |
| Testnet deployment | ✅ deployed, wired, and E2E verified with real testnet USDC |
| Circle Gateway unified balance | ⚠️ contract hook (`gatewayReceiver`) is present; live Gateway balances need a server-side API key and are intentionally not faked in the UI |
| Automatic Iris relay on the destination chain | ⚠️ manual relay in this build; attestation link is surfaced |
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
