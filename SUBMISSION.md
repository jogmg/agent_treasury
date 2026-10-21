# Agent Treasury — Submission

## One-liner

**A cross-chain USDC treasury for AI agents that earns Morpho yield on Arc and moves money with CCTP v2.**

## Problem

AI agents increasingly pay for compute, data, and services. But they hold funds in plain EOAs: no yield, no spending controls, no cross-chain mobility, and no audit trail a human can inspect. Giving an autonomous agent an unlimited private key is both unsafe and capital-inefficient.

## Solution

Agent Treasury gives each agent a dedicated on-chain account on Arc with four primitives:

1. **Deposit** — direct Arc USDC (`deposit`) or inbound CCTP v2 from Ethereum/Base/Arbitrum/OP/Avalanche/Polygon: source burn → mint to the Arc wallet → `deposit()` into the agent treasury.
2. **Earn** — idle USDC is deployed to an allowlisted Morpho/Earn Kit vault through `MorphoVaultAdapter` (~2.65% net APY with Galaxy USDC on Arc mainnet).
3. **Withdraw** — instant same-chain (`withdrawLocal`) or cross-chain CCTP burn (`requestWithdrawal`).
4. **Control** — daily/weekly spending limits, keeper separation, pause, two-step ownership.

The dashboard makes the agent's balance sheet legible: total value, principal, yield, shares, chain breakdown, and a decoded event history with CSV export.

## Arc Studio

The entire project was built in Arc Studio: contracts, Foundry tests, deployment scripts, frontend, and docs. The app is a Vite + React + wagmi client that reads Arc directly; there is no backend or server-held key.

## Circle products

| Product | How it is used |
|---|---|
| **CCTP v2** | Outbound `depositForBurnWithHook` with standard finality (`2000`) for reliable Arc-origin attestations; inbound source-chain burn → mint to the Arc wallet → treasury `deposit()`. CCTP v2 hooks are opaque metadata, so the app does not rely on automatic hook execution; `CCTPReceiver` is a tested relayer adapter for future source-domain accounting. |
| **Earn Kit (Morpho on Arc)** | Mainnet vault 1 is Galaxy USDC (`0x8E357432...12AF`, ~2.65% net APY), deposited/redeemed through the adapter. The testnet build uses the ~4.2% demo vault `0xAabbeF1D...8E88`. |
| **Gateway** | `gatewayReceiver` hook and UI surface are present, but live unified balances need a server-side API key and are not faked. Roadmap item. |

## What is live

### Arc mainnet (deployed October 21, 2026)

- **AgentTreasury** `0xf71b5d1a19d72b98675785123fae811698be6f63`
- **MorphoVaultAdapter** `0x5102057330f5bb5f3e4eb0925b7d1eac8a563c23`
- **CCTPReceiver** `0x91f1eb97a40fdab05d150c10566cf9aa3546a375`
- **Vault 1:** Galaxy USDC `0x8E357432CC12ff425c36432F312968aEb16112AF` (`arcUSDC`), ~2.65% net APY,
  0 fees, ~12.2M USDC instant liquidity.
- **Wiring:** complete and independently verified on-chain — owners/keepers, adapter/receiver links,
  mainnet CCTP (`0x28b5...cf5d` / `0x81D4...B64`), domain `26`, default vault `1`, both contracts
  unpaused, vault asset USDC, APY `2.65%`.
- **Guardrails (unaudited):** vault minimum **5 USDC**, owner spending limit **25 USDC/day,
  50 USDC/week**, keeper = owner EOA for launch.
- **Deploy rehearsal:** the exact 10-tx sequence passed on a live Arc mainnet fork
  (`MainnetDeploy.t.sol`, 5,761,118 gas).
- **Live mainnet E2E:** 5 USDC deposited into Galaxy USDC (tx
  `0xf48c28d10b8c1d4c25b0b27fb19f6ce0df3c02abbea4f88551dc6b353fc50225`,
  `4,996,584,486,017,754,953` shares), then 1 USDC withdrawn locally (tx
  `0x5caf815a39ea83f9c7b77a6933183bedaf7417c5397f6c9c7506acf314d276b0`, resolved `0.999999`,
  `999,316,858,421,847,964` shares burned). Post-state: principal `4.000001`, shares
  `3,997,267,627,595,906,989`, `getTotalBalance` `4` USDC.
- **Live mainnet CCTP round trip:** two Arc→Base withdrawals (1.999999 and 4.999999 USDC) burned,
  got complete production Iris attestations, and minted on Base (`0x58c3eb…59fa`, `0x68045f…7609`,
  relayed by `0xecfe41…c717`). Then 5 USDC burned on Base (`0xadf19a…b280`), minted on Arc
  (`0xb2a7ba…246c`), and deposited into Galaxy USDC (`0xb1e34e…026b`,
  `4,996,555,771,054,222,485` shares). Post-state: principal `9.000003`, total `9.000028` USDC.
- Full record: `deployments/arc-mainnet.json`.

### Arc testnet (E2E proven)

