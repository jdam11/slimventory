from __future__ import annotations

from pathlib import Path
from typing import List, Optional
from urllib.parse import quote

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_SECRET_KEY_PLACEHOLDER = "replace-with-64-hex-chars-secret-key-here"
_ADMIN_PASSWORD_PLACEHOLDER = "replace-with-strong-admin-password"
_READONLY_PASSWORD_PLACEHOLDER = "replace-with-strong-readonly-password"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    DB_HOST: str = "db"
    DB_PORT: int = 3306
    DB_USER: str = "slim_user"
    DB_PASSWORD: str
    DB_NAME: str = "slim_db"

    @property
    def DATABASE_URL(self) -> str:
        encoded_user = quote(self.DB_USER, safe="")
        encoded_password = quote(self.DB_PASSWORD, safe="")
        return (
            f"mysql+pymysql://{encoded_user}:{encoded_password}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}?charset=utf8mb4"
        )

    # JWT
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    @field_validator("SECRET_KEY")
    @classmethod
    def secret_key_must_be_strong(cls, v: str) -> str:
        if v == _SECRET_KEY_PLACEHOLDER:
            raise ValueError(
                "SECRET_KEY is still set to the placeholder value — "
                'generate a real key with: python -c "import secrets; print(secrets.token_hex(32))"'
            )
        if len(v) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters long")
        return v

    # Cookies
    # Set to True when the app is behind an HTTPS reverse proxy so the browser
    # will only transmit the session cookie over encrypted connections.
    SECURE_COOKIES: bool = False

    # Bootstrap users
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str
    READONLY_USERNAME: str = "viewer"
    READONLY_PASSWORD: str

    @field_validator("ADMIN_PASSWORD")
    @classmethod
    def admin_password_must_not_be_placeholder(cls, v: str) -> str:
        if v == _ADMIN_PASSWORD_PLACEHOLDER:
            raise ValueError("ADMIN_PASSWORD is still set to the placeholder value — choose a strong admin password")
        return v

    @field_validator("READONLY_PASSWORD")
    @classmethod
    def readonly_password_must_not_be_placeholder(cls, v: str) -> str:
        if v == _READONLY_PASSWORD_PLACEHOLDER:
            raise ValueError(
                "READONLY_PASSWORD is still set to the placeholder value — choose a strong readonly password"
            )
        return v

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173"

    # Testing
    TESTING: bool = False

    # Trusted reverse-proxy CIDRs (comma-separated).
    # X-Real-IP / X-Forwarded-For headers are only honoured when the
    # direct TCP peer falls within one of these networks.
    TRUSTED_PROXIES: str = "127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"

    @property
    def TRUSTED_PROXY_CIDRS(self) -> list[str]:
        return [c.strip() for c in self.TRUSTED_PROXIES.split(",") if c.strip()]

    # Logging
    LOG_LEVEL: str = "INFO"

    @field_validator("LOG_LEVEL")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        import logging

        level = v.upper()
        if logging.getLevelName(level) == f"Level {level}":
            raise ValueError(f"LOG_LEVEL must be one of DEBUG, INFO, WARNING, ERROR, CRITICAL — got {v!r}")
        return level

    # Ansible dynamic inventory export
    # When set, this token enables script access via the X-Inventory-Token header.
    # Leave unset to disable script-mode access; normal bearer/cookie auth always works.
    ANSIBLE_INVENTORY_TOKEN: Optional[str] = None

    # Backup
    BACKUP_DIR: str = "/backups"
    BACKUP_SCHEDULER_JOB_ID: str = "db-backup-job"

    # Proxmox sync
    PROXMOX_ENCRYPTION_KEY: Optional[str] = None
    PROXMOX_SCHEDULER_JOB_ID: str = "proxmox-sync-job"
    PROXMOX_SYNC_TIMEOUT_SECONDS: int = 20
    PROXMOX_DEFAULT_ENVIRONMENT_ID: Optional[int] = None
    PROXMOX_DEFAULT_HOST_TYPE_ID: Optional[int] = None
    PROXMOX_DEFAULT_VLAN_ID: Optional[int] = None
    PROXMOX_DEFAULT_ROLE_ID: Optional[int] = None
    UNIFI_TIMEOUT_SECONDS: int = 20

    # Ansible runner sidecar
    ANSIBLE_RUNNER_URL: str = "http://ansible-runner:8001"
    # Path to the shared volume where git repos are cloned
    REPOS_PATH: str = "/repos"
    SSH_KNOWN_HOSTS_DIR: str = "/known_hosts"
    SSH_ANSIBLE_KNOWN_HOSTS_FILE: str = "/known_hosts/ansible_known_hosts"
    SSH_GIT_KNOWN_HOSTS_FILE: str = "/known_hosts/git_known_hosts"

    # Default app repository — seeded idempotently on first startup.
    # Set to an empty string to disable. Supports any public git repo that
    # follows the <category>/<app>/compose.yaml layout (e.g. ScaleTail).
    DEFAULT_APP_REPO_URL: str = "https://github.com/tailscale-dev/ScaleTail"
    DEFAULT_APP_REPO_NAME: str = "ScaleTail"

    # Monitoring integrations
    MONITORING_PROMETHEUS_URL: Optional[str] = None
    MONITORING_LOKI_URL: Optional[str] = None
    MONITORING_TIMEOUT_SECONDS: int = 10

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def ssh_known_hosts_dir_path(self) -> Path:
        if self.TESTING:
            return Path("/tmp/slimventory-known-hosts")
        return Path(self.SSH_KNOWN_HOSTS_DIR)

    @property
    def ssh_ansible_known_hosts_path(self) -> Path:
        if self.TESTING:
            return self.ssh_known_hosts_dir_path / "ansible_known_hosts"
        return Path(self.SSH_ANSIBLE_KNOWN_HOSTS_FILE)

    @property
    def ssh_git_known_hosts_path(self) -> Path:
        if self.TESTING:
            return self.ssh_known_hosts_dir_path / "git_known_hosts"
        return Path(self.SSH_GIT_KNOWN_HOSTS_FILE)


settings = Settings()
