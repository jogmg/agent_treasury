#!/usr/bin/env bash
# Deploy one immutable release to the private InstaBox Docker Compose project.
#
# Invoked by .github/scripts/instabox-bootstrap.sh with:
#   <release-dir> <sha> [force_all] [plan_only]
#
# Design rules:
#   * The live checkout and its .env files are never reset or overwritten.
#   * The release directory is immutable; it is extracted from a GitHub commit.
#   * .env files stay server-only and are symlinked into each release.
#   * Only services affected by the changed paths are rebuilt or recreated.
#   * A successful health check is required before the deploy marker advances.
set -euo pipefail

# The workflow uploads LF, but a manual Windows upload can add CRLF. Normalize
# and re-exec before parsing arguments or invoking Compose.
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec bash "$0" "$@"
fi

RELEASE="${1:?usage: instabox-deploy.sh <release> <sha> [force_all] [plan_only]}"
TARGET_SHA="${2:?target SHA required}"
FORCE_ALL="${3:-0}"
PLAN_ONLY="${4:-0}"

SOURCE_ROOT="${DEPLOY_SOURCE_ROOT:-/data/agent-treasury}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/data/hermes-data/deploy}"
RELEASE_ROOT="${DEPLOY_RELEASE_ROOT:-$DEPLOY_ROOT/releases}"
STATE_DIR="${DEPLOY_STATE_DIR:-$DEPLOY_ROOT/state}"
MARKER="$STATE_DIR/last-deployed-sha"
ENV_FILE="$SOURCE_ROOT/hermes/.env"
USER_ENV_FILE="$SOURCE_ROOT/hermes/profiles/user/.env"
SYNC_SCRIPT="${SYNC_PROFILE_SCRIPT:-/tmp/sync-profile-configs.py}"
DEFAULT_DATA_DIR="/data/hermes-data"

mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/deploy.lock"
if ! flock -n 9; then
  echo "ERROR: another deploy is already running" >&2
  exit 1
fi

if [ ! -d "$RELEASE/hermes" ]; then
  echo "ERROR: release is missing hermes/: $RELEASE" >&2
  exit 1
fi

cd "$RELEASE/hermes"

echo "==> release:   $RELEASE"
echo "==> target:    $TARGET_SHA"
echo "==> mode:      $([ "$PLAN_ONLY" = "1" ] && echo plan || echo apply)"

# The live checkout owns the server-only env files. Never copy their contents
# into the release or into git; a symlink is enough for Compose.
link_env() {
  local src="$1" dest="$2"
  if [ ! -f "$src" ]; then
    echo "ERROR: missing live env file: $src" >&2
    return 1
  fi
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    echo "ERROR: refusing to replace non-symlink env file: $dest" >&2
    return 1
  fi
  mkdir -p "$(dirname "$dest")"
  ln -sfn "$src" "$dest"
}

if [ "$PLAN_ONLY" != "1" ]; then
  link_env "$ENV_FILE" "$RELEASE/hermes/.env"
  link_env "$USER_ENV_FILE" "$RELEASE/hermes/profiles/user/.env"
fi

data_dir="$(awk -F= '$1 == "HERMES_DATA_DIR" { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE" 2>/dev/null || true)"
data_dir="${data_dir:-$DEFAULT_DATA_DIR}"
echo "==> data dir:  $data_dir"

# Compare against the last successful deploy. If the marker is absent or the
# shallow clone cannot resolve it, treat every tracked path as changed.
prev_sha=""
if [ -f "$MARKER" ]; then
  prev_sha="$(head -n1 "$MARKER" | tr -d '[:space:]')"
fi

if [ "$FORCE_ALL" = "1" ] || [ -z "$prev_sha" ] || ! git -C "$SOURCE_ROOT" cat-file -e "$prev_sha^{commit}" 2>/dev/null; then
  echo "==> no usable previous marker; treating every tracked path as changed"
  changed="$(git -C "$SOURCE_ROOT" ls-tree -r --name-only "$TARGET_SHA")"
else
  changed="$(git -C "$SOURCE_ROOT" diff --name-only "$prev_sha" "$TARGET_SHA")"
fi

if [ -z "$changed" ] && [ "$FORCE_ALL" != "1" ]; then
  echo "==> no file changes since $prev_sha"
  if [ "$PLAN_ONLY" != "1" ]; then
    printf '%s\n' "$TARGET_SHA" > "$MARKER.tmp"
    mv "$MARKER.tmp" "$MARKER"
  fi
  exit 0
