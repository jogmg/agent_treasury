# Security notes

> **Status: unaudited, live on Arc mainnet with guardrails.** Do not custody third-party funds or raise
> the launch caps until an external audit is complete.

## Trust model

| Actor | Can | Cannot |
|---|---|---|
| Agent (end user) | Deposit, withdraw locally, request CCTP withdrawal, change its own vault, set its own spending limits | Touch another agent's account |
| Owner | Act for any agent, pause, set adapter/receiver, set keeper, set max delay, set default vault/fee | Mint USDC, bypass a funded balance |
| Keeper | Rebalance, execute withdrawal bookkeeping, record message hashes | Initiate withdrawals, change limits, move funds to itself |
| CCTP MessageTransmitter | Call `CCTPReceiver.handleReceiveMessage` | Call treasury directly except through the receiver |
| Anyone | `deposit()` for themselves | Withdraw for anyone else |

The keeper separation is enforced and covered by regression tests: a keeper cannot call `requestWithdrawal` or `setSpendingLimit` for another agent.

## Mainnet deployment (October 21, 2026)

Deployed and independently verified on Arc mainnet (`5042`):

| Contract | Address |
|---|---|
| AgentTreasury | `0xf71b5d1a19d72b98675785123fae811698be6f63` |
| MorphoVaultAdapter | `0x5102057330f5bb5f3e4eb0925b7d1eac8a563c23` |
| CCTPReceiver | `0x91f1eb97a40fdab05d150c10566cf9aa3546a375` |

Verified: bytecode, owner/keeper, adapter/receiver links, mainnet CCTP and domain `26`, default vault
`1`, unpaused, vault asset USDC, active with `minDeposit = 5 USDC`, APY `2.65%`, and positive previews.

Launch guardrails: **5 USDC minimum**, **25 USDC/day and 50 USDC/week** spending limit, owner EOA as
keeper. A live **5 USDC deposit → 1 USDC local withdrawal** passed on mainnet on October 21, 2026
(evidence below). The exact deploy sequence passed on a mainnet fork first. Full record:
`deployments/arc-mainnet.json`.

## Testnet E2E evidence

The hotfix contracts moved real testnet USDC through the live Morpho Earn Kit vault and outbound CCTP:

