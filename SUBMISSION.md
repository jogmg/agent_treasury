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
| **CCTP v2** | Outbound `depositForBurnWithHook` with standard finality (`2000`) for reliable Arc-origin attestations; inbound hook receiver that routes minted USDC to the agent's treasury. |
| **Earn Kit (Morpho on Arc)** | Vault 1 is the Earn Kit USDC vault (`0xAabbeF1D...8E88`), deposited/redeemed through the adapter. |
| **Gateway** | `gatewayReceiver` hook and UI surface are present, but live unified balances need a server-side API key and are not faked. Roadmap item. |

## What is live

- **Arc Testnet contracts** (hotfix deployment):
  - AgentTreasury `0x5e2e3da19533ebf85bc916612eff5cdc7bf4d489`
  - MorphoVaultAdapter `0x333deccbf9091540e849b7af80f2f10b72197b71`
  - CCTPReceiver `0x8066bcf8e6b17e2d84082179a89f0972cc6e31c1`
- **Wiring:** complete — adapter, receiver, vault 1, keeper, and default vault are live at block `68193025`. `vaultAPY(1) = 4.2e16`.
- **CCTP fix:** Arc's TokenMessengerV2 returns no data; the original interface's `uint64` return caused a post-burn ABI-decode revert. The fixed treasury uses a no-return interface and finality threshold `2000`.
- **E2E proof:** real 10 USDC deposit → `9,989,427,554,595,819,468` shares; real 1 USDC CCTP withdrawal from yield to destination domain `0` and the connected wallet. Deposit tx `0xbab5877074904d17fb21b49aed8c3d2a956ee8d16d3ddc3ec523046d464a04c4`; withdrawal tx `0x3f0f256843ee4e1498cafceea9978725397904899bb527f684eb98c171e28a1c`; burned `999,999`; `MessageSent` finality `2000`; Circle Iris attestation `complete`. Destination mint is pending Sepolia gas.
- **Tests:** 80 Foundry tests (unit + invariants) and 36 Vitest tests; frontend lint/typecheck/build clean.
- **App:** 6 tabs, live reads, approve/deposit, local withdraw, CCTP outbound form, event history, spending-limit settings, legacy-treasury recovery, ownership acceptance.

## Judging map

| Criterion | Evidence |
|---|---|
| **Functionality (25%)** | Deposit → yield → withdraw loop; spending limits; pause; keeper separation; CCTP outbound; 80 contract tests. |
| **Arc Studio usage (25%)** | Contracts, tests, deploy scripts, frontend, and docs all generated iteratively in one Arc Studio project; deployment records in `deployments/arc-testnet-fixed.json`. |
| **Real USDC on Arc (30%)** | **Testnet E2E verified with real USDC**: 10 USDC deposited into the live Earn Kit Morpho vault, then 1 USDC withdrawn from yield through CCTP to destination domain 0; source burn and finalized Iris attestation both confirmed. Mainnet is gated on a funded deployer + audit (see limitations). |
| **Circle product depth (20%)** | CCTP v2 inbound/outbound with hook data; Earn Kit/Morpho vault; Gateway-ready receiver hook. |

## Honest limitations

- Contracts are **unaudited** and testnet-only.
- **Mainnet is not deployed.** Real mainnet USDC movement requires a funded mainnet deployer; that is a human funding/ops step, not a code step.
- **Spending limits are not owner-bounded**: an agent can raise its own limit. This is documented in `docs/SECURITY.md` and is the first post-hackathon fix.
- **No automatic Iris relay** for destination mints. The 1 USDC test withdrawal is attested but the Sepolia mint is pending destination gas; `scripts/complete-cctp.ts` finishes it once the recipient is funded.
- **Gateway is not live** (server key required) and is not faked in the UI.
- The pre-hotfix treasury still holds testnet USDC; the UI exposes a local-only recovery card.

## Repo / demo

- Code: this repository
- App preview: https://studio.arc.io/app/459b639e-b500-4f59-b057-aa17f5446888
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