fi

echo "==> changed paths:"
printf '%s\n' "$changed" | sed 's/^/    /'

frontend=0
hermes_image=0
bff=0
mcp=0
monitor=0
db=0
common=0
ops_profile=0
user_profile=0
compose=0
env_example=0

while IFS= read -r path; do
  [ -z "$path" ] && continue
  case "$path" in
    src/*|index.html|public/*|package.json|package-lock.json|vite.config.*|tailwind.config.*|postcss.config.*|tsconfig*.json|hermes/Dockerfile.web|hermes/nginx.conf)
      frontend=1
      ;;
    shared/*)
      frontend=1
      hermes_image=1
      common=1
      ;;
    hermes/src/bff/*)
      hermes_image=1
      bff=1
      ;;
    hermes/src/mcp/*)
      hermes_image=1
      mcp=1
      ;;
    hermes/src/monitor/*)
      hermes_image=1
      monitor=1
      ;;
    hermes/src/db/*|hermes/migrations/*)
      hermes_image=1
      db=1
      ;;
    hermes/src/*)
      hermes_image=1
      common=1
      ;;
    hermes/package.json|hermes/package-lock.json|hermes/tsconfig.json|hermes/tsup.config.ts|hermes/Dockerfile)
      hermes_image=1
      common=1
      ;;
    hermes/profiles/ops/config.yaml|hermes/profiles/ops/SOUL.md)
      ops_profile=1
      ;;
    hermes/profiles/user/config.yaml|hermes/profiles/user/SOUL.md)
      user_profile=1
      ;;
    hermes/profiles/*/.env.example|hermes/.env.example)
      env_example=1
      ;;
    hermes/docker-compose.yml)
      compose=1
      ;;
    *)
      # Docs, contracts, CI-only files, Hermes test/smoke files, and local dev
      # files do not change a running service.
      ;;
  esac
done <<< "$changed"

echo "==> deploy plan:"
echo "    frontend=$frontend hermes_image=$hermes_image bff=$bff mcp=$mcp monitor=$monitor db=$db common=$common compose=$compose ops_profile=$ops_profile user_profile=$user_profile"

if [ "$env_example" = "1" ]; then
  echo "WARN: an .env.example changed; live .env files are server-only and were not modified." >&2
fi

# Plan mode still reads the live configs to show whether a profile restart
# would be needed, but it never writes a file or touches a container.
if [ "$PLAN_ONLY" = "1" ]; then
  profiles=""
  [ "$ops_profile" = "1" ] && profiles="ops"
  [ "$user_profile" = "1" ] && profiles="${profiles:+$profiles,}user"
  if [ -n "$profiles" ] && [ -f "$SYNC_SCRIPT" ]; then
    python3 "$SYNC_SCRIPT" --release "$RELEASE" --data-dir "$data_dir" --profiles "$profiles" --plan || true
  elif [ -n "$profiles" ]; then
    echo "WARN: profile sync helper is unavailable: $SYNC_SCRIPT" >&2
  fi
  echo "==> plan-only: no files or containers were changed"
  exit 0
fi

# Sync tracked profile config/SOUL files. The helper preserves live-only
# runtime keys such as _config_version and the Discord platforms block.
profiles=""
[ "$ops_profile" = "1" ] && profiles="ops"
[ "$user_profile" = "1" ] && profiles="${profiles:+$profiles,}user"
if [ -n "$profiles" ]; then
  if [ ! -f "$SYNC_SCRIPT" ]; then
    echo "ERROR: missing profile sync helper: $SYNC_SCRIPT" >&2
    exit 1
  fi
  sync_output="$(python3 "$SYNC_SCRIPT" --release "$RELEASE" --data-dir "$data_dir" --profiles "$profiles")"
  printf '%s\n' "$sync_output" | sed 's/^/    /'
fi

build_services=()
[ "$hermes_image" = "1" ] && build_services+=(bff)
[ "$frontend" = "1" ] && build_services+=(frontend)
if [ "${#build_services[@]}" -gt 0 ]; then
  echo "==> building: ${build_services[*]}"
  docker compose --profile web build "${build_services[@]}"
fi

