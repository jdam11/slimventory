from __future__ import annotations

import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from app.config import settings
from app.models.git import GitAuthType, GitCredential, GitRepo
from app.models.inventory import Host
from app.services.inventory_builder import resolve_host_ssh_aliases


def ensure_known_hosts_storage() -> None:
    settings.ssh_known_hosts_dir_path.mkdir(parents=True, exist_ok=True)
    os.chmod(settings.ssh_known_hosts_dir_path, 0o700)  # nosemgrep
    for path in (settings.ssh_ansible_known_hosts_path, settings.ssh_git_known_hosts_path):
        path.touch(exist_ok=True)
        os.chmod(path, 0o600)


def _known_hosts_summary(path: Path) -> dict:
    stat_result = path.stat() if path.exists() else None
    line_count = 0
    if path.exists():
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            line_count = sum(1 for line in handle if line.strip())
    modified_at = None
    if stat_result is not None:
        modified_at = datetime.fromtimestamp(stat_result.st_mtime, tz=timezone.utc)
    return {
        "path": str(path),
        "exists": path.exists(),
        "size_bytes": stat_result.st_size if stat_result is not None else 0,
        "line_count": line_count,
        "modified_at": modified_at,
    }


def summarize_known_hosts_state() -> dict:
    ensure_known_hosts_storage()
    return {
        "ansible": _known_hosts_summary(settings.ssh_ansible_known_hosts_path),
        "git": _known_hosts_summary(settings.ssh_git_known_hosts_path),
    }


def _remove_alias(path: Path, alias: str) -> None:
    if not alias:
        return
    subprocess.run(
        ["ssh-keygen", "-R", alias, "-f", str(path)],
        check=False,
        capture_output=True,
        text=True,
    )


def clear_ansible_host_keys(db: Session, host_id: int) -> dict:
    ensure_known_hosts_storage()
    host = db.get(Host, host_id)
    if host is None:
        raise ValueError(f"Host {host_id} not found")
    aliases = resolve_host_ssh_aliases(db, host_id)
    for alias in aliases:
        _remove_alias(settings.ssh_ansible_known_hosts_path, alias)
    return {
        "host_id": host_id,
        "aliases": aliases,
        "cache": _known_hosts_summary(settings.ssh_ansible_known_hosts_path),
    }


def _git_repo_remote_alias(repo: GitRepo) -> str | None:
    credential: GitCredential | None = repo.credential
    effective_auth_type = credential.auth_type if credential else repo.auth_type
    if effective_auth_type != GitAuthType.ssh:
        return None
    parsed = urlparse(repo.url)
    if parsed.hostname:
        return parsed.hostname
    if "@" in repo.url and ":" in repo.url:
        host_part = repo.url.split("@", 1)[1].split(":", 1)[0]
        return host_part or None
    return None


def clear_git_repo_host_keys(db: Session, repo_id: int) -> dict:
    ensure_known_hosts_storage()
    repo = db.get(GitRepo, repo_id)
    if repo is None:
        raise ValueError(f"GitRepo {repo_id} not found")
    alias = _git_repo_remote_alias(repo)
    if not alias:
        raise ValueError("Repository does not use SSH remote host key verification")
    _remove_alias(settings.ssh_git_known_hosts_path, alias)
    return {"repo_id": repo_id, "alias": alias, "cache": _known_hosts_summary(settings.ssh_git_known_hosts_path)}