- **AgentTreasury** `0x5e2e3da19533ebf85bc916612eff5cdc7bf4d489`
- **MorphoVaultAdapter** `0x333deccbf9091540e849b7af80f2f10b72197b71`
- **CCTPReceiver** `0x8066bcf8e6b17e2d84082179a89f0972cc6e31c1`
- **Wiring:** complete at block `68193025`. `vaultAPY(1) = 4.2e16`.
- **CCTP fix:** Arc's TokenMessengerV2 returns no data; the original interface's `uint64` return
  caused a post-burn ABI-decode revert. The fixed treasury uses a no-return interface and finality
  threshold `2000`. Mainnet shipped with the fix.
- **E2E proof:** real 10 USDC deposit → `9,989,427,554,595,819,468` shares; real 1 USDC CCTP
  withdrawal from yield to destination domain `0`. Deposit tx
  `0xbab5877074904d17fb21b49aed8c3d2a956ee8d16d3ddc3ec523046d464a04c4`; withdrawal tx
  `0x3f0f256843ee4e1498cafceea9978725397904899bb527f684eb98c171e28a1c`; burned `999,999`;
  `MessageSent` finality `2000`; Circle Iris attestation `complete`.
- **Destination mint proof:** 4.999999 USDC minted on Ethereum Sepolia to
  `0x72Cbd56507699F5002A10aCdDC5D20b4C2207a75`; Sepolia tx
  `0x843c07455e2c44dffaf174af6cc850810c9fc71ffb197a5f8033175b3f32e50f`. The earlier 1 USDC
  transfer is still awaiting Sepolia gas (`scripts/complete-cctp.ts`).
- **Tests:** 81 Foundry tests (unit + invariants + mainnet fork rehearsal), 52 Vitest tests;
  frontend lint/typecheck/build clean.
- **App:** 6 tabs, live reads, approve/deposit, collapsible cross-chain CCTP deposits, local
  withdraw, CCTP outbound form with chain-name destination dropdown, labeled event history
  (CCTP Deposit / CCTP Withdrawal / Local Withdraw) with All / In flight / Deposits / Withdrawals /
  Yield filters, growth chart with time ranges, spending-limit settings, ownership acceptance.

## Judging map

| Criterion | Evidence |
|---|---|
| **Functionality (25%)** | Deposit → yield → withdraw loop; spending limits; pause; keeper separation; CCTP outbound; 81 contract tests. |
| **Arc Studio usage (25%)** | Contracts, tests, deploy scripts, frontend, and docs all generated iteratively in one Arc Studio project; deployment records in `deployments/arc-mainnet.json` and `deployments/arc-testnet-fixed.json`. |
| **Real USDC on Arc (30%)** | **Both networks proven with real USDC, including cross-chain.** Mainnet: local deposit/withdraw plus a full CCTP round trip — Arc→Base withdrawals attested and minted, Base→Arc 5 USDC burn/mint/deposit. Testnet: 10 USDC deposited into the live Morpho vault, then 1 USDC withdrawn from yield through CCTP to domain 0; source burn and finalized Iris attestation confirmed, with a completed Sepolia destination mint. |
| **Circle product depth (20%)** | CCTP v2 inbound/outbound on both networks; Earn Kit/Morpho vault; Gateway-ready receiver hook. |

## Honest limitations

- Contracts are **unaudited**. Mainnet is live with deliberately low limits and only the owner's funds.
  Do not custody third-party funds before an audit.
- **Withdrawal bookkeeping is not automatic.** The two completed mainnet CCTP requests are still
  `executed=false` on-chain because the app never calls `executeWithdrawal`; funds are unaffected, but
  a keeper call is needed to clear pending ids 1–2. The app has no button for this yet.
- **Destination mints still need destination-chain gas or a relayer.** The app polls Iris and can
  submit `receiveMessage`, but cannot pay destination gas. In the live mainnet round trip an external
  relayer submitted both Base mints. The 4.999999 USDC Sepolia mint is complete; the earlier testnet
  1 USDC transfer is awaiting Sepolia gas. `scripts/complete-cctp.ts` is the headless fallback.
- **Spending limits are not owner-bounded**: an agent can raise its own limit. This is documented in
  `docs/SECURITY.md` and is the first post-hackathon fix.
- **Cross-chain deposits are wallet-mediated.** CCTP v2 hooks are opaque metadata, so the app mints to
  the connected Arc wallet and then calls `deposit()`. On-chain `chainDeposits` records the deposit as
  Arc-local; source-domain accounting via `CCTPReceiver` needs a relayer/forwarder and is future work.
- **Gateway is not live** (server key required) and is not faked in the UI.
- The pre-hotfix testnet treasury still exists on-chain; the UI recovery card was retired because no
  tracked funds remain there.

## Repo / demo

- Code: this repository
- App preview: https://studio.arc.io/app/459b639e-b500-4f59-b057-aa17f5446888
- Demo video: _link_
- Deck: _link_

## Roadmap

1. Owner-bounded spending limits + multisig/timelock owner.
2. Iris relay service and destination auto-mint.
3. Gateway unified balance (server-side key) + cross-chain gas abstraction.
4. External audit, then raise mainnet caps and onboard third-party agents.
5. Agent SDK: `treasury.deposit()`, `treasury.withdraw()`, `treasury.setPolicy()` with signed intents.

## Team

_Solo builder — add name/contact here._
