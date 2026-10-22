# CCTPReceiverV2 deployment (MetaMask)

This page deploys the corrected inbound CCTP receiver and points the existing
`AgentTreasury` at it. It does **not** redeploy the treasury and does **not**
move any funds.

## Build

```bash
forge build
node scripts/receiver-deploy/build.mjs
```

The build injects `contracts/out/CCTPReceiverV2.sol/CCTPReceiverV2.json` into
`index.html`. Re-run it after every contract change.

## Serve

Use any static server. For example:

```bash
npx serve scripts/receiver-deploy
```

Open the printed URL in a browser with MetaMask. The page works on Arc mainnet
(5042) and Arc testnet (5042002); select the network before connecting.

## What the page does

1. Connects MetaMask and switches to the selected Arc network.
2. Verifies the connected wallet is the treasury owner.
3. Checks the treasury, Arc `MessageTransmitterV2`, and USDC have code.
4. Deploys `CCTPReceiverV2(owner, transmitter, USDC, treasury)`.
5. Verifies the receiver's `trustedTransmitter`, `usdc`, `treasury`,
   `ARC_DOMAIN == 26`, and `owner`.
6. Calls `treasury.setGatewayReceiver(newReceiver)`.
7. Re-reads `treasury.gatewayReceiver()` and requires it to equal the new
   receiver.

If deployment succeeds but wiring fails, paste the deployed receiver into
“Wire an existing receiver” and retry. The page never redeploys in that path.

## Safety

- No private key is requested or stored. Every transaction is signed in
  MetaMask.
- The old receiver is abandoned, not upgraded. Do not point new burns at it.
- New inbound burns must use:
  - `mintRecipient = new receiver`
  - `destinationCaller = new receiver`
  - `hookData = abi.encode(agent)`
- The treasury owner must be the connected wallet. The page refuses to wire
  otherwise.
- The page verifies the existing receiver is non-zero before deploying, so it
  cannot silently replace an unknown configuration.

## After deployment

Record the receiver address and transaction hashes in
`deployments/arc-mainnet.json` / `deployments/arc-testnet-fixed.json`, then set
`VITE_RECEIVER_ADDRESS` for the app build (or update the default in
`src/lib/contracts.ts`). Run a small live source-chain burn and confirm:

- the Arc receiver transaction credits the agent;
- `DepositRecorded.sourceDomain` is the real source domain (e.g. Base `6`);
- the receiver's USDC balance is `0` after processing.
