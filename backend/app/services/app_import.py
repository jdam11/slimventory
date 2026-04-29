"""App import service.

Parses a git repository containing a Docker Compose stack to extract:
  - The suggested app name (from docker-compose.yml ``name`` key, or
    the first service name, or the directory name)
  - A list of fields from ``.env.example`` (with secret detection)

The result is returned as a preview for the user to review before
creating the App and AppField records.
"""

import logging
import re
from pathlib import Path
from typing import List, Optional, Tuple

log = logging.getLogger(__name__)

# Keywords that suggest a .env value should be treated as a secret
_SECRET_KEYWORDS = {
    "password",
    "passwd",
    "secret",
    "token",
    "apikey",
    "api_key",
    "private",
    "credential",
    "license",
    "key",
}


def _is_secret_hint(name: str) -> bool:
    lower = name.lower()
    return any(kw in lower for kw in _SECRET_KEYWORDS)


def _parse_env_example(content: str) -> List[Tuple[str, Optional[str], bool]]:
    """Parse a .env.example file.

    Returns a list of (name, default_value, is_secret_hint) tuples,
    skipping blank lines and comment-only lines.
    """
    results = []
    for line in content.splitlines():
        # Strip inline comments
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        # Remove trailing inline comment (# ...)
        # Use a simple split on unquoted #
        if "#" in stripped:
            before_comment = stripped.split("#")[0].rstrip()
        else:
            before_comment = stripped

        if "=" not in before_comment:
            continue

        name, _, value = before_comment.partition("=")
        name = name.strip()
        value = value.strip() or None

        if not name:
            continue

        results.append((name, value, _is_secret_hint(name)))

    return results


def _parse_compose_app_name(content: str) -> Optional[str]:
    """Extract the app name from a docker-compose.yml file.

    Tries, in order:
    1. Top-level ``name: <value>`` key
    2. The name of the first service under ``services:``
    """
    # 1. Look for top-level "name:" (not indented)
    for line in content.splitlines():
        m = re.match(r"^name\s*:\s*(.+)$", line.strip())
        if m:
            name = m.group(1).strip().strip("'\"")
            if name:
                return name

    # 2. Look for first service name
    in_services = False
    for line in content.splitlines():
        stripped = line.strip()
        if stripped == "services:":
            in_services = True
            continue
        if in_services:
            # A top-level service key is indented by exactly 2 spaces and ends with ":"
            m = re.match(r"^  ([a-zA-Z0-9_-]+)\s*:", line)
            if m:
                return m.group(1)
            # Stop if we encounter another top-level key
            if stripped and not line.startswith(" "):
                break

    return None


def preview_app_import(repo_path: Path, subpath: str = "") -> dict:
    """Parse the repo for docker-compose.yml + .env.example and return a preview.

    Returns a dict with keys:
        suggested_name: str
        fields: list of {name, default_value, is_secret_hint}
    Raises FileNotFoundError if neither file is found.
    """
    target_path = repo_path / subpath if subpath else repo_path

    # Find docker-compose.yml
    compose_path: Optional[Path] = None
    for candidate in ("docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"):
        p = target_path / candidate
        if p.exists():
            compose_path = p
            break

    # Find .env.example
    env_path: Optional[Path] = None
    for candidate in (".env.example", ".env.sample", ".env.template"):
        p = target_path / candidate
        if p.exists():
            env_path = p
            break

    if compose_path is None and env_path is None:
        raise FileNotFoundError("No docker-compose.yml or .env.example found in the repository root.")

    # Determine suggested name
    suggested_name = target_path.name
    if compose_path:
        try:
            content = compose_path.read_text(encoding="utf-8", errors="replace")
            name = _parse_compose_app_name(content)
            if name:
                suggested_name = name
        except Exception as exc:
            log.warning("Could not parse compose file %s: %s", compose_path, exc)

    # Parse env fields
    fields = []
    if env_path:
        try:
            content = env_path.read_text(encoding="utf-8", errors="replace")
            for name, default_value, is_secret_hint in _parse_env_example(content):
                fields.append(
                    {
                        "name": name,
                        "default_value": default_value,
                        "is_secret_hint": is_secret_hint,
                    }
                )
        except Exception as exc:
            log.warning("Could not parse env file %s: %s", env_path, exc)

    return {"suggested_name": suggested_name, "fields": fields}
