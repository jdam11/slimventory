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


def head_suppressions():
    """Return suppressions from HEAD as a list of dicts."""
    result = subprocess.run(
        ["git", "show", "HEAD:.codeql/suppressions.json"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        return []
    return json.loads(result.stdout)


def find_old_line(old_entries, rule, file_path, current_reason):
    """Find the best-matching old line for a suppression entry.

    Strategy (in order):
    1. Single candidate for (rule, file) — unambiguous, return it.
    2. Multiple candidates — match on reason (exact). Return only if exactly
       one candidate matches; otherwise the pairing is ambiguous and None is
       returned so the entry is treated as new (no drift check).
    """
    candidates = [e for e in old_entries if e["rule"] == rule and e["file"] == file_path]
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]["line"]
    # Multiple entries for same rule+file: use reason as a stable discriminator.
    if current_reason:
        reason_matches = [e for e in candidates if e.get("reason") == current_reason]
        if len(reason_matches) == 1:
            return reason_matches[0]["line"]
    # Ambiguous — can't reliably identify the corresponding old entry.
    return None


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

    old_entries = head_suppressions()
    modified = staged_files()
    errors = []

    for entry in suppressions:
        file_path = entry["file"]
        rule = entry["rule"]
        current_line = entry["line"]

        abs_path = root / file_path
        if not abs_path.exists():
            errors.append(f"  {file_path}: file no longer exists — remove from suppressions.json")
            continue

        if file_path not in modified:
            continue

        lines = abs_path.read_text().splitlines()

        # Use the old committed line as the shift basis so that co-staged
        # suppressions.json updates are not double-counted.
        old_line = find_old_line(old_entries, rule, file_path, entry.get("reason", ""))
        if old_line is not None:
            shift = lines_added_before(file_path, old_line)
            expected = old_line + shift
        else:
            shift = 0
            expected = current_line  # new entry; no drift check applies

        if current_line > len(lines):
            errors.append(
                f"  {file_path}:{current_line} ({rule}): past end of file "
                f"({len(lines)} lines) — update suppressions.json"
            )
        elif not lines[current_line - 1].strip():
            suggestion = f" (suggested new line: {expected})" if expected != current_line else ""
            errors.append(
                f"  {file_path}:{current_line} ({rule}): now points to a blank line"
                f"{suggestion} — update suppressions.json"
            )
        elif current_line != expected:
            errors.append(
                f"  {file_path}:{current_line} ({rule}): expected {expected} "
                f"(old={old_line}, shift={shift:+d}) — update suppressions.json"
            )

    if errors:
        print("CodeQL suppression drift detected — update .codeql/suppressions.json:")
        for e in errors:
            print(e)
        sys.exit(1)


if __name__ == "__main__":
    main()
