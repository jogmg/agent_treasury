#!/usr/bin/env bash
# Extract an exact GitHub commit into an immutable release directory and run the
# deploy script that the workflow uploaded to /tmp.
#
# This file is uploaded by the workflow on every run; it is not installed on the
# server. The target commit is verified to be reachable from origin/main.
set -euo pipefail

# The workflow uploads LF, but a manual Windows upload can add CRLF. Normalize
# and re-exec before parsing arguments or invoking git.
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec bash "$0" "$@"
fi

TARGET_SHA="${1:?usage: instabox-bootstrap.sh <sha> [force_all] [plan_only]}"
FORCE_ALL="${2:-0}"
PLAN_ONLY="${3:-0}"

SOURCE_ROOT="${DEPLOY_SOURCE_ROOT:-/data/agent-treasury}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/data/hermes-data/deploy}"
RELEASE_ROOT="${DEPLOY_RELEASE_ROOT:-$DEPLOY_ROOT/releases}"
STATE_DIR="${DEPLOY_STATE_DIR:-$DEPLOY_ROOT/state}"
DEPLOY_SCRIPT="${DEPLOY_SCRIPT:-/tmp/instabox-deploy.sh}"

mkdir -p "$RELEASE_ROOT" "$STATE_DIR"

if [[ ! "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ERROR: target SHA must be a full 40-character lowercase hex SHA" >&2
  exit 2
fi

echo "==> fetching origin/main"
git -C "$SOURCE_ROOT" fetch --quiet origin main

if [ "$(git -C "$SOURCE_ROOT" rev-parse --is-shallow-repository)" = "true" ]; then
  echo "==> server checkout is shallow; fetching full history for rollbacks"
  git -C "$SOURCE_ROOT" fetch --quiet --unshallow origin
fi

if ! git -C "$SOURCE_ROOT" cat-file -e "$TARGET_SHA^{commit}" 2>/dev/null; then
  echo "ERROR: target commit not found after fetch: $TARGET_SHA" >&2
  exit 3
fi
if ! git -C "$SOURCE_ROOT" merge-base --is-ancestor "$TARGET_SHA" origin/main; then
  echo "ERROR: target commit is not on origin/main: $TARGET_SHA" >&2
  exit 4
fi

RELEASE="$RELEASE_ROOT/$TARGET_SHA"
if [ ! -f "$RELEASE/.release-complete" ]; then
  echo "==> extracting $TARGET_SHA to $RELEASE"
  rm -rf "$RELEASE"
  mkdir -p "$RELEASE"
  git -C "$SOURCE_ROOT" archive --format=tar "$TARGET_SHA" | tar -x -C "$RELEASE"
  touch "$RELEASE/.release-complete"
else
  echo "==> reusing extracted release $RELEASE"
fi

export DEPLOY_SOURCE_ROOT="$SOURCE_ROOT"
export DEPLOY_RELEASE_ROOT="$RELEASE_ROOT"
export DEPLOY_STATE_DIR="$STATE_DIR"

if [ ! -f "$DEPLOY_SCRIPT" ]; then
  echo "ERROR: deploy script not uploaded: $DEPLOY_SCRIPT" >&2
  exit 5
fi

exec bash "$DEPLOY_SCRIPT" "$RELEASE" "$TARGET_SHA" "$FORCE_ALL" "$PLAN_ONLY"
