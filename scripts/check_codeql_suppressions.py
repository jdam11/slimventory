#!/usr/bin/env python3
"""Warn when a staged file change may have shifted CodeQL suppression line numbers."""
import json
import subprocess
import sys
from pathlib import Path


def staged_files():
    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only"],
        capture_output=True, text=True, check=True,
    )
    return set(result.stdout.splitlines())


def lines_added_before(file_path, target_line):
    """Return net lines inserted before target_line in the staged diff."""
    result = subprocess.run(
        ["git", "diff", "--cached", "-U0", "--", file_path],
        capture_output=True, text=True,
    )
    delta = 0
    for line in result.stdout.splitlines():
        if not line.startswith("@@"):
            continue
        # @@ -old_start[,old_count] +new_start[,new_count] @@
        parts = line.split(" ")
        old = parts[1]  # e.g. -10,3
        new = parts[2]  # e.g. +10,5
        old_start = int(old[1:].split(",")[0])
        old_count = int(old.split(",")[1]) if "," in old else 1
        new_count = int(new.split(",")[1]) if "," in new else 1
        if old_start < target_line:
            delta += new_count - old_count
    return delta


def main():
    root = Path(
        subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    )

    suppressions_path = root / ".codeql" / "suppressions.json"
    if not suppressions_path.exists():
        sys.exit(0)

    with suppressions_path.open() as f:
        suppressions = json.load(f)

    modified = staged_files()
    errors = []

    for entry in suppressions:
        file_path = entry["file"]
        rule = entry["rule"]
        line_num = entry["line"]

        abs_path = root / file_path
        if not abs_path.exists():
            errors.append(f"  {file_path}: file no longer exists — remove from suppressions.json")
            continue

        if file_path not in modified:
            continue

        lines = abs_path.read_text().splitlines()

        # Detect net line shift in the staged diff
        shift = lines_added_before(file_path, line_num)
        suggested = line_num + shift

        if line_num > len(lines):
            errors.append(
                f"  {file_path}:{line_num} ({rule}): past end of file "
                f"({len(lines)} lines) — update suppressions.json"
            )
        elif not lines[line_num - 1].strip():
            suggestion = f" (suggested new line: {suggested})" if shift else ""
            errors.append(
                f"  {file_path}:{line_num} ({rule}): now points to a blank line"
                f"{suggestion} — update suppressions.json"
            )
        elif shift:
            errors.append(
                f"  {file_path}:{line_num} ({rule}): staged diff adds {shift:+d} lines "
                f"before this suppression — verify line number, expected {suggested}"
            )

    if errors:
        print("CodeQL suppression drift detected — update .codeql/suppressions.json:")
        for e in errors:
            print(e)
        sys.exit(1)


if __name__ == "__main__":
    main()
