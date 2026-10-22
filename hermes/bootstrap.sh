#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

DATA_DIR="${HERMES_DATA_DIR:-./data}"
SERVICE_ENV=".env"

mkdir -p "$DATA_DIR/profiles/ops"

if [ ! -f "$SERVICE_ENV" ]; then
  cp .env.example "$SERVICE_ENV"
  echo "Created $SERVICE_ENV from .env.example. Edit it before starting."
fi

if [ ! -f "$DATA_DIR/profiles/ops/config.yaml" ]; then
  cp profiles/ops/config.yaml "$DATA_DIR/profiles/ops/config.yaml"
  echo "Installed Ops config at $DATA_DIR/profiles/ops/config.yaml"
fi

if [ ! -f "$DATA_DIR/profiles/ops/SOUL.md" ]; then
  cp profiles/ops/SOUL.md "$DATA_DIR/profiles/ops/SOUL.md"
  echo "Installed Ops SOUL.md at $DATA_DIR/profiles/ops/SOUL.md"
fi

if [ ! -f "$DATA_DIR/profiles/ops/.env" ]; then
  cp profiles/ops/.env.example "$DATA_DIR/profiles/ops/.env"
  echo "Created $DATA_DIR/profiles/ops/.env. Fill in Discord, MCP, and LLM keys."
fi

# Keep the service token in sync with the ops profile token on first bootstrap.
# If you rotate either token later, update both files together.
if [ -f "$SERVICE_ENV" ]; then
  SERVICE_TOKEN="$(awk -F= '/^ARC_MCP_TOKEN_OPS=/{print $2; exit}' "$SERVICE_ENV" || true)"
  PROFILE_ENV="$DATA_DIR/profiles/ops/.env"
  if [ -n "${SERVICE_TOKEN:-}" ] && [ "$SERVICE_TOKEN" != "replace-with-ops-token" ]; then
    if grep -q '^ARC_MCP_TOKEN_OPS=' "$PROFILE_ENV"; then
      sed -i "s|^ARC_MCP_TOKEN_OPS=.*|ARC_MCP_TOKEN_OPS=$SERVICE_TOKEN|" "$PROFILE_ENV"
    else
      printf '\nARC_MCP_TOKEN_OPS=%s\n' "$SERVICE_TOKEN" >> "$PROFILE_ENV"
    fi
  fi
fi

chmod 600 "$SERVICE_ENV" "$DATA_DIR/profiles/ops/.env" 2>/dev/null || true

cat <<EOF

Hermes data directory: $DATA_DIR
Next:
  1. Edit $SERVICE_ENV (Postgres password, MCP token, Discord webhook).
  2. Edit $DATA_DIR/profiles/ops/.env (Discord bot, allowed user, MCP token, LLM key).
  3. Run: docker compose up -d --build
  4. Run: docker compose ps
  5. Run: docker logs --tail=100 hermes

The API, MCP, monitor, and Postgres publish no host ports.
EOF
