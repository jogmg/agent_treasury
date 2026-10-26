#!/usr/bin/env python3
"""Sync tracked Hermes profile files into the live profile data directory.

The repository owns model/tool/security settings, but the live profile also
contains a few runtime-owned keys (notably ``_config_version`` and the Discord
``platforms`` block added by ``/sethome``).  Keep those live-only values when
the repository does not define them, otherwise a deploy would silently drop
the Ops Discord binding.

Secrets are deliberately out of scope: ``.env`` files are never copied.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
import time
from pathlib import Path

PROFILES = ("ops", "user")
TOP_LEVEL_PLATFORMS = re.compile(r"^platforms:\s*(?:#.*)?$", re.MULTILINE)
TOP_LEVEL_KEY = re.compile(r"^\S")
CONFIG_VERSION = re.compile(r"^_config_version:.*$", re.MULTILINE)


def _platforms_block(text: str) -> str | None:
    """Return the live top-level ``platforms:`` block, including its children."""
    lines = text.splitlines(keepends=True)
    start = None
    for index, line in enumerate(lines):
        if TOP_LEVEL_PLATFORMS.match(line.rstrip("\r\n")):
            start = index
            break
    if start is None:
        return None

    end = len(lines)
    for index in range(start + 1, len(lines)):
        if TOP_LEVEL_KEY.match(lines[index]):
            end = index
            break
    block = "".join(lines[start:end]).rstrip("\r\n")
    return block + "\n" if block else None


def _config_version(text: str) -> str | None:
    match = CONFIG_VERSION.search(text)
    return match.group(0).strip() if match else None


def _merge(repo_text: str, live_text: str) -> str:
    """Prefer the repo config, but retain live runtime-owned top-level keys."""
    merged = repo_text.rstrip("\r\n") + "\n"

    if not re.search(r"^_config_version:", merged, re.MULTILINE):
        version = _config_version(live_text)
        if version:
            merged += "\n" + version + "\n"

    if not re.search(r"^platforms:", merged, re.MULTILINE):
        platforms = _platforms_block(live_text)
        if platforms:
            merged += "\n" + platforms

    return merged


def _backup(path: Path) -> None:
    stamp = time.strftime("%Y%m%d%H%M%S")
    shutil.copy2(path, path.with_name(f"{path.name}.bak-deploy-{stamp}"))


def _write_atomic(path: Path, content: str) -> None:
    tmp = path.with_name(f"{path.name}.tmp-deploy")
    with tmp.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)
    if path.exists():
        shutil.copymode(path, tmp)
    else:
        os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def _sync_config(
    profile: str, release: Path, data_dir: Path, plan: bool
) -> bool:
    source = release / "hermes" / "profiles" / profile / "config.yaml"
    if not source.exists():
        raise SystemExit(f"missing tracked config: {source}")

    live_dir = data_dir / "profiles" / profile
    live = live_dir / "config.yaml"
    repo_text = source.read_text(encoding="utf-8")
    live_text = live.read_text(encoding="utf-8") if live.exists() else ""
    merged = _merge(repo_text, live_text)

    if live.exists() and live.read_text(encoding="utf-8") == merged:
        print(f"UNCHANGED {profile} config.yaml")
        return False

    print(f"{'WOULD-CHANGE' if plan else 'CHANGED'} {profile} config.yaml")
    if plan:
        return True

    live_dir.mkdir(parents=True, exist_ok=True)
    if live.exists():
        _backup(live)
    _write_atomic(live, merged)
    return True


def _sync_soul(profile: str, release: Path, data_dir: Path, plan: bool) -> bool:
    source = release / "hermes" / "profiles" / profile / "SOUL.md"
    if not source.exists():
        return False

    live_dir = data_dir / "profiles" / profile
    live = live_dir / "SOUL.md"
    source_text = source.read_text(encoding="utf-8")
    live_text = live.read_text(encoding="utf-8") if live.exists() else None

    if live_text == source_text:
        print(f"UNCHANGED {profile} SOUL.md")
        return False

    print(f"{'WOULD-CHANGE' if plan else 'CHANGED'} {profile} SOUL.md")
    if plan:
        return True

    live_dir.mkdir(parents=True, exist_ok=True)
    if live.exists():
        _backup(live)
    _write_atomic(live, source_text)
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--release", required=True, type=Path)
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--profiles", default=",".join(PROFILES))
    parser.add_argument("--plan", action="store_true")
    args = parser.parse_args()

    selected = [item.strip() for item in args.profiles.split(",") if item.strip()]
    unknown = sorted(set(selected) - set(PROFILES))
    if unknown:
        parser.error(f"unknown profile(s): {', '.join(unknown)}")

    for profile in selected:
        _sync_config(profile, args.release, args.data_dir, args.plan)
        _sync_soul(profile, args.release, args.data_dir, args.plan)
    return 0


if __name__ == "__main__":
    sys.exit(main())
