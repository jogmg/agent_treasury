# Agent Treasury

**Cross-chain USDC treasury for AI agents, with automated Morpho yield on Arc.**

Built with [Arc Studio](https://studio.arc.io) · Arc Mainnet (chain ID `5042`)

---

## What it is

AI agents are becoming economic actors, but they have nowhere safe to keep working capital. Agent Treasury gives each agent a non-custodial USDC account on Arc that:

1. **Receives USDC from any CCTP-supported chain** via CCTP v2.
2. **Automatically deploys idle USDC into a Morpho vault** through Circle's Earn Kit rails, earning ~2.65% net APY on Arc mainnet.
3. **Withdraws to any destination chain** by burning USDC on Arc and minting it on the destination domain.
4. **Enforces per-agent spending limits, pausing, and a two-step owner model** so an agent can operate autonomously without unlimited custody.

The app is a single-page dashboard: Overview, Deposit, Yield, Withdraw, Activity, Settings.

> **Live on Arc mainnet, with guardrails.** The contracts are unaudited, so the launch caps are deliberately
> small: a 5 USDC vault minimum and a 25 USDC/day, 50 USDC/week spending limit for the owner agent.
> The same codebase builds for testnet with `VITE_ARC_NETWORK=testnet`.

---

## Live contracts (Arc Mainnet)

| Contract | Address |
|---|---|
| AgentTreasury | [`0xf71b5d1a19d72b98675785123fae811698be6f63`](https://explorer.arc.io/address/0xf71b5d1a19d72b98675785123fae811698be6f63) |
| MorphoVaultAdapter | [`0x5102057330f5bb5f3e4eb0925b7d1eac8a563c23`](https://explorer.arc.io/address/0x5102057330f5bb5f3e4eb0925b7d1eac8a563c23) |
| CCTPReceiver | [`0x91f1eb97a40fdab05d150c10566cf9aa3546a375`](https://explorer.arc.io/address/0x91f1eb97a40fdab05d150c10566cf9aa3546a375) |

Vault 1 is **Galaxy USDC** [`0x8E357432CC12ff425c36432F312968aEb16112AF`](https://explorer.arc.io/address/0x8E357432CC12ff425c36432F312968aEb16112AF)
(`arcUSDC`, 18-dec shares, ~2.65% net APY, 0 fees, ~12.2M USDC instant liquidity). Fallback:
Steakhouse Prime `0xbeef0016cb2Fd5C352ea7CA08a9f54739DFa7298` (~1.97% APY).

Deployment blocks: adapter `27153175`, treasury `27153209`. Owner and keeper:
`0xD00fD0B006c01342522cAf4FA04D5f8910aB268c`. Full record: `deployments/arc-mainnet.json`.

**Launch guardrails (unaudited):**

- Vault minimum **5 USDC** (enforced on-chain; derived from share price and gas-versus-yield economics).
- Spending limit **25 USDC/day, 50 USDC/week** for the owner agent.
- Keeper is the owner EOA for launch; rotate to a dedicated key before scaling.
- External audit before raising caps or onboarding third-party agents.
- A live mainnet **5 USDC deposit + 1 USDC local withdrawal** passed on October 21, 2026 (deposit
  `0xf48c28…0225`, withdraw `0x5caf81…76b0`).
- Mainnet **CCTP round trip** also passed: two Arc→Base withdrawals were attested and minted, then
  5 USDC was burned on Base, minted on Arc, and deposited into Galaxy USDC.

Protocol constants (the CCTP deployments differ between networks):

| Item | Arc Mainnet | Arc Testnet |
|---|---|---|
| USDC (ERC-20, 6 decimals) | `0x3600000000000000000000000000000000000000` | same |
| TokenMessengerV2 | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| MessageTransmitterV2 | `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| CCTP domain | `26` | `26` |
| RPC / Explorer | `https://rpc.mainnet.arc.io` / `https://explorer.arc.io` | `https://rpc.testnet.arc.io` / `https://explorer.testnet.arc.io` |

The app selects network at build time (`VITE_ARC_NETWORK`, default `mainnet`), including the CCTP
destination map, Iris endpoint, explorer, and RPC list.

### Testnet deployment (still live)

| Contract | Address |
|---|---|
| AgentTreasury | [`0x5e2e3da19533ebf85bc916612eff5cdc7bf4d489`](https://explorer.testnet.arc.io/address/0x5e2e3da19533ebf85bc916612eff5cdc7bf4d489) |
| MorphoVaultAdapter | [`0x333deccbf9091540e849b7af80f2f10b72197b71`](https://explorer.testnet.arc.io/address/0x333deccbf9091540e849b7af80f2f10b72197b71) |
| CCTPReceiver | [`0x8066bcf8e6b17e2d84082179a89f0972cc6e31c1`](https://explorer.testnet.arc.io/address/0x8066bcf8e6b17e2d84082179a89f0972cc6e31c1) |

Deployment block `68193025`. Full record and E2E proof: `deployments/arc-testnet-fixed.json`.
Build it with `VITE_ARC_NETWORK=testnet`; it keeps the 1 USDC demo minimum and the ~4.2% APY vault
`0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88`.

### CCTP hotfix (testnet history)

The mainnet deployment uses the fixed no-return interface from day one. This is the testnet incident that produced it: the original treasury (`0x9b390bb10bd30a25b5a07dfb9e0a058d7993ae0d`) burned successfully but reverted while ABI-decoding the return value of `depositForBurnWithHook`. Arc's TokenMessengerV2 returns **no data**, while the original interface declared `returns (uint64)`. The whole withdrawal rolled back after the burn. The fixed interface returns nothing, and `CCTP_MIN_FINALITY_THRESHOLD` is `2000` for reliable Arc-origin attestations.

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
Source chain                         Arc                                      Destination chain
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
- **`MorphoVaultAdapter.sol`** — allowlisted ERC-4626 vault registry with per-vault min deposits, APY cache, `previewRedeem`, and a `ZeroShares` guard. Only the treasury (or owner) can move funds.
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
bun run dev          # http://localhost:5173 — Arc mainnet by default
bun run build        # production build (mainnet)
bun run test         # Vitest (52 tests)
bun run check        # lint + typecheck

VITE_ARC_NETWORK=testnet bun run dev   # testnet demo build
```

Contracts (Foundry). The Solidity dependencies are not vendored, so install them once:

```bash
cd contracts
forge install foundry-rs/forge-std --no-commit
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-commit
forge build
forge test           # 81 tests
```

The app selects its whole chain surface at build time. Optional overrides:

```bash
VITE_ARC_NETWORK=mainnet        # or testnet; default mainnet
VITE_TREASURY_ADDRESS=0x...
VITE_ADAPTER_ADDRESS=0x...
VITE_RECEIVER_ADDRESS=0x...
VITE_VAULT_ADDRESS=0x...
VITE_USDC_ADDRESS=0x...
VITE_TREASURY_DEPLOY_BLOCK=27153175
```

Mainnet deployment uses the guarded Foundry script (refuses wrong chain, missing code, a
non-USDC vault, or a minimum that would mint zero shares):

```bash
cd contracts
DEPLOYER_ADDRESS=0x... FINAL_OWNER_ADDRESS=0x... \
forge script script/DeployMainnet.s.sol \
  --rpc-url https://rpc.mainnet.arc.io \
  --broadcast \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  -vv
```

Default guardrails: `MIN_DEPOSIT=5000000` (5 USDC), `DAILY_LIMIT=25000000`,
`WEEKLY_LIMIT=50000000`. The live deployment was signed by the owner's MetaMask through
`scripts/mainnet-deploy/`; no key was stored in the repo. See `docs/RUNBOOK.md` for verification.

See `docs/RUNBOOK.md` for the exact env vars and smoke tests.

---

## Demo flow

1. Connect a wallet on Arc mainnet and fund it with USDC on Arc. For the testnet build, get USDC from https://faucet.circle.com (select **Arc Testnet**).
2. **Deposit** at least **5 USDC on mainnet** (1 USDC on testnet). The app approves USDC, calls `deposit()`, and the treasury deploys it into the Morpho vault; the dashboard shows shares, APY, and yield.
3. **Yield** tab: live APY/TVL from the adapter, compound projection, local growth chart with 24h/7d/30d/All time ranges.
4. **Withdraw** 25/50/75/MAX via `withdrawLocal()`; USDC lands in the wallet.
5. **Activity**: decoded `DepositRecorded`, `WithdrawalToWallet`, `YieldStrategyChanged`, etc., with explorer links and CSV export.
6. **Settings**: set daily/weekly spending limits; inspect owner/keeper/pause.

Cross-chain **inbound** deposits are in the Deposit tab. Pick a source chain, approve and burn USDC with CCTP v2, then the app polls Iris, switches to Arc, mints to the connected wallet, approves the treasury, and calls `deposit()`. Standard CCTP takes 15–30 minutes and needs a little Arc gas for the final transactions. On mainnet the source list is Ethereum, Avalanche, Optimism, Arbitrum, Base, and Polygon, and Iris is Circle's production API.

Cross-chain **outbound** (`requestWithdrawal`) is available in the Withdraw tab (Advanced: Cross-Chain Withdrawal). Destination is picked by **chain name in a dropdown** (mainnet: Ethereum, Avalanche, Optimism, Arbitrum, Base, Polygon; testnet: the Sepolia/Fuji/Amoy equivalents). It burns via CCTP v2 and then the app fetches the Circle attestation automatically. When the attestation is ready, the app switches to the destination chain and asks for one wallet confirmation to submit `receiveMessage`; the final mint needs destination-chain gas. There is no request list in this section (transfers live in the Activity tab); pasting an Arc burn tx hash resumes an older transfer. `scripts/complete-cctp.ts` is the headless fallback.

The Activity tab groups activity with **All / In flight / Deposits / Withdrawals / Yield** filters. Every row — chain event or in-flight transfer — renders through the same uniform row UI with a kind badge: **CCTP Deposit** (inbound cross-chain), **CCTP Withdrawal** (outbound burn), **Local Withdraw**, **Deposit**, **Yield**, etc. Row lists are sorted most-recent first: chain events are enriched with their block timestamps (cached and interpolated during log scans), and every row's expandable panel shows the date and time alongside the tx links (chain events additionally keep "Block N"). The **In flight** filter (with a live count) lists every cross-chain CCTP transfer still in progress, inbound and outbound, with the burn tx hash, chains, amount, status, and a Resume CTA (completed transfers show no CTA). In-flight transfers are persisted in the browser (`localStorage`), so a page reload never loses them — unlike chain events, they exist until the mint/deposit lands on Arc.

---

## What is real vs. scaffolded

| Capability | Status |
|---|---|
| Per-agent treasury, spending limits, pause, keeper separation | ✅ implemented + tested |
| Morpho/Earn Kit vault deposit, redeem, strategy switch | ✅ implemented + tested; live on testnet and on mainnet with Galaxy USDC (5 USDC deposit, 1 USDC local withdrawal) |
| CCTP v2 outbound burn with hook data | ✅ implemented, unit-tested, and verified live on both networks (mainnet Arc→Base burns ids 1–2, complete Iris attestations, Base mints) |
| CCTP v2 **inbound deposit** (source burn → mint to Arc wallet → `deposit()`) | ✅ implemented and verified live (Base→Arc 5 USDC burn, Arc mint, Galaxy USDC deposit); requires source USDC + source gas + Arc gas |
| CCTPReceiver relayer adapter + malformed-data fallback | ✅ unit-tested; ⚠️ not used by the app (CCTP v2 hooks are opaque; a relayer/forwarder is required) |
| Arc-local fast path (`deposit`, `withdrawLocal`) | ✅ implemented + tested |
| Dashboard, 6 tabs, event history, CSV export | ✅ built, lint/typecheck clean |
| Testnet deployment | ✅ deployed, wired, and E2E verified with real testnet USDC |
| Mainnet deployment | ✅ deployed, wired, and E2E verified: local deposit/withdraw plus a full CCTP round trip (Arc→Base withdrawals, Base→Arc deposit) |
| Circle Gateway unified balance | ⚠️ contract hook (`gatewayReceiver`) is present; live Gateway balances need a server-side API key and are intentionally not faked in the UI |
| Automatic Iris attestation + in-app destination mint | ✅ implemented: poll Iris, switch chain, submit `receiveMessage`; destination gas required |

---

## Mainnet status

Mainnet was deployed on **October 21, 2026** and is fully wired. Independent on-chain verification confirmed:

- bytecode at all three contracts and at the vault,
- owner/keeper, `morphoAdapter`, `gatewayReceiver`, adapter/receiver treasury links,
- mainnet CCTP contracts and domain `26`,
- `defaultVaultId == 1`, both contracts unpaused,
- vault `asset() == USDC`, active, `minDeposit == 5_000_000`, APY `2.65%`,
- `previewDeposit(5 USDC) > 0` and `previewMint(1 wei) >= 1` (no zero-share minimum).

A live mainnet **5 USDC deposit → 1 USDC `withdrawLocal`** passed on October 21, 2026. The deposit
minted `4,996,584,486,017,754,953` Galaxy USDC shares; the withdrawal resolved to `0.999999` USDC
and burned `999,316,858,421,847,964` shares (ERC-4626 rounding).

A full mainnet **CCTP round trip** followed:

- **Arc→Base withdrawal 1:** burn `0xbfcdbe…5ccd`, 1.999999 USDC, complete Iris attestation,
  Base mint `0x58c3eb…59fa`.
- **Arc→Base withdrawal 2:** burn `0x971d10…ad76`, 4.999999 USDC, complete Iris attestation,
  Base mint `0x68045f…7609`.
- **Base→Arc deposit:** burn `0xadf19a…b280` for 5 USDC; Arc `receiveMessage` `0xb2a7ba…246c`
  minted it, then `deposit()` `0xb1e34e…026b` added `4,996,555,771,054,222,485` Galaxy USDC shares.

Post-state: principal `9.000003`, shares `8,993,822,921,076,662,356`, `getTotalBalance` `9.000028`
USDC. All hashes, nonces, and timestamps are in `deployments/arc-mainnet.json` (`liveCctpE2E`).
The exact 10-transaction deploy sequence was rehearsed first on a live Arc mainnet fork
(`contracts/test/fork/MainnetDeploy.t.sol`).

One bookkeeping follow-up: the two completed withdrawal requests are still `executed=false`
on-chain. The app has no execute action yet; a keeper call to `executeWithdrawal(1)` and
`executeWithdrawal(2)` clears them (funds are unaffected).

**Audit plan:** the contracts are unaudited, so mainnet runs with deliberately low caps and only the
owner's funds. Before raising the limits or onboarding third-party agents: external review of
`AgentTreasury`, `MorphoVaultAdapter`, and the CCTP accounting path, then a multisig/timelock owner
and a dedicated keeper key.

---

## Security notes

- Contracts are **unaudited**. Mainnet is live with guardrails (5 USDC vault minimum, 25 USDC/day,
  50 USDC/week); do not custody third-party funds until an audit is complete.
- The mainnet adapter includes the `ZeroShares` guard; the frontend also pre-checks previews.
- Keeper can rebalance, execute withdrawal bookkeeping, and set message hashes — it **cannot** initiate withdrawals or change spending limits (agent/owner only).
- Spending limits are enforced on the resolved withdrawal amount, including `type(uint256).max`.
- `getTotalBalance()` never reverts; a failing vault preview falls back to principal.
- Hook data is decoded tolerantly; malformed payloads route to the default beneficiary instead of bricking the mint.
- Frontend has no backend and no secrets. Never commit a private key; the live deploy was signed in MetaMask.

See `docs/SECURITY.md` for the full threat model and known gaps.

---

## Repository layout

```
.
├── contracts/
│   ├── src/                 # AgentTreasury, MorphoVaultAdapter, CCTPReceiver, interfaces, libraries
│   ├── test/                # 81 Foundry tests + mocks + mainnet fork rehearsal
│   └── script/              # ArcConfig, DeployMainnet, testnet scripts
├── src/
│   ├── components/          # Header, StatCard, TxStep, EventRow, 6 tab panels
│   ├── hooks/               # Query→Zustand bridge, activity
│   ├── lib/                 # contracts/ABIs, decimals, activity, errors, network-selected CCTP map
│   └── stores/              # treasury, flow, ui
├── scripts/mainnet-deploy/  # local MetaMask deploy page (template + ABI/bytecode injector)
├── deployments/             # arc-mainnet.json, arc-testnet-fixed.json
├── docs/                    # architecture, runbook, security, demo
└── SUBMISSION.md            # hackathon submission copy
```

---

## License

MIT
