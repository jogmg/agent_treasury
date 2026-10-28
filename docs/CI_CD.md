# CI/CD and InstaBox deployment

The deployment path is GitHub Actions → InstaBox CLI → private Docker Compose.
Only source changes that affect a running service trigger a build or restart.
Server-only `.env` files are never copied into git, a release, or a workflow
log.

**Verified 2026-10-26; updated 2026-10-28.** The initial manual full deploy of
`16f5ef6` rebuilt/recreated the frontend, BFF, MCP, monitor, and both Hermes
profiles while leaving Postgres running. The first pushes (`c8256bf`,
`28c54cb`) exercised the no-op path because only CI/docs changed. Real
application changes have since exercised the targeted path through Actions:
`675dc36` (Glimmerlock rebrand), `100793b` (web image public assets),
`552192b` (chat scroll fix), and `85f66b1` (Arc Studio preview fallback) all
completed Verify + Deploy. The latest service-changing run,
[40773695986](https://github.com/jogmg/glimmerlock/actions/runs/40773695986),
passed both jobs, and the latest service deploy is `85f66b1`. That deploy
recreated only the frontend; the BFF remained up 10 hours and the other
services 2 days. A docs-only push still advances the marker without recreating
containers per the change map.

## Triggers

| Event | What runs |
| --- | --- |
| Pull request to `main` | Frontend/Hermes verification only. No deployment. |
| Push to `main` | Verification, then an InstaBox deployment of that exact commit. |
| Manual `workflow_dispatch` on `main` | Same as a push, with optional `dry_run`, `force_all`, and `target_sha` inputs. |

The workflow is `.github/workflows/ci-deploy.yml`. It needs the existing
repository secret `INSTABOX_API_KEY` (the same secret used by the manual
keepalive workflow). The key must be allowed to execute commands on the target
machine.

## Verification before deployment

`verify` runs:

- `npm ci --legacy-peer-deps`, `npm run check`, `npm test`, and `npm run build`
  at the repository root.
- `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` in `hermes/`.
- `bash -n` on both deployment scripts and `py_compile` on the profile-sync
  helper.

Contract changes are not deployed by this workflow. There is no on-chain
deployment step. Run `forge test` and any contract deployment or verification
separately.

## Deployment mechanics

1. The workflow uploads three small helpers to `/tmp` on the InstaBox machine:
   `instabox-bootstrap.sh`, `instabox-deploy.sh`, and
   `sync-profile-configs.py`.
2. The bootstrap fetches `origin/main` from the existing checkout at
   `/data/agent-treasury`. If that checkout is shallow, it fetches full history
   once so rollbacks can resolve older commits.
3. It verifies that the target SHA is a full 40-character commit reachable from
   `origin/main`, then extracts that exact tree with `git archive` into
   `/data/hermes-data/deploy/releases/<sha>`. The release is immutable.
4. The deploy helper symlinks the two server-only env files into the release:
   - `/data/agent-treasury/hermes/.env`
   - `/data/agent-treasury/hermes/profiles/user/.env`

   The Ops profile keeps its env in
   `/data/hermes-data/profiles/ops/.env`.
5. Changed paths are compared with the last successful deploy marker at
   `/data/hermes-data/deploy/state/last-deployed-sha`. The first deploy (or an
   explicit `force_all`) treats every tracked path as changed.
6. Only the affected services are built, migrated, and recreated. A successful
   health check is required before the marker advances.

The live checkout `/data/agent-treasury` is never reset, cleaned, or checked
out by the workflow. It remains the Git object store, the source of the live
`.env` files, and the server's existing working copy. Do not `git reset` or
`git clean` it to make a deploy pass.

## Change map

| Changed paths | Action |
| --- | --- |
| `src/**`, `index.html`, frontend configs, root package files, `hermes/nginx.conf`, `hermes/Dockerfile.web` | Build and recreate `frontend`. |
| `shared/**` | Build and recreate `frontend`, `bff`, `arc-mcp`, and `monitor`. |
| `hermes/src/bff/**` | Build the Hermes image and recreate `bff`. |
| `hermes/src/mcp/**` | Build the Hermes image and recreate `arc-mcp`. |
| `hermes/src/monitor/**` | Build the Hermes image and recreate `monitor`. |
| `hermes/src/db/**`, `hermes/migrations/**` | Build the Hermes image, run migrations, and recreate `bff`, `arc-mcp`, and `monitor`. |
| Other `hermes/src/**`, Hermes Dockerfile/package/tsconfig files | Build the Hermes image and recreate `bff`, `arc-mcp`, and `monitor`. |
| `hermes/profiles/ops/config.yaml` or `SOUL.md` | Sync the tracked profile file into the live Ops profile and recreate `hermes`. |
| `hermes/profiles/user/config.yaml` or `SOUL.md` | Sync the tracked profile file into the live User profile and recreate `hermes-user`. |
| `hermes/docker-compose.yml` | Apply Compose changes with `docker compose --profile web up -d`. |
| `.env.example` files | Warn only. Live `.env` files are server-only and are never modified. |
| Docs, contracts, deployments, CI files, Hermes tests/smoke scripts | No container change. The deploy marker still advances. |

The Hermes image is shared by `migrate`, `arc-mcp`, `monitor`, and `bff`.
Building the image once updates the tag; only the services selected above are
recreated on that deploy.

## Profile config sync

The repository owns `config.yaml` and `SOUL.md`, but Hermes also writes runtime
state into the live Ops config. The sync helper keeps a few live-only top-level
values when the repository does not define them:

- `_config_version`
- the Discord `platforms:` block (including the home channel)

This prevents a deploy from removing the Ops Discord binding. Each changed
live file is backed up as `*.bak-deploy-<timestamp>` before an atomic replace.
`.env` files are explicitly out of scope.

## Health gate and marker

After recreating anything, the deploy waits for:

- `postgres`, `arc-mcp`, `monitor`, `bff`, and `frontend` health checks;
- `hermes` and `hermes-user` running;
- the Ops `hermes status` gateway to report running on Discord;
- the User `hermes status` gateway to report running on `api_server`;
- `GET /` and `GET /health` on the host-published frontend port;
- unauthenticated `GET /api/session`.

The last-deployed SHA is written only after those checks pass. A failed deploy
leaves the previous marker in place, so the next run retries the same changes.
The current release plus the four newest releases are retained.

## Manual preview, full deploy, and rollback

Use **Actions → CI and InstaBox deploy → Run workflow** on `main`:

- `dry_run: true` extracts the release and prints the change plan and profile
  sync preview. It does not build, migrate, recreate a container, or advance
  the marker.
- `force_all: true` rebuilds and recreates every deployable service. Use it
  after a manual server drift or to validate the full path.
- `target_sha` deploys an older commit that is still reachable from
  `origin/main`. The workflow helpers come from the current `main`; the app
  tree comes from `target_sha`. Use the full 40-character SHA. The target must
  contain the Compose services the current deploy expects; roll back to a
  commit from the Phase 2 Compose era or later.

The server's shallow checkout is extended on the first deploy, so older
commits on `main` are available for rollback. A target on another branch is
rejected.

## Server paths

| Path | Purpose |
| --- | --- |
| `/data/agent-treasury` | Existing dirty checkout; Git object store and live `.env` source. Never reset or clean. |
| `/data/hermes-data/deploy/releases/<sha>` | Immutable source tree for one deployed commit. |
| `/data/hermes-data/deploy/state/last-deployed-sha` | Last successful deployment marker. |
| `/data/hermes-data/deploy/state/deploy.lock` | `flock` serialization for deploys. |
| `/data/hermes-data/profiles/ops` | Live Ops profile, including `.env`, `config.yaml`, and backups. |
| `/data/hermes-data/profiles/user` | Live User profile, including `.env`, `config.yaml`, and backups. |
| `/data/agent-treasury/hermes/.env` | Server-only BFF/MCP/monitor/Postgres env. |
| `/data/agent-treasury/hermes/profiles/user/.env` | Server-only User profile env. |

Do not print the contents of any `.env` file. If a deploy fails, inspect
`docker logs <container>` manually; the workflow deliberately does not dump
container logs that might contain provider or platform credentials.

## Limits

- `instabox exec` has a 600-second command limit. The deploy uses incremental
  Docker build layers and only rebuilds affected images. Keep the full path
  within that limit; split the deploy helper if a future image build makes it
  exceed 600 seconds.
- The Cloudflare Worker remains the primary idle-pause keepalive. GitHub Free
  schedule events are not relied on; this workflow is push/dispatch-driven.
- The server currently fetches the public repository over HTTPS without
  credentials. If the repository becomes private, add a read-only deploy key or
  equivalent server credential before relying on the deploy workflow.
