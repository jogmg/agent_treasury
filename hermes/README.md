# Hermes Phase 1 - read-only Arc treasury control plane

This directory is the cloud-hosted Hermes stack for Glimmerlock (Agent Treasury):

```
Discord (private Ops)
        │
        ▼
Hermes Ops profile ── MCP (bearer token) ──► arc-mcp:8788
        ▲                                      │
        │                                      ├─ Arc RPC (read-only)
        │                                      ├─ Circle Iris
        │                                      └─ Postgres business state
        │
monitor:8787 ── deterministic scan ───────────┘
        │
        └─ Discord webhook alerts
```

Phase 1 has **no signer, no keeper, no transaction intents, and no public
port**. The LLM explains and summarizes. Completion comes from
`WithdrawalRequested` → Circle Iris → destination `usedNonces`/`MessageReceived`.

## What is implemented

- `shared/cctp-message.ts` - one CCTP v2 parser used by both the browser app and
  this server (header, body, nonce, mint recipient, raw hook agent).
- `src/arc.ts` - read-only treasury, adapter, USDC, and withdrawal reads.
- `src/cctp.ts` - Iris attestation plus destination nonce/mint resolution.
- `src/activity.ts` - chunked Arc log scanner, Postgres event index, live fallback.
- `src/monitor/` - deterministic monitor, alert rules, Discord webhook delivery,
  dedupe, snapshots, transfer refresh, bookkeeping queue, health endpoint.
- `src/mcp/` - Streamable HTTP MCP server with scoped bearer tokens and seven
  read-only tools.
- `migrations/001_init.sql` - business state (separate from Hermes `state.db`).
- `profiles/ops/` - private Ops profile; `profiles/user/` - future public profile.

## Local quickstart (no Docker)

Requires Node 22.9+ and a Postgres 16 database. The local npm scripts load
`hermes/.env` automatically with `--env-file-if-exists`.

```bash
cd hermes
cp .env.example .env
# edit .env: Postgres password, MCP tokens (openssl rand -hex 32), webhook
npm install
npm run build
npm run migrate
npm run start:mcp
# in another terminal:
npm run start:monitor
```

This local path runs the MCP server and monitor only. For a full Hermes launch,
use Docker Compose below; the Ops profile env belongs in
`data/profiles/ops/.env` (created by `bootstrap.sh`), not `profiles/ops/.env`.

Local runs bind the MCP server and monitor to `127.0.0.1` by default. Compose
sets `MCP_HOST=0.0.0.0` and `MONITOR_HOST=0.0.0.0` so containers can reach
each other on the private network; no host port is published.

Smoke test the read-only MCP surface:

```bash
ARC_MCP_URL=http://127.0.0.1:8788/mcp \
ARC_MCP_TOKEN_OPS=... \
npm run smoke
```

Add `ARC_MCP_SMOKE_DB=1` when Postgres is running to also exercise the
transfer, bookkeeping queue, and incident tools.

## Docker Compose (recommended)

```bash
cd hermes
bash bootstrap.sh
# edit .env and data/profiles/ops/.env
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 hermes arc-mcp monitor
```

No service publishes a host port. For local debugging only:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
```

That binds Postgres, MCP, and the monitor to `127.0.0.1`.

## MCP client config

Hermes profile (`profiles/ops/config.yaml`):

```yaml
mcp_servers:
  arc-treasury:
    url: "http://arc-mcp:8788/mcp"
    headers:
      Authorization: "Bearer ${ARC_MCP_TOKEN_OPS}"
    trust: untrusted
    tools:
      include:
        - arc_get_config
        - arc_get_treasury_state
        - arc_list_activity
        - arc_get_cctp_status
        - arc_get_transfer
        - arc_get_bookkeeping_queue
        - arc_get_incidents
```

`trust: untrusted` means any tool without `readOnlyHint: true` needs approval.
All Phase 1 tools are read-only and annotated.

## Scopes

| Token | Tools |
|---|---|
| `ARC_MCP_TOKEN_OPS` | all seven, including bookkeeping queue and incidents |
| `ARC_MCP_TOKEN_USER` | config, state, activity, CCTP status, transfer lookup |

Missing or unknown bearer tokens get `401`. The server refuses to start with no
tokens configured.

## Tests

```bash
npm test
npm run typecheck
npm run build
```

The shared parser is also covered by the browser app's `src/lib/cctp.test.ts`.

## Security checklist

- No private key, seed phrase, keystore, or owner key in this directory.
- `arc-mcp`, `monitor`, Postgres, and the Hermes API server stay on the private
  Docker network.
- Discord bot allowlist is configured in `data/profiles/ops/.env`.
- `trust: untrusted` and `agent.disabled_toolsets` remove terminal, filesystem,
  browser, web, code execution, delegation, cron, and media tools.
- Monitor alerts are deduped in Postgres; Discord is best-effort delivery.
- Rotate the keeper away from the owner EOA before enabling any write phase.
