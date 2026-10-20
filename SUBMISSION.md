# Agent Treasury — Submission

## One-liner

**A cross-chain USDC treasury for AI agents that earns Morpho yield on Arc and moves money with CCTP v2.**

## Problem

AI agents increasingly pay for compute, data, and services. But they hold funds in plain EOAs: no yield, no spending controls, no cross-chain mobility, and no audit trail a human can inspect. Giving an autonomous agent an unlimited private key is both unsafe and capital-inefficient.

## Solution

Agent Treasury gives each agent a dedicated on-chain account on Arc with four primitives:

1. **Deposit** — direct Arc USDC (`deposit`) or inbound CCTP v2 (`CCTPReceiver` → `recordDeposit`).
2. **Earn** — idle USDC is deployed to an allowlisted Morpho/Earn Kit vault through `MorphoVaultAdapter` (~4.2% APY on testnet).
3. **Withdraw** — instant same-chain (`withdrawLocal`) or cross-chain CCTP burn (`requestWithdrawal`).
4. **Control** — daily/weekly spending limits, keeper separation, pause, two-step ownership.

The dashboard makes the agent's balance sheet legible: total value, principal, yield, shares, chain breakdown, and a decoded event history with CSV export.

## Arc Studio

The entire project was built in Arc Studio: contracts, Foundry tests, deployment scripts, frontend, and docs. The app is a Vite + React + wagmi client that reads Arc directly; there is no backend or server-held key.

## Circle products

| Product | How it is used |
|---|---|
| **CCTP v2 Fast Transfer** | Outbound `depositForBurnWithHook` with fast finality; inbound hook receiver that routes minted USDC to the agent's treasury. |
| **Earn Kit (Morpho on Arc)** | Vault 1 is the Earn Kit USDC vault (`0xAabbeF1D...8E88`), deposited/redeemed through the adapter. |
| **Gateway** | `gatewayReceiver` hook and UI surface are present, but live unified balances need a server-side API key and are not faked. Roadmap item. |

## What is live

- **Arc Testnet contracts** (deployed):
  - AgentTreasury `0x9b390bb10bd30a25b5a07dfb9e0a058d7993ae0d`
  - MorphoVaultAdapter `0xe1dafeef6762c672bb5e4a8ff62c3812e111b2e3`
  - CCTPReceiver `0x7697c83c23339ccfdcf2d8e979b26ee5d731e7ee`
- **Wiring:** complete — 9 configure transactions; adapter, receiver, vault 1, keeper, and default vault are live. APY corrected to `4.2e16` on-chain.
- **E2E proof:** real 10 USDC deposit → `9,989,427,554,789,604,143` shares; real 1 USDC withdrawal. Deposit tx `0xa4fc0034c4f2c20a9f308a705fe1439f281981f6b24466a8aff148f1b5b3a520`; withdraw tx `0x27cf6628ffb0d1e3ce45f9d542bc065169b3cc98b28c23c8a09d64e50f11b826`.
- **Tests:** 80 Foundry tests (unit + invariants) and 36 Vitest tests; frontend lint/typecheck/build clean.
- **App:** 6 tabs, live reads, approve/deposit, local withdraw, CCTP outbound form, event history, spending-limit settings.

## Judging map

| Criterion | Evidence |
|---|---|
| **Functionality (25%)** | Deposit → yield → withdraw loop; spending limits; pause; keeper separation; CCTP outbound; 80 contract tests. |
| **Arc Studio usage (25%)** | Contracts, tests, deploy scripts, frontend, and docs all generated iteratively in one Arc Studio project; deployment records in `deployments/arc-testnet.json`. |
| **Real USDC on Arc (30%)** | **Testnet E2E verified with real USDC**: 10 USDC deposited into the live Earn Kit Morpho vault, 1 USDC withdrawn to the wallet, both with on-chain tx hashes. Mainnet is gated on a funded deployer + audit (see limitations). |
| **Circle product depth (20%)** | CCTP v2 inbound/outbound with hook data; Earn Kit/Morpho vault; Gateway-ready receiver hook. |

## Honest limitations

- Contracts are **unaudited** and testnet-only.
- **Mainnet is not deployed.** Real mainnet USDC movement requires a funded mainnet deployer; that is a human funding/ops step, not a code step.
- **Spending limits are not owner-bounded**: an agent can raise its own limit. This is documented in `docs/SECURITY.md` and is the first post-hackathon fix.
- **No automatic Iris relay** for destination mints; the UI surfaces the attestation path.
- **Gateway is not live** (server key required) and is not faked in the UI.

## Repo / demo

- Code: this repository
- App preview: Arc Studio project `459b639e-b500-4f59-b057-aa17f5446888`
- Demo video: _link_
- Deck: _link_

## Roadmap

1. Owner-bounded spending limits + multisig/timelock owner.
2. Iris relay service and destination auto-mint.
3. Gateway unified balance (server-side key) + cross-chain gas abstraction.
4. Mainnet deployment after audit; per-vault caps and a conservative vault allowlist.
5. Agent SDK: `treasury.deposit()`, `treasury.withdraw()`, `treasury.setPolicy()` with signed intents.

## Team

_Solo builder — add name/contact here._
