"""Git repository management service.

Handles cloning and pulling git repositories to the shared /repos volume,
discovering ansible playbook files, and updating the ansible_playbooks table.

SSH key authentication: the decrypted private key is written to a secure
tempfile, used via GIT_SSH_COMMAND, then immediately deleted.

HTTPS authentication: credentials are provided through a temporary GIT_ASKPASS
helper so they are not embedded in clone URLs or command arguments.
"""

import logging
import os
import re
import stat
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.git import AnsiblePlaybook, GitAuthType, GitCredential, GitRepo
from app.services.field_encryption import decrypt_field_value
from app.services.known_hosts import ensure_known_hosts_storage

log = logging.getLogger(__name__)

# Directories that are never top-level ansible playbooks
_SKIP_DIRS = {
    "roles",
    "collections",
    "group_vars",
    "host_vars",
    "defaults",
    "tasks",
    "handlers",
    "vars",
    "meta",
    "library",
    "filter_plugins",
    "molecule",
    ".git",
    ".github",
    "tests",
    "test",
}


def _repo_path(repo_id: int) -> Path:
    return Path(settings.REPOS_PATH) / str(repo_id)


def _write_askpass_script(username: str, password: str) -> str:
    fd, script_path = tempfile.mkstemp(suffix=".sh", prefix="slim_git_askpass_")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write("#!/bin/sh\n")
            handle.write('case "$1" in\n')
            handle.write('  *Username*) printf "%s\\n" "$GIT_USERNAME" ;;\n')
            handle.write('  *) printf "%s\\n" "$GIT_PASSWORD" ;;\n')
            handle.write("esac\n")
        os.chmod(script_path, stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
    except Exception:
        os.unlink(script_path)
        raise
    return script_path


def _build_git_env(repo: GitRepo) -> tuple[dict, list[str]]:
    """Return (env_dict, temp_paths) for subprocess git calls."""
    ensure_known_hosts_storage()
    env = os.environ.copy()
    temp_paths: list[str] = []
    credential: GitCredential | None = repo.credential
    effective_auth_type = credential.auth_type if credential else repo.auth_type
    https_username = credential.https_username if credential else repo.https_username
    https_password = credential.https_password if credential else repo.https_password
    ssh_private_key = credential.ssh_private_key if credential else repo.ssh_private_key

    if effective_auth_type == GitAuthType.ssh and ssh_private_key:
        decrypted = decrypt_field_value(ssh_private_key) or ""
        fd, tmp_key_path = tempfile.mkstemp(suffix=".key", prefix="slim_git_")
        try:
            with os.fdopen(fd, "w") as f:
                f.write(decrypted)
                if not decrypted.endswith("\n"):
                    f.write("\n")
            os.chmod(tmp_key_path, stat.S_IRUSR | stat.S_IWUSR)
        except Exception:
            os.unlink(tmp_key_path)
            raise
        temp_paths.append(tmp_key_path)
        env["GIT_SSH_COMMAND"] = (
            f"ssh -i {tmp_key_path} "
            f"-o StrictHostKeyChecking=accept-new "
            f"-o UserKnownHostsFile={settings.ssh_git_known_hosts_path} "
            f"-o HashKnownHosts=yes "
            f"-o BatchMode=yes"
        )
    elif effective_auth_type == GitAuthType.https:
        password = decrypt_field_value(https_password) if https_password else ""
        askpass_script = _write_askpass_script(https_username or "", password)
        temp_paths.append(askpass_script)
        env["GIT_ASKPASS"] = askpass_script
        env["GIT_USERNAME"] = https_username or ""
        env["GIT_PASSWORD"] = password
        env["GIT_ASKPASS_REQUIRE"] = "force"

    # Disable git credential prompts so failed auth fails fast
    env["GIT_TERMINAL_PROMPT"] = "0"
    return env, temp_paths


def _run_git(args: List[str], cwd: Optional[Path], env: dict, timeout: int = 120) -> str:
    """Run a git sub-command and return stdout. Raises RuntimeError on failure."""
    cmd = ["git"] + args
    result = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(f"git {args[0]} failed (exit {result.returncode}): {result.stderr.strip()}")
    return result.stdout


def _discover_playbooks(repo_path: Path) -> List[str]:
    """Return repo-relative paths of YAML files that look like Ansible playbooks.

    Scans the repo root and up to two levels of subdirectories, skipping known
    non-playbook directories (roles/, group_vars/, etc.).
    """
    candidates: List[str] = []

    for root, dirs, files in os.walk(repo_path):
        rel_root = Path(root).relative_to(repo_path)
        depth = len(rel_root.parts)
        dirs[:] = [d for d in dirs if d not in _SKIP_DIRS and depth < 2]
        for name in files:
            if not name.endswith((".yml", ".yaml")):
                continue
            rel_path = rel_root / name if rel_root.parts else Path(name)
            candidates.append(rel_path.as_posix())

    return sorted(candidates)


def clone_or_pull_repo(repo: GitRepo) -> Path:
    """Clone or pull the repository. Returns the local repo path."""
    dest = _repo_path(repo.id)
    parsed = urlparse(repo.url)
    if parsed.scheme in {"http", "https"} and parsed.username:
        raise RuntimeError("Repository URL must not embed HTTPS credentials")
    env, temp_paths = _build_git_env(repo)

    try:
        if (dest / ".git").exists():
            log.info("Pulling repo %s (id=%d) branch=%s", repo.name, repo.id, repo.branch)
            _run_git(["remote", "set-url", "origin", repo.url], cwd=dest, env=env)
            _run_git(["fetch", "origin"], cwd=dest, env=env)
            _run_git(["checkout", repo.branch], cwd=dest, env=env)
            _run_git(["reset", "--hard", f"origin/{repo.branch}"], cwd=dest, env=env)
        else:
            dest.mkdir(parents=True, exist_ok=True)
            log.info("Cloning repo %s (id=%d) branch=%s", repo.name, repo.id, repo.branch)
            _run_git(
                ["clone", "--branch", repo.branch, "--single-branch", repo.url, str(dest)],
                cwd=None,
                env=env,
            )
    finally:
        for temp_path in temp_paths:
            try:
                os.unlink(temp_path)
            except OSError:
                pass

    return dest


def sync_repo(db: Session, repo_id: int) -> int:
    """Clone/pull the repo and sync discovered playbooks to the DB.

    Returns the number of playbooks now registered for this repo.
    """
    repo = db.get(GitRepo, repo_id)
    if repo is None:
        raise ValueError(f"GitRepo id={repo_id} not found")

    dest = clone_or_pull_repo(repo)
    paths = _discover_playbooks(dest)

    # Full replace: delete old rows, insert current discovery
    existing = db.execute(select(AnsiblePlaybook).where(AnsiblePlaybook.repo_id == repo_id)).scalars().all()
    existing_paths = {pb.path for pb in existing}
    new_paths = set(paths)

    # Remove stale
    for pb in existing:
        if pb.path not in new_paths:
            db.delete(pb)

    # Add new
    for path in new_paths:
        if path not in existing_paths:
            db.add(AnsiblePlaybook(repo_id=repo_id, path=path))

    repo.last_synced_at = datetime.now(timezone.utc)
    db.commit()

    return len(paths)


def get_repo_path(repo_id: int) -> Path:
    """Return the local path for a cloned repo (may not exist if not synced)."""
    return _repo_path(repo_id)


def get_repo_commit_sha(repo_id: int) -> Optional[str]:
    repo_path = _repo_path(repo_id)
    if not (repo_path / ".git").exists():
        return None
    try:
        return _run_git(["rev-parse", "HEAD"], cwd=repo_path, env=os.environ.copy()).strip() or None
    except Exception:
        return None


_ANSIBLE_VAR_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def discover_ansible_roles(repo_path: Path) -> List[Dict[str, Any]]:
    """Scan the roles/ directory and return discovery dicts for each found role.

    Each dict: {name, description, defaults}
    - description: pulled from meta/main.yml → galaxy_info.description (or None)
    - defaults: dict of variable name → string value from defaults/main.yml (only valid Ansible var names)
    """
    import yaml  # PyYAML

    roles_dir = repo_path / "roles"
    if not roles_dir.is_dir():
        return []

    result: List[Dict[str, Any]] = []
    for role_dir in sorted(p for p in roles_dir.iterdir() if p.is_dir() and not p.name.startswith(".")):
        name = role_dir.name

        # description from meta/main.yml → galaxy_info.description
        description: Optional[str] = None
        for meta_name in ("meta/main.yml", "meta/main.yaml"):
            meta_file = role_dir / meta_name
            if meta_file.exists():
                try:
                    with open(meta_file) as fh:
                        meta = yaml.safe_load(fh) or {}
                    galaxy_info = meta.get("galaxy_info") or {}
                    raw_desc = galaxy_info.get("description") or meta.get("description")
                    if raw_desc:
                        description = str(raw_desc).strip() or None
                except Exception:
                    pass
                break

        # defaults from defaults/main.yml
        defaults: Dict[str, Optional[str]] = {}
        for defaults_name in ("defaults/main.yml", "defaults/main.yaml"):
            defaults_file = role_dir / defaults_name
            if defaults_file.exists():
                try:
                    with open(defaults_file) as fh:
                        raw = yaml.safe_load(fh) or {}
                    if isinstance(raw, dict):
                        for k, v in raw.items():
                            if isinstance(k, str) and _ANSIBLE_VAR_RE.match(k):
                                defaults[k] = str(v) if v is not None else None
                except Exception:
                    pass
                break

        result.append({"name": name, "description": description, "defaults": defaults})

    return result


def bulk_preview_import(repo_path: Path) -> List[dict]:
    previews: List[dict] = []

    for category_dir in sorted(p for p in repo_path.iterdir() if p.is_dir() and not p.name.startswith(".")):
        for app_dir in sorted(p for p in category_dir.iterdir() if p.is_dir() and not p.name.startswith(".")):
            has_compose = any(
                (app_dir / candidate).exists()
                for candidate in ("docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml")
            )
            has_env = any(
                (app_dir / candidate).exists() for candidate in (".env.example", ".env.sample", ".env.template")
            )
            if not has_compose and not has_env:
                continue
            from app.services.app_import import preview_app_import

            preview = preview_app_import(repo_path, subpath=f"{category_dir.name}/{app_dir.name}")
            previews.append(
                {
                    "category": category_dir.name,
                    "subpath": f"{category_dir.name}/{app_dir.name}",
                    "suggested_name": preview["suggested_name"],
                    "fields": preview["fields"],
                }
            )

    return previews
