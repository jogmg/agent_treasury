# Runbook

## Prerequisites

- Node 20+ and Bun (or npm/pnpm)
- Foundry (`forge`, `cast`)
- An Arc wallet funded with USDC on the **target network**: real USDC on Arc mainnet for production,
  or testnet USDC from https://faucet.circle.com (select **Arc Testnet**) for demos

## Environment

The app defaults to **Arc mainnet**. Sensible mainnet addresses are compiled in; override only when
deploying a new stack:

```bash
# .env.local — mainnet is the default
VITE_ARC_NETWORK=mainnet
VITE_TREASURY_ADDRESS=0xf71b5d1a19d72b98675785123fae811698be6f63
VITE_ADAPTER_ADDRESS=0x5102057330f5bb5f3e4eb0925b7d1eac8a563c23
VITE_RECEIVER_ADDRESS=0x91f1eb97a40fdab05d150c10566cf9aa3546a375
VITE_VAULT_ADDRESS=0x8E357432CC12ff425c36432F312968aEb16112AF
VITE_USDC_ADDRESS=0x3600000000000000000000000000000000000000
VITE_TREASURY_DEPLOY_BLOCK=27153175

# Testnet demo build instead:
# VITE_ARC_NETWORK=testnet
# VITE_TREASURY_ADDRESS=0x5e2e3da19533ebf85bc916612eff5cdc7bf4d489
# VITE_ADAPTER_ADDRESS=0x333deccbf9091540e849b7af80f2f10b72197b71
# VITE_RECEIVER_ADDRESS=0x8066bcf8e6b17e2d84082179a89f0972cc6e31c1
# VITE_VAULT_ADDRESS=0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88
# VITE_TREASURY_DEPLOY_BLOCK=68193025
```

`VITE_ARC_NETWORK` also selects the Arc chain ID (5042 / 5042002), RPC list, explorer, CCTP
deployments, Iris endpoint, and destination-chain map. Contracts read `DEPLOYER_PRIVATE_KEY`,
`ARC_TREASURY_ADDRESS`, `ARC_ADAPTER_ADDRESS`, `ARC_RECEIVER_ADDRESS`, `DEPLOYER_ADDRESS`, and
`VAULT_1_ADDRESS` from `.env`. Never commit `.env`.

## App

```bash
bun install
bun run dev
bun run test
bun run build
bun run check
```

If the preview is blank, check the browser console for a wrong-chain or RPC error. The app expects the
chain selected by `VITE_ARC_NETWORK`: Arc mainnet `5042` by default, or testnet `5042002`.

## Contracts

```bash
cd contracts
forge install foundry-rs/forge-std --no-commit
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-commit
forge build
forge test -vv
```

### Arc mainnet (production)

`contracts/script/DeployMainnet.s.sol` refuses to broadcast unless the chain is `5042`, USDC/CCTP/the
vault have code, the vault's `asset()` is Arc USDC, and `MIN_DEPOSIT >= previewMint(1)`. It deploys all
three contracts, wires them, registers Galaxy USDC, sets APY, keeper, and the 25/50 USDC limits:

```bash
cd contracts
DEPLOYER_ADDRESS=0xD00fD0B006c01342522cAf4FA04D5f8910aB268c \
FINAL_OWNER_ADDRESS=0xD00fD0B006c01342522cAf4FA04D5f8910aB268c \
forge script script/DeployMainnet.s.sol \
  --rpc-url https://rpc.mainnet.arc.io \
  --broadcast \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  -vv
```

Defaults: `VAULT_1_ADDRESS=0x8E357432CC12ff425c36432F312968aEb16112AF` (Galaxy USDC),
`VAULT_1_APY=26500000000000000`, `MIN_DEPOSIT=5000000`, `DAILY_LIMIT=25000000`,
`WEEKLY_LIMIT=50000000`.

The live deployment used the wallet-driven page in `scripts/mainnet-deploy/` instead of a plaintext
key: `node scripts/mainnet-deploy/build.mjs`, serve the folder, connect the owner wallet, and approve
the 10 transactions. The fork rehearsal is `contracts/test/fork/MainnetDeploy.t.sol` (requires
`ARC_MAINNET_RPC`; skips otherwise).

### Arc testnet (demo hotfix)

Deploy and wire the testnet stack in one broadcast:

