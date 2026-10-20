# Security notes

> **Status: unaudited, testnet-only.** Do not custody real funds with this build.

## Trust model

| Actor | Can | Cannot |
|---|---|---|
| Agent (end user) | Deposit, withdraw locally, request CCTP withdrawal, change its own vault, set its own spending limits | Touch another agent's account |
| Owner | Act for any agent, pause, set adapter/receiver, set keeper, set max delay, set default vault/fee | Mint USDC, bypass a funded balance |
| Keeper | Rebalance, execute withdrawal bookkeeping, record message hashes | Initiate withdrawals, change limits, move funds to itself |
| CCTP MessageTransmitter | Call `CCTPReceiver.handleReceiveMessage` | Call treasury directly except through the receiver |
| Anyone | `deposit()` for themselves | Withdraw for anyone else |

The keeper separation is enforced and covered by regression tests: a keeper cannot call `requestWithdrawal` or `setSpendingLimit` for another agent.

## Testnet E2E evidence

The hotfix contracts moved real testnet USDC through the live Morpho Earn Kit vault and outbound CCTP:

- Deposit 10 USDC: [`0xbab58770…04c4`](https://explorer.testnet.arc.io/tx/0xbab5877074904d17fb21b49aed8c3d2a956ee8d16d3ddc3ec523046d464a04c4) → balance `9,999,999`, `9,989,427,554,595,819,468` shares (18 dec).
- CCTP withdrawal 1 USDC to domain 0: [`0x3f0f2568…8a1c`](https://explorer.testnet.arc.io/tx/0x3f0f256843ee4e1498cafceea9978725397904899bb527f684eb98c171e28a1c) → withdrawal id `1`, burned `999,999`, `MessageSent` finality `2000`, Iris attestation `complete`.
- APY: `vaultAPY(1) = 4.2e16`.

The earlier 10 USDC deposit / 1 USDC local withdrawal proof is preserved in `deployments/arc-testnet.json`. The original CCTP path was broken by an ABI return-value mismatch (Arc returns no data); the hotfix removes that return declaration and uses finality threshold `2000`.

This proves the deposit → vault → CCTP burn → attestation loop, but it does **not** replace an audit, mainnet rehearsal, or adversarial testing. The destination Sepolia mint is pending gas; see `scripts/complete-cctp.ts`.

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
6. **APY is an owner-set cache.** `vaultAPY(1) = 4.2e16` is a display value, not an on-chain oracle. The UI labels projections as estimates.
7. **Event history is bounded.** The activity scanner reads the last 90,000 blocks in 9,000-block chunks and silently skips RPC-limited chunks. Older history is not indexed.
8. **CSV export is not sanitized for spreadsheet formula injection.** Only export events you trust; args are JSON-encoded.
9. **No formal verification or fuzzing of the full state machine.** Foundry unit/invariant tests cover the main paths (80 tests) but not all adversarial sequences.
10. **Frontend has no backend and no secrets.** All writes are user-signed. A compromised RPC can lie about reads; verify critical transactions on the explorer.

## Pre-mainnet checklist

- [ ] Independent review / audit of `AgentTreasury`, `MorphoVaultAdapter`, `CCTPReceiver`.
- [ ] Owner-bounded spending limits.
- [ ] Multisig/timelock owner.
- [ ] Live CCTP message decoding tests against mainnet messages.
- [ ] Iris relay service (or documented manual runbook).
- [ ] Gateway integration with a server-side key, or remove the hook from the UI copy.
- [ ] Mainnet vault allowlist and per-vault caps.
- [ ] Incident runbook: pause, ownership recovery, user communication.