- Deposit 10 USDC: [`0xbab58770…04c4`](https://explorer.testnet.arc.io/tx/0xbab5877074904d17fb21b49aed8c3d2a956ee8d16d3ddc3ec523046d464a04c4) → balance `9,999,999`, `9,989,427,554,595,819,468` shares (18 dec).
- CCTP withdrawal 1 USDC to domain 0: [`0x3f0f2568…8a1c`](https://explorer.testnet.arc.io/tx/0x3f0f256843ee4e1498cafceea9978725397904899bb527f684eb98c171e28a1c) → withdrawal id `1`, burned `999,999`, `MessageSent` finality `2000`, Iris attestation `complete`.
- APY: `vaultAPY(1) = 4.2e16`.

The earlier 10 USDC deposit / 1 USDC local withdrawal proof is preserved in `deployments/arc-testnet.json`. The original CCTP path was broken by an ABI return-value mismatch (Arc returns no data); the hotfix removes that return declaration and uses finality threshold `2000`.

This proves the deposit → vault → CCTP burn → attestation loop. It does **not** replace an audit or
adversarial testing.

## Mainnet E2E evidence (October 21, 2026)

Real USDC on Arc mainnet, signed by the owner wallet through the app:

- Approve (unlimited, one-time pattern): [`0xce4676…e375`](https://explorer.arc.io/tx/0xce4676932a01655966cccadb6aaa430ae617dac02dde65acab380f04c19de375).
- Deposit 5 USDC: [`0xf48c28…0225`](https://explorer.arc.io/tx/0xf48c28d10b8c1d4c25b0b27fb19f6ce0df3c02abbea4f88551dc6b353fc50225) → `DepositRecorded` with `5,000,000`, domain `26`, vault `1`, `4,996,584,486,017,754,953` shares.
- `withdrawLocal` 1 USDC: [`0x5caf81…76b0`](https://explorer.arc.io/tx/0x5caf815a39ea83f9c7b77a6933183bedaf7417c5397f6c9c7506acf314d276b0) → `WithdrawalToWallet` with `999,999` and `999,316,858,421,847,964` shares burned.
- Post-state: principal `4.000001`, shares `3,997,267,627,595,906,989`, `getTotalBalance` `4` USDC,
  wallet `9.286509` USDC. The 1-unit difference is ERC-4626 share-price rounding, not a loss.

The mainnet stack includes the zero-share guard and was rehearsed on a mainnet fork. A live mainnet
CCTP burn → Iris attestation → destination mint is still untested. The testnet destination Sepolia
mint is pending gas; see `scripts/complete-cctp.ts`.

## Invariants

- `deployedPrincipal <= principal`.
- `vaultShares` only change through the adapter.
- A withdrawal cannot exceed `getTotalBalance(agent)` (resolved before transfer/burn).
- Spending limits are checked on the **resolved** amount, including `max` withdrawals.
- `getTotalBalance` never reverts (try/catch around the vault preview).
- Malformed CCTP hook data routes funds to the fallback beneficiary instead of reverting the mint.
- All state-changing entry points are `nonReentrant`.

## Known gaps / accepted risks

1. **Spending limits are not owner-bounded.** `setSpendingLimit` is callable by the agent or owner, so an agent can raise or clear a limit the owner set. Limits are an agent-safety feature, not an owner-enforced custody control. A production version should add owner-set ceilings (`maxDailyLimit`, `maxWeeklyLimit`) and reset windows explicitly.
2. **Owner is trusted.** A malicious/compromised owner can point the treasury at a malicious adapter or pause withdrawals. Ownership is `Ownable2Step`, so a mistaken transfer must be accepted; a compromised key is still a full compromise. A production version should use a multisig/timelock.
3. **CCTP body layout assumptions.** The receiver tolerates versioned (228-byte fixed fields) and unversioned (224-byte) `BurnMessageV2` layouts and reads `hookData` with a bounds-checked length word. This matches Circle's documented layout at the time of writing but has not been fuzz-tested against live mainnet messages.
4. **No automatic Iris relay.** Outbound withdrawals burn on Arc; the destination mint requires a relayer or manual `receiveMessage` with the attestation. The UI surfaces the attestation path but does not run a relayer.
5. **Circle Gateway is not live.** The treasury has a `gatewayReceiver` hook and the UI is honest about it, but unified Gateway balances require a server-side API key and are not implemented. No fake Gateway numbers are shown.
6. **APY is an owner-set cache.** `vaultAPY(1)` is a display value (mainnet `2.65%`, testnet `4.2%`), not an on-chain oracle. The UI labels projections as estimates.
7. **Event history is bounded.** The activity scanner starts at the configured deployment block and reads 9,000-block chunks; it skips RPC-limited chunks, so very old history is not indexed.
8. **CSV export is not sanitized for spreadsheet formula injection.** Only export events you trust; args are JSON-encoded.
9. **No formal verification or fuzzing of the full state machine.** Foundry unit/invariant tests cover the main paths (81 tests, including a mainnet fork rehearsal) but not all adversarial sequences.
10. **Frontend has no backend and no secrets.** All writes are user-signed. A compromised RPC can lie about reads; verify critical transactions on the explorer.

## Post-mainnet hardening checklist

- [x] Mainnet deployment with guarded wiring and on-chain verification.
- [x] Mainnet fork rehearsal of the exact deploy sequence.
- [x] Zero-share guard in the mainnet adapter.
- [x] Live mainnet deposit / local withdrawal proof (5 USDC in, 1 USDC out, October 21, 2026).
- [ ] Live mainnet CCTP withdrawal + destination mint proof.
- [ ] Independent review / audit of `AgentTreasury`, `MorphoVaultAdapter`, `CCTPReceiver`.
- [ ] Owner-bounded spending limits.
- [ ] Multisig/timelock owner and a dedicated keeper key.
- [ ] Live CCTP message decoding tests against mainnet messages.
- [ ] Iris relay service (or documented manual runbook).
- [ ] Gateway integration with a server-side key, or remove the hook from the UI copy.
- [ ] Per-vault caps and a reviewed mainnet vault allowlist.
- [ ] Incident runbook: pause, ownership recovery, user communication.