```bash
export FINAL_OWNER_ADDRESS=0xD00fD0B006c01342522cAf4FA04D5f8910aB268c
export VAULT_1_ADDRESS=0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88
forge script script/DeployFixedTestnet.s.sol \
  --rpc-url https://rpc.testnet.arc.io \
  --broadcast \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  -vv
```

The script deploys fresh `MorphoVaultAdapter`, `CCTPReceiver`, and
`AgentTreasury` contracts, wires them, registers vault 1, sets keeper to the
final owner, and starts the Ownable2Step handoff. The final owner accepts via
**Settings → Accept Contract Ownership** in the app.

The earlier `DeployTestnet.s.sol` + `ConfigureTestnet.s.sol` pair remains as a
historical two-step example; do not use it for a CCTP-hotfix deployment.

## Smoke tests

### Arc mainnet (current deployment)

```bash
RPC=https://rpc.mainnet.arc.io
T=0xf71b5d1a19d72b98675785123fae811698be6f63
A=0x5102057330f5bb5f3e4eb0925b7d1eac8a563c23
R=0x91f1eb97a40fdab05d150c10566cf9aa3546a375
V=0x8E357432CC12ff425c36432F312968aEb16112AF
OWNER=0xD00fD0B006c01342522cAf4FA04D5f8910aB268c

cast call $T "morphoAdapter()(address)" --rpc-url $RPC
cast call $T "gatewayReceiver()(address)" --rpc-url $RPC
cast call $T "keeper()(address)" --rpc-url $RPC
cast call $T "paused()(bool)" --rpc-url $RPC
cast call $T "defaultVaultId()(uint256)" --rpc-url $RPC
cast call $T "ARC_DOMAIN()(uint32)" --rpc-url $RPC
cast call $A "getVaultConfig(uint256)((uint256,address,string,string,uint256,bool))" 1 --rpc-url $RPC
cast call $A "vaultAPY(uint256)(uint256)" 1 --rpc-url $RPC
cast call $V "asset()(address)" --rpc-url $RPC
cast call $V "previewDeposit(uint256)(uint256)" 5000000 --rpc-url $RPC
cast call $V "previewMint(uint256)(uint256)" 1 --rpc-url $RPC
cast call $T "getTotalBalance(address)(uint256)" $OWNER --rpc-url $RPC
```

Expected: adapter `0x5102…`, receiver `0x91f1…`, keeper/owner `0xD00f…`, paused `false`, default vault
`1`, domain `26`, vault active with `minDeposit = 5000000` and APY `26500000000000000`, vault asset
USDC, `previewDeposit(5 USDC) > 0`, `previewMint(1) >= 1`.

### Arc testnet (demo stack)

```bash
RPC=https://rpc.testnet.arc.io
T=0x5e2e3da19533ebf85bc916612eff5cdc7bf4d489
A=0x333deccbf9091540e849b7af80f2f10b72197b71
cast call $T "getTotalBalance(address)(uint256)" $DEPLOYER_ADDRESS --rpc-url $RPC
cast call $T "morphoAdapter()(address)" --rpc-url $RPC
cast call $T "paused()(bool)" --rpc-url $RPC
cast call $A "getVaultConfig(uint256)((uint256,address,string,string,uint256,bool))" 1 --rpc-url $RPC
cast call $A "vaultAPY(uint256)(uint256)" 1 --rpc-url $RPC
```

Expected after wiring: adapter/receiver non-zero, paused `false`, vault active, APY
`42000000000000000` (4.2e16 = 4.20%), testnet `minDeposit = 1000000`.

Observed E2E on the hotfix stack (Oct 2026):

| Step | Value |
|---|---|
| Deposit 10 USDC | balance `9999999`, shares `9989427554595819468` (18 dec) |
| CCTP withdraw 1 USDC to domain 0 | withdrawal id `1`, burned `999999`, `MessageSent` finality `2000`, balance `9000000` |
| Iris attestation | `status: complete`, `finalityThresholdExecuted: 2000` |

`withdrawLocal(max)` redeems every share and uses the actual redeemed amount, so the 1-unit ERC-4626 rounding difference is not stranded.

### Complete the destination mint

The recipient (`0xD00f...`) has no Sepolia ETH, so the test mint is pending gas.
Fund it from a Sepolia faucet, then:

```bash
npx tsx scripts/complete-cctp.ts 0x3f0f256843ee4e1498cafceea9978725397904899bb527f684eb98c171e28a1c
# dry run prints calldata; add SEPOLIA_RPC_URL + PRIVATE_KEY + --send to submit
# Bun is equivalent: bun scripts/complete-cctp.ts 0x3f0f... --send
```

