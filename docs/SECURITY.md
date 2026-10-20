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

The deployed contracts moved real testnet USDC through the live Morpho Earn Kit vault:

- Deposit 10 USDC: [`0xa4fc0034…3a520`](https://explorer.testnet.arc.io/tx/0xa4fc0034c4f2c20a9f308a705fe1439f281981f6b24466a8aff148f1b5b3a520) → `9,989,427,554,789,604,143` shares (18 dec), `previewRedeem` `9,999,999`.
- Withdraw 1 USDC: [`0x27cf6628…1b826`](https://explorer.testnet.arc.io/tx/0x27cf6628ffb0d1e3ce45f9d542bc065169b3cc98b28c23c8a09d64e50f11b826) → total `9,000,000`, wallet `+991,307` (rest is gas).
- APY fix: [`0x36f5c8a7…3243e`](https://explorer.testnet.arc.io/tx/0x36f5c8a7575ebab7a8bdc49bc732a9587e452b10bab7c8b38b1b30e51ba3243e) → `vaultAPY(1) = 4.2e16`.

This proves the deposit → vault → redeem → transfer loop, but it does **not** replace an audit, mainnet rehearsal, or adversarial testing.

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
