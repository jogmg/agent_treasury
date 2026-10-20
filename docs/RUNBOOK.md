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
VITE_TREASURY_ADDRESS=0x9b390bb10bd30a25b5a07dfb9e0a058d7993ae0d
VITE_ADAPTER_ADDRESS=0xe1dafeef6762c672bb5e4a8ff62c3812e111b2e3
VITE_RECEIVER_ADDRESS=0x7697c83c23339ccfdcf2d8e979b26ee5d731e7ee
VITE_USDC_ADDRESS=0x3600000000000000000000000000000000000000
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

Deploy (testnet):

```bash
forge script script/DeployTestnet.s.sol \
  --rpc-url https://rpc.testnet.arc.io \
  --broadcast \
  --private-key $DEPLOYER_PRIVATE_KEY
```

Wire (testnet):

```bash
forge script script/ConfigureTestnet.s.sol \
  --rpc-url https://rpc.testnet.arc.io \
  --broadcast \
  --private-key $DEPLOYER_PRIVATE_KEY \
  -vv
```

The wiring script performs:

1. `adapter.setTreasury(treasury)`
2. `receiver.setTreasury(treasury)`
3. `treasury.setMorphoAdapter(adapter)`
4. `treasury.setGatewayReceiver(receiver)`
5. `adapter.setKeeper(deployer)` / `treasury.setKeeper(deployer)`
6. `adapter.addVault(1, 0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88, "USDC Core", "mUSDC-CORE", 10e6)`
7. `adapter.setVaultAPY(1, 4.2e16)`
8. `treasury.setDefaultVaultId(1)`

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

Observed E2E on testnet (Oct 2026):

| Step | Value |
|---|---|
| Deposit 10 USDC | principal `10000000`, shares `9989427554789604143` (18 dec), `previewRedeem` `9999999` |
| Withdraw 1 USDC | principal `9000001`, total `9000000`, wallet `+991307` (gas accounts for the rest) |

`withdrawLocal(max)` burns every share and uses the actual redeemed amount, so the 1-unit ERC-4626 rounding difference is not stranded.

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
| CCTP withdrawal burns but destination not credited | Attestation not relayed | Fetch Iris attestation and call `receiveMessage` on the destination. |

## Mainnet

Do not deploy until:

- a mainnet deployer is funded with real USDC,
- a mainnet Morpho vault address is set in `ArcConfig.sol`,
- the testnet rehearsal is green,
- an independent review of the contracts is done.
