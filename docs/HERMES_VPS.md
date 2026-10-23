# Hermes VPS setup and project connectivity

This guide takes a fresh Ubuntu 24.04 VPS to the Phase 1 Hermes stack:

- private Discord **Hermes Ops** bot;
- read-only Arc/CCTP MCP server;
- deterministic monitor with Discord alerts;
- Postgres business state;
- no public ports for the API, MCP, monitor, or database.

It does not enable signing, keeper bookkeeping, or public user chat. Those are
later phases.

---

## 0. What you need

- A VPS with **2 vCPU, 4 GB RAM, 40 GB disk** (2 GB works without browser tools,
  but 4 GB is comfortable).
- Ubuntu 24.04, SSH access, and a non-root sudo user.
- A Discord server you control, plus permission to create a bot.
- An NVIDIA Build API key from <https://build.nvidia.com> (free endpoints; the
  Ops profile uses a ranked fallback chain).
- This repository on the VPS: `git clone https://github.com/jogmg/agent_treasury.git`.

No inbound ports are needed except SSH. Discord is an outbound connection.

### InstaBox free-plan deployment (current)

The current host is a free InstaBox `agent-browser` machine: 4 vCPU, 8 GiB RAM,
20 GiB persistent `/data`, and a 16 GiB root disk. The stack is healthy, but the
free plan sets `manualLifecycle: false`. `instabox auto-suspend ... 0` is refused
and the idle pause is fixed at 30 minutes. This is accepted as the current
production host; the monitor can have gaps when the host is paused.

Docker 29 uses the containerd image store, so setting `data-root` alone does not
move images. On a small root disk, move both Docker and containerd to `/data`:

```bash
sudo systemctl stop docker.socket docker containerd
sudo install -d -o root -g root -m 0711 /data/docker
printf '%s\n' '{"data-root":"/data/docker","log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}' \
  | sudo tee /etc/docker/daemon.json
sudo mv /var/lib/containerd /data/containerd
sudo ln -s /data/containerd /var/lib/containerd
sudo systemctl start containerd docker
docker info --format '{{.DockerRootDir}}'
df -h / /data
```

The primary keepalive is the Cloudflare Worker in
`hermes/infra/cloudflare-keepalive/`. Its `*/10 * * * *` Cron Trigger calls the
InstaBox control-plane API directly:

```text
POST https://api.instabox.sh/v1/machines/{id}/wake
POST https://api.instabox.sh/v1/machines/{id}/exec   {"cmd":"true"}
```

The Worker stores `INSTABOX_API_KEY` as an encrypted secret with scopes
`machines:read` and `machines:write` (90-day rotation). `wake` resumes only an
idle auto-pause; a manual `pause`/`stop` needs `resume`/`start`. The Worker was
deployed on 2026-10-23 and its cron was verified by an API-key `lastUsedAt`
update on the scheduled run. If a run is late, the next successful `wake`
resumes the machine and the monitor catches up from its last indexed block.

The public `.github/workflows/instabox-keepalive.yml` is a manual
`workflow_dispatch` fallback only. GitHub Free does not run `schedule` events in
private repositories, and the public-repo schedule was delayed for hours and
failed once on an InstaBox CLI checksum error. Do not treat GitHub's schedule as
the primary keepalive.

This is a free-plan workaround, not equivalent to a paid always-on host.

---

## 1. Harden the VPS and install Docker

SSH in as your sudo user, then:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg ufw git rsync

# Docker's official repository
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker "$USER"
newgrp docker
docker run --rm hello-world
```

Firewall: allow SSH only. Do **not** open 8642, 8787, 8788, or 5432.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
```

Optional but recommended: disable password SSH login and use keys only.

---

## 2. Put the project on the VPS

From your workstation, with the repository at `~/agent-treasury`:

```bash
rsync -av --exclude node_modules --exclude dist --exclude .git \
  ~/agent-treasury/ hermes@YOUR_VPS:/opt/agent-treasury/
```

Or, once a git remote exists:

```bash
sudo mkdir -p /opt/agent-treasury
sudo chown "$USER":"$USER" /opt/agent-treasury
git clone <repo-url> /opt/agent-treasury
```

The Docker build context is the repository root, because the Hermes server and
the browser app share `shared/cctp-message.ts`.

```bash
cd /opt/agent-treasury/hermes
```

---

## 3. Bootstrap the Hermes data directory

```bash
bash bootstrap.sh
```

This creates:

```
hermes/.env                         # service secrets
hermes/data/profiles/ops/config.yaml
hermes/data/profiles/ops/SOUL.md
hermes/data/profiles/ops/.env        # Discord + LLM + MCP token
```

If your VPS user is not UID 1000, set `HERMES_UID` / `HERMES_GID` in `hermes/.env`
or export them for Compose:

```bash
export HERMES_UID="$(id -u)"
export HERMES_GID="$(id -g)"
```

---

## 4. Create the Discord Ops bot

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. **New Application** → name it `Hermes Ops`.
2. **Bot** → **Add Bot**.
3. Enable **Message Content Intent** (required to read messages).
4. Copy the bot token. Treat it like a password.
5. **OAuth2 → URL Generator**:
   - Scopes: `bot`
   - Bot permissions: `View Channels`, `Send Messages`, `Read Message History`,
     `Embed Links`, `Attach Files`
6. Open the generated URL and invite the bot to your private Ops server.
7. Create a private `#treasury-ops` channel and a `#treasury-alerts` channel.
8. Enable Developer Mode in Discord, right-click your user → **Copy User ID**.
   Right-click `#treasury-alerts` → **Edit Channel → Integrations → Webhooks →
   New Webhook** and copy the webhook URL.

Fill in `data/profiles/ops/.env` (on InstaBox:
`/data/hermes-data/profiles/ops/.env`):

```dotenv
DISCORD_BOT_TOKEN=...
DISCORD_ALLOWED_USERS=YOUR_DISCORD_USER_ID
DISCORD_ALLOWED_CHANNELS=YOUR_OPS_CHANNEL_ID
DISCORD_REQUIRE_MENTION=true
ARC_MCP_TOKEN_OPS=THE_SAME_VALUE_AS_HERMES_.ENV
NVIDIA_API_KEY=nvapi-...
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
API_SERVER_ENABLED=false
```

The Ops profile uses `model.provider: nvidia` with a ranked
`fallback_providers` chain in `hermes/profiles/ops/config.yaml` (copied to
`data/profiles/ops/config.yaml` by `bootstrap.sh`). As of 2026-10-23 the chain
starts with `z-ai/glm-5.3`, `moonshotai/kimi-k2.6`, and
`deepseek-ai/deepseek-v4.1-flash`; NVIDIA's catalog changes often, so verify the
IDs against <https://integrate.api.nvidia.com/v1/models> and reorder as needed.
The provider key is `NVIDIA_API_KEY`; `NVIDIA_BASE_URL` is optional and defaults
to the same URL.

#### Switching NVIDIA free models

- **Automatic:** `fallback_providers` is tried in order on HTTP 429/5xx,
  timeouts, auth/not-found errors, and invalid responses. `agent.api_max_retries:
  1` and `providers.nvidia.request_timeout_seconds: 60` keep failover quick.
- **For one chat:** use an alias in Discord or the CLI:
  `/model nvidia-glm`, `/model nvidia-kimi`, `/model nvidia-deepseek`,
  `/model nvidia-fast`, or `/model nvidia-lightning`.
- **Persistently:** edit `model.default` in
  `/data/hermes-data/profiles/ops/config.yaml` (or run `hermes -p ops config edit`
  inside the Hermes container), then restart the gateway.
- **Interactive manager:** `hermes -p ops fallback` edits the fallback chain;
  `hermes -p ops model` picks the primary.
- **List current IDs:** with `NVIDIA_API_KEY` loaded in the profile shell,
  `curl -s https://integrate.api.nvidia.com/v1/models -H "Authorization: Bearer
  $NVIDIA_API_KEY"` (or use the Build catalog UI).

Fill in `hermes/.env`:

```dotenv
ARC_NETWORK=mainnet
TRACKED_AGENTS=0xD00fD0B006c01342522cAf4FA04D5f8910aB268c
POSTGRES_DB=treasury
POSTGRES_USER=treasury
POSTGRES_PASSWORD=<long random>
DATABASE_URL=postgresql://treasury:<same password>@localhost:5432/treasury
ARC_MCP_TOKEN_OPS=<same as profile>
ARC_MCP_TOKEN_USER=<different random token>
DISCORD_WEBHOOK_URL=<#treasury-alerts webhook>
MONITOR_INTERVAL_SECONDS=60
INDEX_CHUNKS_PER_RUN=20
ALERT_COOLDOWN_SECONDS=3600
```

Generate tokens/passwords with:

```bash
openssl rand -hex 32
```

`bootstrap.sh` syncs the Ops token from `.env` into the profile on first run. If
you rotate `ARC_MCP_TOKEN_OPS` later, update **both** files.

---

## 5. Start the stack

```bash
cd /opt/agent-treasury/hermes
docker compose up -d --build
docker compose ps
```

Expected services:

| Service | State | Purpose |
|---|---|---|
| `postgres` | healthy | business state |
| `migrate` | exited 0 | schema migration |
| `arc-mcp` | healthy | read-only MCP |
| `monitor` | healthy | scan + alerts |
| `hermes` | running | Discord gateway |

Watch the first run:

```bash
docker compose logs -f migrate
docker compose logs -f arc-mcp
docker compose logs -f monitor
docker compose logs -f hermes
```

`migrate` must exit `0` before `arc-mcp` and `monitor` start. If it fails, the
other services will not start.

---

## 6. Verify project connectivity

### 6.1 MCP health

```bash
docker compose exec arc-mcp node -e \
  "fetch('http://127.0.0.1:8788/health').then(r=>r.json()).then(console.log)"
```

Expect `ok: true`, `network: "mainnet"`, `chainId: 5042`, `readOnly: true`.

### 6.2 Monitor health and data

```bash
docker compose exec monitor node -e \
  "fetch('http://127.0.0.1:8787/health').then(r=>r.json()).then(console.log)"
```

Expect `ok: true` and a `lastSuccessAt`. If `lastError` is set, read
`docker compose logs monitor`.

Check Postgres:

```bash
docker compose exec postgres psql -U treasury -d treasury -c \
  "select key, value, updated_at from monitor_cursor order by key;"
docker compose exec postgres psql -U treasury -d treasury -c \
  "select count(*) as events from activity_events;"
docker compose exec postgres psql -U treasury -d treasury -c \
  "select severity, kind, subject, last_seen_at from alerts where resolved_at is null;"
```

### 6.3 Read-only MCP smoke test

Run the smoke test inside the MCP container. It reads the token and database URL
from the container environment, so no secret is passed on the command line:

```bash
docker compose exec arc-mcp node scripts/smoke.mjs
```

To also verify the Postgres-backed transfer, bookkeeping queue, and incident
tools:

```bash
docker compose exec -e ARC_MCP_SMOKE_DB=1 arc-mcp node scripts/smoke.mjs
```

The smoke test calls config, treasury state, activity, and CCTP status. It never
signs.

### 6.4 Hermes → MCP

```bash
docker compose exec hermes hermes profile list
docker compose exec hermes hermes -p ops mcp test arc-treasury
docker compose logs --tail=100 hermes
```

`mcp test` should list the seven `arc_*` tools, and the logs should show the
Discord gateway connected. If the token is wrong, Hermes reports `401`; if the
URL is wrong, it reports a connection error.

### 6.5 Discord

In `#treasury-ops`, mention the bot:

```
@Hermes Ops check the treasury state and the status of withdrawal id 3
```

Expected behavior:

- calls `arc_get_treasury_state` and `arc_get_cctp_status`;
- quotes block, amount, and transaction hash;
- says `done` for the known id 3 burn only because Iris + destination delivery
  say so;
- never asks for a private key.

The monitor should have already posted any open alerts to `#treasury-alerts`.
A new deployment will normally alert `keeper-is-owner`, because the keeper is
still the owner EOA. That is intentional until the keeper is rotated.

---

## 7. Private networking rules

The Compose file publishes **no host ports**. Keep it that way.

- `arc-mcp` is reachable only as `http://arc-mcp:8788/mcp` on the Compose
  network.
- `monitor` is reachable only as `http://monitor:8787/health`.
- Postgres is reachable only as `postgres:5432`.
- Hermes' OpenAI-compatible API server is off (`API_SERVER_ENABLED=false`). Do
  not turn it on until a BFF/reverse proxy with SIWE/BFF authentication is in
  front of it.
- For debugging from your laptop, use an SSH tunnel, not a public port:

```bash
ssh -L 8788:127.0.0.1:8788 hermes@YOUR_VPS
# on the VPS, temporarily:
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d arc-mcp
```

Then run the smoke test locally against `http://127.0.0.1:8788/mcp`.
Do not leave the local overlay running on a public host.

---

## 8. Backups

Back up three things:

1. Postgres business state.
2. Hermes `data/` (sessions, profile config, memories).
3. `.env` and `data/profiles/ops/.env` (secrets; store encrypted).

Daily example:

```bash
sudo mkdir -p /var/backups/agent-treasury
sudo chown "$USER":"$USER" /var/backups/agent-treasury

docker compose exec -T postgres pg_dump -U treasury -d treasury \
  | gzip > /var/backups/agent-treasury/treasury-$(date +%F).sql.gz

tar -czf /var/backups/agent-treasury/hermes-data-$(date +%F).tar.gz \
  data .env
```

Copy backups off the VPS (object storage, another host, or an encrypted backup
service). Test a restore before relying on it.

Restore sketch:

```bash
docker compose stop arc-mcp monitor hermes
gunzip -c treasury-YYYY-MM-DD.sql.gz \
  | docker compose exec -T postgres psql -U treasury -d treasury
docker compose start arc-mcp monitor hermes
```

---

## 9. Updates and rotation

### Application update

```bash
cd /opt/agent-treasury
rsync ...   # or git pull once a remote exists
cd hermes
docker compose up -d --build
docker compose ps
```