The script fetches the attested message from Circle Iris and calls
`receiveMessage(message, attestation)` on Sepolia's MessageTransmitterV2.

### Vault minimum deposit

**Mainnet (current): 5 USDC (`5_000_000`).** Set at deployment from Galaxy USDC's live share price and
gas-versus-yield economics, and guarded by `MIN_DEPOSIT >= previewMint(1)`. It is config-only and can be
changed without a redeploy:

```bash
cast send 0x5102057330f5bb5f3e4eb0925b7d1eac8a563c23 \
  "updateVault(uint256,uint256,bool)" 1 5000000 true \
  --rpc-url https://rpc.mainnet.arc.io --private-key $KEEPER_KEY
# verify (getVaultConfig returns ONE struct):
cast call 0x5102057330f5bb5f3e4eb0925b7d1eac8a563c23 \
  "getVaultConfig(uint256)((uint256,address,string,string,uint256,bool))" 1 \
  --rpc-url https://rpc.mainnet.arc.io
```

**Testnet (demo): 1 USDC.** Changed from 10 USDC on Oct 21, 2026 — keeper tx
`0xd2eba836dce60dfea39fa1af21902ed4e18597c25b0395b99ce35653900574fc`
(block `68380870`, gas `35,306`, sent by owner/keeper
`0xD00fD0B006c01342522cAf4FA04D5f8910aB268c`):
`getVaultConfig(1)` now returns `minDeposit = 1000000`, `isActive = true`.
No redeploy, no code change — config storage only, reversible with the same
call using `10000000`.

Background: the floor lives on-chain in the MorphoVaultAdapter's vault config;
`deposit()` reverts `BelowMinDeposit` below it. The original reference command
(keep for future config changes):

```bash
cast send 0x333deccbf9091540e849b7af80f2f10b72197b71 \
  "updateVault(uint256,uint256,bool)" 1 1000000 true \
  --rpc-url https://rpc.testnet.arc.io --private-key $KEEPER_KEY
# verify (expect minDeposit = 1000000). NOTE: getVaultConfig returns ONE
# struct, so the flat 6-value signature fails to decode — use the tuple:
cast call 0x333deccbf9091540e849b7af80f2f10b72197b71 \
  "getVaultConfig(uint256)((uint256,address,string,string,uint256,bool))" 1 \
  --rpc-url https://rpc.testnet.arc.io
```

The frontend reads this value live (`useMinDeposit`). While the read is
unresolved the UI blocks submission ("Reading vault minimum."); it never
substitutes a permissive default, because that allowed a 2 USDC tx that
reverted `BelowMinDeposit` while the chain still enforced 10 USDC (Oct 21).
The Deposit tab, cross-chain deposit card, and vault tier label update
automatically after any config change.

### Tiny deposits and zero-share risk (implemented Oct 21, 2026)

`deposit()` accepts anything >= the vault minimum, but the vault mints 18-decimal
shares against its `pricePerShare`. At today's ~1:1 price, 1 USDC mints
~9.99e17 shares, so the 1 USDC floor is safe. If the vault ever appreciates far
enough that `assets * 1e18 / pricePerShare < 1`, a deposit would mint **zero
shares** — the USDC is still transferred but gives the depositor no vault claim.
Implemented mitigations:

1. **Adapter guard (shipped on mainnet):** `MorphoVaultAdapter.deposit()` reverts with
   `Errors.ZeroShares()` when the vault returns 0 shares, which unwinds the whole call (no stranded
   assets). Covered by `test_deposit_zero_shares_reverts`. The **mainnet adapter includes this guard**;
   the older live testnet adapter predates it and relies on the frontend pre-check.
2. **Frontend pre-check (live):** `useDepositShares` reads the vault's
   ERC-4626 `previewDeposit(amount)` plus `previewMint(1)` (the smallest amount
   that mints one share) and blocks a zero-share deposit in both the Deposit tab
   and the cross-chain deposit card; the card re-checks immediately before
   `treasury.deposit()` because its amount comes from persisted bridge state.
3. **Mainnet policy (applied):** do NOT hardcode 1 USDC on mainnet. Derive `minDeposit` from the
   vault's live share price and unit economics (gas vs. expected yield). Mainnet launched with a
   **5 USDC** floor and it remains adjustable with `updateVault` (config-only) as the share price
   moves. 1 USDC stays as the testnet demo floor.

