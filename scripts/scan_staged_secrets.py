#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

GITLEAKS_VERSION = "8.30.1"
GITLEAKS_TARBALL = f"gitleaks_{GITLEAKS_VERSION}_linux_x64.tar.gz"
GITLEAKS_URL = (
    f"https://github.com/gitleaks/gitleaks/releases/download/v{GITLEAKS_VERSION}/{GITLEAKS_TARBALL}"
)
GITLEAKS_SHA256 = "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"


def staged_paths() -> list[str]:
    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
        check=True,
        capture_output=True,
    )
    return [item.decode("utf-8") for item in result.stdout.split(b"\x00") if item]


def staged_bytes(path: str) -> bytes:
    return subprocess.check_output(["git", "show", f":{path}"])


def gitleaks_command(temp_root: Path) -> list[str]:
    local = shutil.which("gitleaks")
    if local:
        return [
            local,
            "dir",
            str(temp_root),
            "--no-banner",
            "--redact",
        ]

    curl = shutil.which("curl")
    if curl:
        tool_root = temp_root.parent / f".gitleaks-bin-{temp_root.name}"
        tool_root.mkdir(parents=True, exist_ok=True)
        tarball = tool_root / GITLEAKS_TARBALL
        subprocess.run([curl, "-fsSLo", str(tarball), GITLEAKS_URL], check=True)
        subprocess.run(
            ["sha256sum", "-c", "-"],
            input=f"{GITLEAKS_SHA256}  {tarball}\n",
            text=True,
            check=True,
        )
        binary = tool_root / "gitleaks"
        subprocess.run(["tar", "-xzf", str(tarball), "-C", str(tool_root), "gitleaks"], check=True)
        return [
            str(binary),
            "dir",
            str(temp_root),
            "--no-banner",
            "--redact",
        ]

    docker = shutil.which("docker")
    if docker:
        return [
            docker,
            "run",
            "--rm",
            "-v",
            f"{temp_root}:/scan:ro",
            "ghcr.io/gitleaks/gitleaks:v8.30.0@sha256:691af3c7c5a48b16f187ce3446d5f194838f91238f27270ed36eef6359a574d9",
            "dir",
            "/scan",
            "--no-banner",
            "--redact",
        ]

    raise RuntimeError("gitleaks, curl, or docker is required to scan staged files for secrets.")


def main() -> int:
    paths = staged_paths()
    if not paths:
        return 0

    with tempfile.TemporaryDirectory(prefix="slimventory-staged-") as temp_dir:
        temp_root = Path(temp_dir)
        for path_str in paths:
            target = temp_root / path_str
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(staged_bytes(path_str))

        try:
            cmd = gitleaks_command(temp_root)
        except RuntimeError as exc:
            print(str(exc), file=sys.stderr)
            return 1

        result = subprocess.run(cmd)
        if result.returncode == 0:
            return 0

        print(
            "Staged content appears to contain a secret. Remove it or replace it with a placeholder before committing.",
            file=sys.stderr,
        )
        return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
