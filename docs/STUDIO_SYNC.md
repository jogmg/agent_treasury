# Arc Studio sync and preview checklist

This checklist keeps the existing Arc Studio project credible for the
Arc Microgrants submission without redeploying contracts or weakening
production security.

## Current sync status (2026-10-28)

- Source synchronized: `85f66b1`
- Studio app: `https://studio.arc.io/app/459b639e-b500-4f59-b057-aa17f5446888`
- Studio checks: typecheck 0 errors, **85 frontend tests passing**, build success
- Preview host: `ijwomt0218q2klpx2zr03.preview.studio.arc.io`
  (403 without an authenticated Studio session)
- Studio source matches the repository ignoring CRLF
- Production deploy: `85f66b1`, Actions run
  [40773695986](https://github.com/jogmg/glimmerlock/actions/runs/40773695986);
  only the frontend was recreated
- Studio deployment panel: six historical Arc Testnet deployments only; no
  fabricated mainnet records
- Studio usage after the sync: **32%** of the reported rolling window

## Why the Studio UI looks different

Arc Studio builds and deploys to **Arc testnet**. Its documentation says it
does not deploy to mainnet on the builder's behalf. The Studio deployments panel
is therefore a registry of Studio CLI/testnet deployments, not a mainnet
explorer.

The production Glimmerlock contracts were deployed externally with the owner
wallet. Their authoritative record is:

- `deployments/arc-mainnet.json`
- `https://explorer.arc.io/`
- the live app at
  `https://8080-agqvtg5gwokf3k7e5easq4hd5e.instabox.tech`

Do not redeploy `AgentTreasury`, `MorphoVaultAdapter`, or `CCTPReceiverV2` just
to populate the Studio panel. Do not invent a Studio mainnet deployment record.

## Non-negotiable rules

- Use the existing app:
  `https://studio.arc.io/app/459b639e-b500-4f59-b057-aa17f5446888`
- Do not create a replacement Arc Studio app.
- Do not run `arc-studio upgrade`.
- Do not deploy contracts or change mainnet wiring during the sync.
- Do not put secrets, `.env` values, API keys, or private keys in Studio or git.
- Do not expose the BFF, relax CORS, or publish Hermes/Postgres/MCP just to make
  the Studio preview work.
- Keep InstaBox as the functional production demo. Studio is the build
  provenance; the public app is the working app.

## Evidence chain

| Requirement | Evidence to submit or show |
| --- | --- |
| Built in Arc Studio | Existing Studio project URL, source, contract tests |
| Mainnet deployment | Explorer contract addresses and `deployments/arc-mainnet.json` |
| Working app | InstaBox public URL |
| USDC movement | A real Arc mainnet transaction hash |
| Walkthrough | Studio project + public app + explorer transaction |
| Source | `https://github.com/jogmg/glimmerlock` |

## Preflight

1. Recheck the live hackathon rules and deadline.
2. Confirm the local tree is clean and pushed:
   `git status --short`
3. Confirm the current production app is up before changing anything:
   - `/` returns `200` with the Glimmerlock title
   - `/health` returns `200`
   - `/api/session` returns `200`
4. Check Studio credit usage before spending a turn:
   `arc-studio usage`
5. Back up the current Studio workspace to a temporary directory, not over the
   repository:
   `arc-studio pull --app 459b639e-b500-4f59-b057-aa17f5446888 --out <temp-dir>`
6. Record the current Studio deployment list:
   `arc-studio deployments --app 459b639e-b500-4f59-b057-aa17f5446888`
   It is expected to show historical testnet deployments only.

## Sync steps

### 1. Make the repository the source of truth

Commit and push the current frontend, docs, and deployment records to
`jogmg/glimmerlock`. The old `jogmg/agent_treasury` URL redirects, but use the
new URL in the submission.

### 2. Update the existing Studio app

The CLI has no `push` command. Use the cheapest supported path for the existing
app:

- Prefer Studio's GitHub import/refresh if it updates the existing app in place.
- Otherwise use one explicit, file-scoped agent turn after the backup, for
  example:
  `arc-studio run --app 459b639e-b500-4f59-b057-aa17f5446888 -f src:src -f public:public -f index.html:index.html`
- Instruct the turn to **replace files only** and not to generate features,
  deploy contracts, or change configuration.
- Do not use a broad "rebuild the app" prompt. That consumes credits and creates
  unnecessary drift.

Minimum files to confirm in Studio:

- `index.html`
- `public/`
- `src/App.tsx`
- `src/components/Header.tsx`
- `src/lib/studioPreview.ts`
- `src/lib/contracts.ts`
- `src/stores/ui.ts`
- `deployments/arc-mainnet.json`
- the current contract sources and tests

Verify with read-only commands rather than assuming:

`arc-studio ls --app ...`
`arc-studio cat --app ... src/lib/studioPreview.ts`

### 3. Configure preview mode safely

Set only the non-secret preview flag in the Studio environment:

```text
VITE_STUDIO_PREVIEW=1
```

Remove or leave unset:

- `VITE_ARC_NETWORK=testnet` (Studio should use mainnet defaults)
- stale treasury/receiver address overrides
- `VITE_BFF_URL` (the Studio sandbox has no production BFF)

Do not add any secret to the Studio environment. If Studio exposes a preview
URL field, adding `?studioPreview=1` is an alternative to the env flag.

### 4. Build and test in Studio

Run the Studio checks for the changed frontend:

```bash
npm run typecheck
npm test
npm run build
```

Expected after the preview patch: **85 frontend tests** locally. Treat the
Studio-reported count separately and record what Studio actually reports.

Do not run `forge script` or any deploy command.

### 5. Verify the preview

- The preview opens on **Overview**, not Chat.
- The Chat item is absent from the menu.
- The banner says this is the Arc Studio preview and links to the live app.
- The browser console has no `/api/session`, `/api/chat`, or `/api/intents`
  requests on initial load.
- Treasury/Activity reads either work with an injected wallet or render safely
  without one.
- The page does not depend on the InstaBox nginx proxy or Postgres.

If wallet injection is unavailable in the Studio iframe, do not fight it. The
preview remains a source-inspection surface; the live app is the transaction
demo. If the wallet is injected, core direct wallet actions may still work, but
Chat and Hermes-authenticated drafts belong in the live app.

### 6. Confirm the deployment panel is still honest

Run the deployment list again. If it still shows only historical testnet
records, that is acceptable and expected. Do not force mainnet rows.

Optional, low priority: append factual mainnet metadata to
`contracts/contract-metadata/*.json` only if the Studio schema accepts a
mainnet chain and the entry is clearly marked as an external owner-wallet
deployment. The Studio server may not ingest metadata edited in the workspace,
so do not block submission on it.

### 7. Verify production after the code change

The preview patch changes the frontend bundle, so it needs the normal CI deploy:

1. Push to `main`.
2. Confirm the **Verify** and **Deploy** jobs pass.
3. Confirm only the frontend/nginx service is rebuilt or recreated.
4. Re-run the public checks:
   - `<title>Glimmerlock</title>`
   - `/health` `200`
   - `/api/session` `200`
   - Chat still opens in the production app, not preview mode.

## Submission wording

Use wording close to this, adjusted to what is actually verified:

> The contracts, tests, and app were built in Arc Studio. Arc Studio deploys to
> Arc testnet by design and does not deploy to mainnet on the builder's behalf.
> The production contracts were deployed to Arc mainnet with the owner's wallet;
> the addresses and transactions are recorded in `deployments/arc-mainnet.json`
> and linked from `explorer.arc.io`. The Studio deployment panel shows
> historical testnet runs only. The working app is live at the public InstaBox
> URL, and the Studio project remains the build-provenance link.

Do not claim that a later local-only feature was generated in Studio unless it
is actually present there. If the current feature is synced as source, describe
it as **built from the Arc Studio project** and note the sync date.

## Video script

1. Open the existing Arc Studio project and show the contract sources, tests,
   and current app files.
2. Show the public Glimmerlock app on InstaBox.
3. Show a real Arc mainnet transaction on `explorer.arc.io`.
4. State clearly that Studio builds/testnet-deploys and mainnet signing is
   owner-wallet based.
5. If possible, perform one fresh 5 USDC deposit during the recording; otherwise
   use a verified existing transaction and label it as historical.

## Acceptance criteria

- [ ] Existing Studio app updated; no replacement app.
- [ ] Preview opens on Overview and makes no BFF calls.
- [ ] Chat is hidden in preview; production chat still works.
- [ ] Live-app banner links to the InstaBox origin.
- [ ] Studio build/test results recorded.
- [ ] Deployment panel still shows only truthful records.
- [ ] Production deploy passes and public checks remain green.
- [ ] Submission contains Studio URL, public URL, contract addresses, tx hash,
      repo URL, and video.
