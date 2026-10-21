# Runbook

## Prerequisites

- Node 20+ and Bun (or npm/pnpm)
- Foundry (`forge`, `cast`)
- An Arc Testnet wallet with USDC for gas
- Testnet USDC from https://faucet.circle.com (select **Arc Testnet**)

## Environment

The app compiles with testnet fallbacks. To override:

```bash
# .env.local
VITE_TREASURY_ADDRESS=0x5e2e3da19533ebf85bc916612eff5cdc7bf4d489
VITE_ADAPTER_ADDRESS=0x333deccbf9091540e849b7af80f2f10b72197b71
VITE_RECEIVER_ADDRESS=0x8066bcf8e6b17e2d84082179a89f0972cc6e31c1
VITE_USDC_ADDRESS=0x3600000000000000000000000000000000000000
VITE_TREASURY_DEPLOY_BLOCK=68193025
```

Contracts read `DEPLOYER_PRIVATE_KEY`, `ARC_TREASURY_ADDRESS`, `ARC_ADAPTER_ADDRESS`, `ARC_RECEIVER_ADDRESS`, `DEPLOYER_ADDRESS`, and `VAULT_1_ADDRESS` from `.env`. Never commit `.env`.

## App

```bash
bun install
bun run dev
bun run test
bun run build
bun run check
```

If the preview is blank, check the browser console for a wrong-chain or RPC error. The app expects chain ID `5042002`.

## Contracts

```bash
cd contracts
forge install foundry-rs/forge-std --no-commit
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-commit
forge build
forge test -vv
```

Deploy and wire the current hotfix stack in one broadcast:

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

```bash
cast call $ARC_TREASURY_ADDRESS "getTotalBalance(address)(uint256)" $DEPLOYER_ADDRESS --rpc-url https://rpc.testnet.arc.io
cast call $ARC_TREASURY_ADDRESS "morphoAdapter()(address)" --rpc-url https://rpc.testnet.arc.io
cast call $ARC_TREASURY_ADDRESS "gatewayReceiver()(address)" --rpc-url https://rpc.testnet.arc.io
cast call $ARC_TREASURY_ADDRESS "paused()(bool)" --rpc-url https://rpc.testnet.arc.io
cast call $ARC_ADAPTER_ADDRESS "getVaultConfig(uint256)(uint256,address,string,string,uint256,bool)" 1 --rpc-url https://rpc.testnet.arc.io
cast call $ARC_ADAPTER_ADDRESS "vaultAPY(uint256)(uint256)" 1 --rpc-url https://rpc.testnet.arc.io
```

Expected after wiring: adapter/receiver non-zero, paused `false`, vault active, APY `42000000000000000` (4.2e16 = 4.20%).

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

### Lower the vault minimum deposit (one-time keeper tx)

The 10 USDC minimum lives on-chain in the MorphoVaultAdapter's vault config
(`getVaultConfig(1).minDeposit == 10e6`); `deposit()` reverts `BelowMinDeposit`
below it. To allow 1 USDC deposits, the owner/keeper wallet sends one config
tx (no redeploy, no contract change):

```bash
cast send 0x333deccbf9091540e849b7af80f2f10b72197b71 \
  "updateVault(uint256,uint256,bool)" 1 1000000 true \
  --rpc-url https://rpc.testnet.arc.io --private-key $KEEPER_KEY
# verify (expect minDeposit = 1000000)
cast call 0x333deccbf9091540e849b7af80f2f10b72197b71 \
  "getVaultConfig(uint256)(uint256,address,string,string,uint256,bool)" 1 \
  --rpc-url https://rpc.testnet.arc.io
```

The frontend reads this value live (`useMinDeposit`, falls back to 1 USDC), so
the Deposit tab, cross-chain deposit card, and vault tier label update
automatically after the tx lands. Caveat: very small deposits can mint zero
shares if the vault's pricePerShare rises far above 1e18 — safe now (testnet
TVL is tiny), revisit after more deposits.

### Recover the pre-hotfix treasury

The old `0x9b390...` treasury still holds testnet USDC. Its `withdrawLocal` path
is unaffected by the CCTP bug. The UI recovery card was removed (no recoverable
funds remain for the tracked wallet); if funds reappear, connect each wallet
that used the legacy stack and call `withdrawLocal(type(uint256).max)` on
`0x9b390bb10bd30a25b5a07dfb9e0a058d7993ae0d` directly.

## End-to-end test (UI)

1. Connect wallet; switch to Arc Testnet.
2. Faucet 20 USDC.
3. Deposit 10 USDC (approve + deposit).
4. Confirm `getTotalBalance` > 0 and shares > 0.
5. Withdraw 5 USDC via `withdrawLocal`; confirm wallet balance and shares decrease.
6. Set a daily limit of 1 USDC; attempt a 2 USDC withdrawal; confirm revert.
7. Check Activity tab for decoded events and explorer links.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `deposit` reverts | Adapter/vault not wired | Run `ConfigureTestnet.s.sol`; check `morphoAdapter()` non-zero. |
| Owner tx fails with insufficient funds | Owner has no gas | Fund the owner address at https://faucet.circle.com. |
| `getVaultConfig(1)` reverts | Vault not registered | Run wiring step 6. |
| Activity empty | No events in the last 90k blocks, or RPC limit | Refresh; the scanner skips failed chunks. |
| Wrong network banner | Wallet on another chain | Switch to Arc Testnet (5042002). |
| CCTP withdrawal burns but destination not credited | Attestation not relayed (or destination wallet has no gas) | Fetch Iris attestation with `scripts/complete-cctp.ts` and call `receiveMessage` on the destination. |

## Mainnet

Do not deploy until:

- a mainnet deployer is funded with real USDC,
- a mainnet Morpho vault address is set in `ArcConfig.sol`,
- the testnet rehearsal is green,
- an independent review of the contracts is done.