echo "==> validating compose config"
if ! docker compose --profile web config --quiet >/dev/null; then
  echo "ERROR: docker compose config validation failed" >&2
  exit 1
fi

if [ "$hermes_image" = "1" ]; then
  echo "==> applying database migrations"
  docker compose --profile web run --rm migrate
fi

if [ "$common" = "1" ] || [ "$db" = "1" ]; then
  bff=1
  mcp=1
  monitor=1
fi

recreate=()
[ "$bff" = "1" ] && recreate+=(bff)
[ "$mcp" = "1" ] && recreate+=(arc-mcp)
[ "$monitor" = "1" ] && recreate+=(monitor)
if [ "${#recreate[@]}" -gt 0 ]; then
  echo "==> recreating: ${recreate[*]}"
  docker compose --profile web up -d --no-deps --force-recreate "${recreate[@]}"
fi

if [ "$frontend" = "1" ]; then
  echo "==> recreating: frontend"
  docker compose --profile web up -d --no-deps --force-recreate frontend
fi

if [ "$ops_profile" = "1" ]; then
  echo "==> recreating: hermes (Ops)"
  docker compose --profile web up -d --no-deps --force-recreate hermes
fi
if [ "$user_profile" = "1" ]; then
  echo "==> recreating: hermes-user"
  docker compose --profile web up -d --no-deps --force-recreate hermes-user
fi

if [ "$compose" = "1" ]; then
  echo "==> applying compose changes"
  docker compose --profile web up -d
fi

wait_for_service() {
  local service="$1" timeout="${2:-60}" id status i
  id="$(docker compose --profile web ps -q "$service" || true)"
  if [ -z "$id" ]; then
    echo "ERROR: no container found for $service" >&2
    return 1
  fi
  for ((i = 0; i < timeout; i += 5)); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo missing)"
    case "$status" in
      healthy|running)
        return 0
        ;;
      exited|dead|missing)
        echo "ERROR: $service is $status (inspect with: docker logs $id)" >&2
        return 1
        ;;
    esac
    sleep 5
  done
  echo "ERROR: $service did not become healthy (last status: $status; inspect with: docker logs $id)" >&2
  return 1
}

echo "==> waiting for containers"
for service in postgres arc-mcp monitor bff frontend hermes hermes-user; do
  wait_for_service "$service" 60
done

check_hermes() {
  local service="$1" profile="$2" expected="$3" id output attempt
  id="$(docker compose --profile web ps -q "$service" || true)"
  if [ -z "$id" ]; then
    echo "ERROR: no container found for $service" >&2
    return 1
  fi
  for attempt in $(seq 1 12); do
    output="$(docker exec "$id" hermes --profile "$profile" status 2>&1 || true)"
    if printf '%s\n' "$output" | grep -q 'Gateway:' \
      && printf '%s\n' "$output" | grep -q 'running' \
      && ! printf '%s\n' "$output" | grep -q 'not running' \
      && printf '%s\n' "$output" | grep -q "$expected"; then
      echo "==> $service gateway: running ($expected)"
      return 0
    fi
    sleep 5
  done
  echo "ERROR: $service gateway did not report '✓ running' with $expected (inspect with: docker logs $id)" >&2
  return 1
}

check_hermes hermes ops Discord
check_hermes hermes-user user api_server

frontend_port="$(docker compose --profile web port frontend 80 2>/dev/null | awk -F: 'NF {print $NF; exit}' || true)"
frontend_port="${frontend_port:-8080}"
echo "==> checking public surface on 127.0.0.1:$frontend_port"
curl -fsS --max-time 10 "http://127.0.0.1:${frontend_port}/" >/dev/null
curl -fsS --max-time 10 "http://127.0.0.1:${frontend_port}/health" >/dev/null
curl -fsS --max-time 10 "http://127.0.0.1:${frontend_port}/api/session" >/dev/null

printf '%s\n' "$TARGET_SHA" > "$MARKER.tmp"
mv "$MARKER.tmp" "$MARKER"

# Keep the current release plus the four newest others. Never remove the
# release that was just deployed, even if a rollback makes it older.
ls -1dt "$RELEASE_ROOT"/* 2>/dev/null | tail -n +6 | while IFS= read -r old; do
  [ "$old" = "$RELEASE" ] && continue
  rm -rf "$old"
done

echo "==> deploy complete: $TARGET_SHA"
