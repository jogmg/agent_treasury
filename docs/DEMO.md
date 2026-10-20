# Demo script (3 minutes)

## Before you record

- [ ] Wiring complete (`morphoAdapter()` non-zero, `vaultAPY(1) == 4.2e16`, `paused() == false`).
- [ ] Demo wallet has 10–20 testnet USDC.
- [ ] App running (`bun run dev`) or the Arc Studio preview open.
- [ ] Explorer tabs pre-opened for the treasury and adapter.

## 0:00 — Hook

> "AI agents can hold money, but they have no treasury. Agent Treasury gives an agent a USDC account on Arc that earns yield automatically and can move across chains with CCTP."

Show the Overview tab: total value, principal, yield, APY, vault shares.

## 0:20 — Deposit

1. Click **Deposit**.
2. Enter `10` USDC.
3. Click **Approve** (if needed), then **Deposit**.
4. Walk through the tx steps: approve → deposit → vault.
5. Point out the explorer link and the updated shares/principal.

> "The treasury pulls USDC, credits the agent, and deploys it into the Morpho Earn Kit vault in the same transaction."

On-chain proof if asked: deposit `0xa4fc0034…3a520`, withdraw `0x27cf6628…1b826`.

## 0:50 — Yield

1. Open **Yield**.
2. Show live APY (4.2%), TVL, your shares and value.
3. Change the projection to 90 days.
4. Point out the growth chart and the honest empty state.

> "Yield accrues in the vault; the dashboard reads the adapter and the vault, not a database."

## 1:15 — Withdraw

1. Open **Withdraw**.
2. Click **25%**, then **Withdraw**.
3. Show the wallet balance increase and shares decrease.
4. Open the advanced CCTP section; explain destination domain + bytes32 recipient and the manual Iris relay.

> "Same-chain withdrawals are instant. Cross-chain withdrawals burn via CCTP v2 and mint on the destination."

## 1:40 — Controls

1. Open **Settings**.
2. Set a daily limit of `5` USDC.
3. Try to withdraw `10`; show the revert/toast.
4. Show owner/keeper/pause state.

> "The keeper can rebalance but cannot initiate withdrawals. Spending limits are enforced on-chain on the resolved amount."

## 2:05 — Activity

1. Open **Activity**.
2. Filter by type; expand a row; show decoded args and the explorer tx.
3. Export CSV.

> "Every action is reconstructed from treasury events in the browser; there is no indexer to trust."

## 2:30 — Close

> "Three Circle products: CCTP v2 for cross-chain USDC, Earn Kit/Morpho for yield, and a Gateway-ready hook. Built end-to-end in Arc Studio, 80 Foundry tests and 36 frontend tests green, with a verified on-chain deposit/withdraw. Testnet today; mainnet is gated on a funded deployer and an audit."

## Fallbacks

- **RPC/app unavailable:** show the verified deposit/withdraw tx hashes in `deployments/arc-testnet.json` and run `forge test -vv` as the proof. Do not fake a deposit.
- **No testnet USDC:** show the faucet step and the empty states; keep the recording honest.
- **RPC slow:** pre-load the tabs once before recording.
