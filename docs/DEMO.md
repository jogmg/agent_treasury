# Demo script (3 minutes)

## Before you record

- [ ] Hotfix wiring complete (`morphoAdapter()` non-zero, `vaultAPY(1) == 4.2e16`, `paused() == false`, `CCTP_MIN_FINALITY_THRESHOLD() == 2000`).
- [ ] Demo wallet has ≥6 USDC on Arc mainnet (5 USDC minimum + gas), or 10–20 testnet USDC for the testnet build.
- [ ] App running (`bun run dev`) or the Arc Studio preview open.
- [ ] Explorer tabs pre-opened for treasury `0x5e2e…d489` and adapter `0x333d…7b71`.
- [ ] Optional: a funded Sepolia wallet if you want to show the destination mint.

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

On-chain proof if asked: deposit `0xbab58770…04c4`, CCTP withdraw `0x3f0f2568…8a1c`.

## 0:50 — Yield

1. Open **Yield**.
2. Show live APY (4.2%), TVL, your shares and value.
3. Change the projection to 90 days.
4. Point out the growth chart and the honest empty state, then the 24h/7d/30d/All time-range buttons.

> "Yield accrues in the vault; the dashboard reads the adapter and the vault, not a database."

## 1:15 — Withdraw

1. Open **Withdraw**.
2. Click **25%**, then **Withdraw**.
3. Show the wallet balance increase and shares decrease.
4. Open the advanced CCTP section; explain the chain-name destination dropdown, bytes32 recipient, and the automatic Iris relay.

5. Submit the burn; explain Activity → **In flight** with the burn tx hash, then Completion Card.

6. Show the existing proof tx `0x3f0f2568…8a1c`: burn `999,999`, `MessageSent` finality `2000`, Iris status `complete`.

> "Same-chain withdrawals are instant. Cross-chain withdrawals burn via CCTP v2 and produce a finalized attestation; the destination mint is a permissionless relay step. Our live test burned from yield to domain 0 and Circle attested it."

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

> "Three Circle products: CCTP v2 for cross-chain USDC, Earn Kit/Morpho for yield, and a Gateway-ready hook. Built end-to-end in Arc Studio, 81 Foundry tests and 52 frontend tests green. Testnet: verified deposit plus a live CCTP burn from yield to domain 0 and a finalized Circle attestation. Mainnet: the same stack is deployed and wired with guardrails, and a real 5 USDC deposit → Galaxy USDC → 1 USDC local withdrawal has passed on-chain."

## Fallbacks

- **RPC/app unavailable:** show the verified deposit/CCTP-withdrawal tx hashes and Iris attestation in `deployments/arc-testnet-fixed.json`, and run `forge test -vv` as the proof. Do not fake a deposit.
- **No testnet USDC:** show the faucet step and the empty states; keep the recording honest.
- **Destination mint not visible:** explain that the burn is attested but Sepolia gas is a separate step; show the Iris `complete` response and `scripts/complete-cctp.ts`. Never claim the destination mint already happened.
- **RPC slow:** pre-load the tabs once before recording.
