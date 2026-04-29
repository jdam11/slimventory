#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
from pathlib import PurePosixPath

ALLOWED_FILES = {".env.example"}
BLOCKED_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".asc"}
BLOCKED_DIRS = {"backups", "secrets"}


def staged_paths() -> list[str]:
    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
        check=True,
        capture_output=True,
    )
    return [item.decode("utf-8") for item in result.stdout.split(b"\x00") if item]


def is_blocked(path_str: str) -> bool:
    path = PurePosixPath(path_str)
    name = path.name

    if path_str in ALLOWED_FILES:
        return False
    if any(part in BLOCKED_DIRS for part in path.parts):
        return True
    if name == ".env" or (name.startswith(".env.") and name != ".env.example"):
        return True
    if path.suffix.lower() in BLOCKED_SUFFIXES:
        return True
    return False


def main() -> int:
    blocked = [path for path in staged_paths() if is_blocked(path)]
    if not blocked:
        return 0

    print("Refusing to commit sensitive file paths:", file=sys.stderr)
    for path in blocked:
        print(f"  - {path}", file=sys.stderr)
    print(
        "Move secrets to your local environment, a secret manager, or an ignored path before committing.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