### Recover the pre-hotfix treasury

The old `0x9b390...` treasury still holds testnet USDC. Its `withdrawLocal` path
is unaffected by the CCTP bug. The UI recovery card was removed (no recoverable
funds remain for the tracked wallet); if funds reappear, connect each wallet
that used the legacy stack and call `withdrawLocal(type(uint256).max)` on
`0x9b390bb10bd30a25b5a07dfb9e0a058d7993ae0d` directly.

## End-to-end test (UI)

**Mainnet** (requires ≥5 USDC plus gas in the wallet):

1. Connect the wallet; switch to Arc mainnet (`5042`).
2. Confirm `getTotalBalance` and the vault minimum read before depositing.
3. Deposit 5 USDC (approve + deposit). The vault is Galaxy USDC; shares are 18-dec.
4. Confirm `getTotalBalance > 0`, shares `> 0`, and the Activity tab decodes `DepositRecorded`.
5. Withdraw 1 USDC via `withdrawLocal`; confirm the wallet balance and shares decrease.
6. Optionally test a small CCTP withdrawal to a funded destination chain (destination gas required).
7. Record every hash in `deployments/arc-mainnet.json`.

**Testnet** (`VITE_ARC_NETWORK=testnet`, 1 USDC floor):

1. Connect wallet; switch to Arc Testnet.
2. Faucet 20 USDC.
3. Deposit 10 USDC (approve + deposit); confirm shares and total balance.
4. Withdraw 5 USDC via `withdrawLocal`; confirm wallet balance and shares decrease.
5. Set a daily limit of 1 USDC; attempt a 2 USDC withdrawal; confirm revert.
6. Check Activity for decoded events and explorer links.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `deposit` reverts | Adapter/vault not wired, or below the vault minimum | Run the smoke tests above; mainnet minimum is 5 USDC, testnet 1 USDC. |
| Owner tx fails with insufficient funds | Owner has no gas | Mainnet: send USDC on Arc to the wallet. Testnet: https://faucet.circle.com. |
| `getVaultConfig(1)` reverts | Vault not registered | Run the deploy/wiring script; check `morphoAdapter()` is non-zero. |
| Activity empty | No events since the configured deploy block, or RPC limit | Check `VITE_TREASURY_DEPLOY_BLOCK`; refresh. The scanner skips failed chunks. |
| Wrong network banner | Wallet on another chain | Switch to the build's network: Arc mainnet `5042` or testnet `5042002`. |
| CCTP withdrawal burns but destination not credited | Attestation not relayed, or destination wallet has no gas | The app polls Iris and submits `receiveMessage`; otherwise use `scripts/complete-cctp.ts`. Mainnet uses `https://iris-api.circle.com`, testnet the sandbox. |

## Mainnet

**Deployed and wired October 21, 2026.** Chain `5042`, RPC `https://rpc.mainnet.arc.io`, explorer
`https://explorer.arc.io`.

| Contract | Address |
|---|---|
| AgentTreasury | `0xf71b5d1a19d72b98675785123fae811698be6f63` |
| MorphoVaultAdapter | `0x5102057330f5bb5f3e4eb0925b7d1eac8a563c23` |
| CCTPReceiver | `0x91f1eb97a40fdab05d150c10566cf9aa3546a375` |

Galaxy USDC vault `0x8E357432CC12ff425c36432F312968aEb16112AF`, APY `2.65%`, minimum `5 USDC`,
spending limit `25 USDC/day / 50 USDC/week`, owner/keeper
`0xD00fD0B006c01342522cAf4FA04D5f8910aB268c`. Full record: `deployments/arc-mainnet.json`.

Post-deploy policy:

- Keep the 5 USDC minimum and 25/50 limits until the external audit is booked and passed.
- Rotate the keeper from the owner EOA to a dedicated key before scaling volume.
- Do not raise caps, accept third-party deposits, or add vaults without an audit.
- Live E2E passed October 21, 2026: 5 USDC deposit → 1 USDC `withdrawLocal`, then a full CCTP round
  trip (two Arc→Base withdrawals attested and minted; Base→Arc 5 USDC minted and deposited). Hashes,
  nonces, and state are in `deployments/arc-mainnet.json` (`liveE2E`, `liveCctpE2E`).
- Bookkeeping follow-up: withdrawal ids 1–2 are still `executed=false`. Call keeper
  `executeWithdrawal(1)` and `executeWithdrawal(2)` to clear them; funds are unaffected.