The one-shot `migrate` service applies new SQL files before the app services
start. Never edit an already-applied migration; add a new numbered file.

### Token rotation

1. Generate a new `ARC_MCP_TOKEN_OPS`.
2. Update `hermes/.env`.
3. Update `hermes/data/profiles/ops/.env`.
4. `docker compose up -d --force-recreate arc-mcp hermes`.

### Discord token rotation

1. Reset the bot token in the Discord Developer Portal.
2. Update `data/profiles/ops/.env`.
3. `docker compose restart hermes`.

### LLM key rotation

Update `data/profiles/ops/.env` and restart `hermes`.

---

## 10. Troubleshooting

### `migrate` exits non-zero

```bash
docker compose logs migrate
docker compose exec postgres psql -U treasury -d treasury -c '\dt'
```

Common causes: wrong `POSTGRES_PASSWORD`, Postgres not healthy, or a SQL error.
Fix the SQL/migration, do not delete `schema_migrations` on a live database.

### `arc-mcp` is unhealthy

```bash
docker compose logs arc-mcp
docker compose exec arc-mcp sh -lc 'for k in ARC_MCP_TOKEN_OPS ARC_MCP_TOKEN_USER DATABASE_URL; do if [ -n "$(printenv "$k")" ]; then echo "$k=set"; else echo "$k=missing"; fi; done'
```

If it exits immediately, the usual causes are missing, short, or placeholder
MCP tokens. The server refuses to start without valid `ARC_MCP_TOKEN_OPS` /
`ARC_MCP_TOKEN_USER` values of at least 32 characters.

### Hermes cannot see `arc-treasury`

```bash
docker compose exec hermes hermes -p ops mcp test arc-treasury
docker compose logs --tail=100 hermes
```

- `401`: profile `.env` token does not match `hermes/.env`.
- `connect ECONNREFUSED`: `arc-mcp` is not healthy or not on the same network.
- Tools missing: check `profiles/ops/config.yaml` `tools.include` names and
  `docker compose exec hermes hermes -p ops mcp list`.

### Discord bot is offline

- Confirm `DISCORD_BOT_TOKEN` and **Message Content Intent**.
- Confirm `DISCORD_ALLOWED_USERS` contains your numeric user ID.
- `docker compose logs hermes | tail -100`.
- Confirm the bot is invited to the server and can see the channel.

### Monitor runs but no events

- Arc public RPCs rate-limit. The scanner moves `lastIndexedBlock` forward in
  9,000-block chunks and retries on later runs.
- `INDEX_CHUNKS_PER_RUN=20` is conservative. Increase slowly if the RPC allows.
- Check `select * from monitor_cursor;` and `select count(*) from activity_events;`.

### `principal` is zero

A fully withdrawn treasury can legitimately show `principal 0`, `total 0`, and a
small vault-share dust value that redeems to zero. Verify with the activity
events (`WithdrawalToWallet` / `WithdrawalRequested`) before treating it as an
incident.

### Too many alerts

Use `ALERT_COOLDOWN_SECONDS` and resolve rules. The monitor dedupes by
`kind:subject`; it does not send the same open alert every minute.

---

## 11. Go-live checklist

- [ ] `docker compose ps` shows Postgres, MCP, monitor healthy and migrate exited 0.
- [ ] `arc_get_config` returns mainnet chain `5042`, treasury
      `0xf71b...6f63`, CCTP domain `26`.
- [ ] `arc_get_cctp_status` for burn
      `0x79006a...2b13` returns `phase: done` and `delivered: true`. A mint tx
      link is returned only when Iris supplies a forwarder tx.
- [ ] `arc_get_treasury_state` includes a fresh `asOfBlock` and `asOfTime`.
- [ ] Discord Ops bot responds only to allowlisted users.
- [ ] `#treasury-alerts` receives the expected `keeper-is-owner` warning.
- [ ] No host ports are published (`docker compose ps` has no `0.0.0.0:...`).
- [ ] Backups run and a restore has been tested.
- [ ] Keeper is still owner; no automated bookkeeping is enabled.
- [ ] Owner key never entered the VPS, chat, repo, or Postgres.

---

## 12. What comes next

Phase 1 is deliberately read-only. Before Phase 2/3:

1. Rotate the keeper away from the owner EOA.
2. Add the BFF/SIWE layer before exposing any Hermes API.
3. Add typed transaction intents and review cards; users sign in their own
   EIP-1193 wallet (MetaMask, Rabby, Coinbase Wallet, Brave, Frame, etc.).
4. Add keeper bookkeeping only for transfers verified complete by Iris and
   destination delivery.
5. Add incident threads and owner-action drafts for wallet/Safe approval.

See `docs/HERMES.md` for the full phased plan.
