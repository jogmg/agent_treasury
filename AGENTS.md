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
| CCTPReceiver | `0x91f1eb97a40fdab05d150c10566cf9aa3546a375` | [link](https://explorer.arc.io/address/0x91f1eb97a40fdab05d150c10566cf9aa3546a375) |

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
- Independently verified after deploy: bytecode at all three contracts + vault, all owner/keeper
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
  source-domain accounting is still TODO #8. Withdrawal ids 1–2 are still `executed=false` on-chain —
  run keeper `executeWithdrawal` to clear them.
- Full record: `deployments/arc-mainnet.json`. Audit: not done (owner chose "ship with guardrails":
  low caps, small live test, external audit before raising limits).

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
81 tests PASS, 0 fail across:
- AgentTreasury.t.sol (39 tests)
- MorphoVaultAdapter.t.sol (22 tests)
- CCTPReceiver.t.sol (11 tests)
- Invariants.t.sol (9 tests)

### Test results (vitest / frontend) — latest pass
52 tests PASS, 0 fail across:
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
| CCTPReceiver | `0x8066bcf8e6b17e2d84082179a89f0972cc6e31c1` | [link](https://explorer.testnet.arc.io/address/0x8066bcf8e6b17e2d84082179a89f0972cc6e31c1) |
| AgentTreasury | `0x5e2e3da19533ebf85bc916612eff5cdc7bf4d489` | [link](https://explorer.testnet.arc.io/address/0x5e2e3da19533ebf85bc916612eff5cdc7bf4d489) |

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

### Inbound CCTP deposit proof (Oct 2026)
- 10 USDC burned on Ethereum Sepolia by `0x72Cbd56507699F5002A10aCdDC5D20b4C2207a75`
  to Arc domain `26`, mintRecipient the same wallet:
  source tx `0x2f62e20a4e5b0c650bfe0bad15629509f1d4779d0269ecf1fffdff03b81d9501`.
- Iris source-domain `0` attestation is `complete`; destination domain `26`, amount `10000000`.
- Arc `receiveMessage` was simulated from the recipient and returned `true`. The Arc mint and
  treasury `deposit()` still require the user's wallet signature.

### Frontend hotfix additions
- `LegacyRecoveryCard` in the Withdraw tab recovered funds from the old stack via `withdrawLocal`. **Removed Oct 2026** (no user funds remain in the legacy treasury for the current wallet); the legacy addresses below are kept only as a historical record.
- `OwnershipCard` in Settings accepts the Ownable2Step handoff on all three contracts.
- `CctpCompletionCard` polls Circle Iris after a burn, switches to the destination chain, and submits `receiveMessage`. It also lists recent CCTP requests and accepts a pasted Arc burn tx hash. The destination mint still needs destination-chain gas.
- `CrossChainDepositCard` implements inbound CCTP in the Deposit tab as a **collapsible `<details>` panel** (summary shows a live status badge and auto-opens while in flight): source-chain `depositForBurn` → Iris poll → Arc `receiveMessage` (mints to the connected wallet) → Arc `approve` + `treasury.deposit()`. It requires source USDC, source gas, and a little Arc gas. `CCTPReceiver` is not on this path. It has a **Track a source transaction** recovery form (validates destination domain, mintRecipient, and destinationCaller) and the Activity tab shows a pending bridge banner with the source tx link, since source-chain burns do not appear in Arc logs until the mint/deposit.
- **Zero-share deposit guard:** `MorphoVaultAdapter.deposit()` reverts `Errors.ZeroShares()` if the vault mints 0 shares (test: `test_deposit_zero_shares_reverts`). The **mainnet adapter includes this guard**; the live testnet adapter predates it. The frontend still covers both: `useDepositShares` calls `previewDeposit(amount)` + `previewMint(1)` and blocks zero-share deposits in the Deposit tab and cross-chain card (the card re-checks just before `treasury.deposit()`). Mainnet `minDeposit` was set to **5 USDC** from share price + unit economics (gas vs. yield), not a hardcoded guess, and is adjustable with `updateVault` as the share price moves. Testnet remains at 1 USDC for demos.
- The in-flight flow and its burn hash survive a reload: the active bridge-deposit state and a recent-burns list are persisted (`agent-treasury-bridge-deposit-v1`), and outbound CCTP withdrawals are persisted in `flow.ts` (`agent-treasury-cctp-outbound-v1`) once the burn receipt confirms. Activity rows render through one uniform `ActivityRow` UI (`EventRow.tsx`): `eventRowData` maps chain events, `pendingRowData` (PendingCctpRow.tsx) maps transfers with explicit **CCTP Deposit** / **CCTP Withdrawal** kind badges, status, chains, amount, burn/mint tx links in the expandable panel, timestamp, and a Resume CTA that restores the active flow and switches tabs (completed transfers render no CTA). Rows are merged and sorted most-recent first: `fetchActivityEvents` enriches each event with its block timestamp (`getBlocks` cached per block, linear interpolation when a fetch fails); if any timestamp is missing the UI falls back to block order with pending rows first. Expanded chain panels show `Block N · date time`. Filters are **All / In flight / Deposits / Withdrawals / Yield** (the old Pending value was renamed to `inflight`); chain-event rows are relabeled (`WithdrawalRequested` → "CCTP Withdrawal", local → "Local Withdraw", `DepositRecorded` shows the source chain). The Withdraw tab has **no** recent-request list (transfers live in the Activity tab) — only the paste-hash recovery remains. The growth chart has 24h/7d/30d/All range buttons. `resetCctp`/`resetBridgeDeposit` intentionally keep the history lists. The Withdraw tab's destination selector is a chain-name dropdown built from `CCTP_DESTINATIONS`.
- `ADDRESSES` / `ARC_TREASURY_DEPLOY_BLOCK` are selected at build time: mainnet defaults are the
  Galaxy stack above; `VITE_ARC_NETWORK=testnet` switches to the hotfix stack. `LEGACY_ADDRESSES`
  keep the pre-hotfix testnet stack for recovery.
- **`getVaultConfig` ABI quirk:** the deployed adapter returns `VaultConfig` as a SINGLE struct (one tuple output). `ADAPTER_ABI` must declare `returns ((uint256 id, address vaultAddress, string name, string symbol, uint256 minDeposit, bool isActive))` and callers read `data.minDeposit`. Declaring six flat outputs makes viem decode `name` from the vault address and throw `IntegerOutOfRangeError`, silently killing the live min-deposit read.

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
4. ✅ Mainnet CCTP proven live: Arc→Base burns (ids 1–2) with complete production Iris attestations and
   Base mints, plus a Base→Arc 5 USDC burn/mint/deposit. Hashes in `deployments/arc-mainnet.json`.
5. Clear the completed withdrawal bookkeeping with keeper `executeWithdrawal(1)` and `(2)` (ids are
   still `executed=false`; funds are unaffected). The app has no button for this yet.
6. Rotate the keeper role from the owner EOA to a dedicated hot key before scaling volume.
7. Book an external audit before raising the 25/50 USDC spending limits or onboarding third-party agents.
8. Verify contract source on the Arc mainnet explorer.
9. Validate BurnMessageV2 Layout A/B offsets against the live Arc MessageTransmitterV2; `CCTPReceiver`
   is deployed and wired but unused by the current app path.
10. Source-domain accounting for inbound deposits: the app mints to the wallet and calls `deposit()`, so
    `chainDeposits` records Arc domain. Fix by routing inbound mints through `CCTPReceiver` (mintRecipient
    = receiver, hookData = agent) so `recordDeposit` receives the real domain, or add a
    `depositWithSource(amount, sourceDomain)` entrypoint with explicit trust rules. **Do not backfill
    with owner-signed `recordDeposit`**: it is additive and would double-credit `principal`/`totalDeposited`
    and try to deploy the same USDC again.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
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
