# InstaBox keepalive Worker

Cloudflare Worker that keeps the free InstaBox Hermes host from pausing after
30 idle minutes. It runs from a Cloudflare Cron Trigger every 10 minutes, so it
does not depend on GitHub Actions scheduling.

Each run calls the InstaBox control-plane API:

1. `POST /v1/machines/{id}/wake`
2. `POST /v1/machines/{id}/exec` with `{"cmd":"true"}`

The second call is the terminal activity that resets the idle timer. `wake` is a
no-op while the machine is running and resumes an idle auto-pause; it does not
override a manual `pause`/`stop`.

## Secrets

Create these encrypted Worker secrets:

```text
INSTABOX_API_KEY
KEEPALIVE_TRIGGER_TOKEN
```

`INSTABOX_API_KEY` needs the `machines:read` and `machines:write` scopes. The
optional trigger token protects the manual HTTP endpoint; without it, the
endpoint returns 404. Do not put either value in `wrangler.toml`.

## Deploy

```bash
npx wrangler@4.152.0 login
npx wrangler@4.152.0 secret put INSTABOX_API_KEY
npx wrangler@4.152.0 secret put KEEPALIVE_TRIGGER_TOKEN
npx wrangler@4.152.0 deploy
```

## Verify

The cron runs at minutes `0, 10, 20, 30, 40, 50` UTC. A successful run updates
the InstaBox key's `lastUsedAt` and leaves the machine `running`.

For an immediate test, call the deployed Worker with the trigger token:

```bash
curl -X POST "https://instabox-keepalive.joattah3.workers.dev" \
  -H "x-keepalive-token: $KEEPALIVE_TRIGGER_TOKEN"
```

A successful response is `ok`. The public endpoint returns 404 for every request
without the matching header.

## Fallback

`.github/workflows/instabox-keepalive.yml` in the repository root remains a
manual `workflow_dispatch` fallback. GitHub Free does not run `schedule` events
in private repositories, and the public-repo schedule was observed to be delayed
for hours and to fail once on an InstaBox CLI checksum error, so it is not the
primary keepalive.
