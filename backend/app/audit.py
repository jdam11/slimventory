"""
Security audit logger.

Emits structured log lines under the ``security`` logger so they can be
filtered, forwarded to a SIEM, or written to a dedicated audit file.

All events include the client IP (respecting trusted-proxy rules) and a
short ``event`` tag for easy grep/filtering.
"""

from __future__ import annotations

import logging

from fastapi import Request
from sqlalchemy.orm import Session

from .config import settings
from .models.audit_log import AuditLog
from .security import decode_token

logger = logging.getLogger("security")

MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_ACTIONS = {"POST": "create", "PUT": "update", "PATCH": "update", "DELETE": "delete"}


def _client_ip(request: Request) -> str:
    """Extract the real client IP, honoring TRUSTED_PROXIES."""
    import ipaddress

    peer = request.client.host if request.client else "127.0.0.1"
    try:
        peer_addr = ipaddress.ip_address(peer)
        is_trusted = any(peer_addr in ipaddress.ip_network(cidr, strict=False) for cidr in settings.TRUSTED_PROXY_CIDRS)
    except ValueError:
        is_trusted = False

    if is_trusted:
        return request.headers.get("X-Real-IP") or peer
    return peer



def _resolve_username(request: Request) -> str | None:
    """Best-effort decode of the acting user from the request's JWT."""
    token = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[len("Bearer ") :]
    if not token:
        token = request.cookies.get("access_token")
    if not token:
        return None
    try:
        payload = decode_token(token)
    except Exception:  # noqa: BLE001 — never let auditing raise into the request
        return None
    if payload.get("type") != "access":
        return None
    return payload.get("sub")


def _parse_entity(path: str) -> tuple[str | None, str | None]:
    """Derive (entity, entity_id) from an API path like /api/hosts/12."""
    p = path
    if p.startswith("/api/"):
        p = p[len("/api/") :]
    elif p.startswith("/api"):
        p = p[len("/api") :]
    p = p.strip("/")
    if not p:
        return None, None
    parts = p.split("/")
    entity = parts[0]
    entity_id = parts[1] if len(parts) > 1 and parts[1].isdigit() else None
    return entity, entity_id


def record_audit(db: Session, request: Request, status_code: int) -> None:
    """Persist one audit_log row for a mutating request."""
    method = request.method.upper()
    entity, entity_id = _parse_entity(request.url.path)
    db.add(
        AuditLog(
            username=_resolve_username(request),
            ip=_client_ip(request),
            method=method,
            path=request.url.path,
            entity=entity,
            entity_id=entity_id,
            action=_ACTIONS.get(method),
            status_code=status_code,
        )
    )
    db.commit()


def log_login_success(request: Request, username: str) -> None:
    logger.info(
        "event=login_success ip=%s user=%s",
        _client_ip(request),
        username,
    )


def log_login_failed(request: Request, username: str, reason: str = "invalid_credentials") -> None:
    logger.warning(
        "event=login_failed ip=%s user=%s reason=%s",
        _client_ip(request),
        username,
        reason,
    )


def log_logout(request: Request, username: str) -> None:
    logger.info(
        "event=logout ip=%s user=%s",
        _client_ip(request),
        username,
    )


def log_token_rejected(request: Request, reason: str) -> None:
    logger.warning(
        "event=token_rejected ip=%s reason=%s path=%s",
        _client_ip(request),
        reason,
        request.url.path,
    )




def log_password_change(request: Request, username: str) -> None:
    logger.info(
        "event=password_changed ip=%s user=%s",
        _client_ip(request),
        username,
    )


def log_password_change_failed(request: Request, username: str) -> None:
    logger.warning(
        "event=password_change_failed ip=%s user=%s reason=wrong_old_password",
        _client_ip(request),
        username,
    )




def log_user_created(request: Request, admin: str, new_username: str, role: str) -> None:
    logger.info(
        "event=user_created ip=%s admin=%s target_user=%s role=%s",
        _client_ip(request),
        admin,
        new_username,
        role,
    )


def log_user_updated(request: Request, admin: str, target_user_id: int) -> None:
    logger.info(
        "event=user_updated ip=%s admin=%s target_user_id=%d",
        _client_ip(request),
        admin,
        target_user_id,
    )


def log_user_deleted(request: Request, admin: str, target_username: str) -> None:
    logger.warning(
        "event=user_deleted ip=%s admin=%s target_user=%s",
        _client_ip(request),
        admin,
        target_username,
    )




def log_rate_limited(request: Request) -> None:
    logger.warning(
        "event=rate_limited ip=%s method=%s path=%s",
        _client_ip(request),
        request.method,
        request.url.path,
    )




def log_credential_created(request: Request, admin: str, credential_name: str) -> None:
    logger.info(
        "event=proxmox_credential_created ip=%s admin=%s credential=%s",
        _client_ip(request),
        admin,
        credential_name,
    )


def log_credential_updated(request: Request, admin: str, credential_name: str) -> None:
    logger.info(
        "event=proxmox_credential_updated ip=%s admin=%s credential=%s",
        _client_ip(request),
        admin,
        credential_name,
    )


def log_credential_deleted(request: Request, admin: str, credential_name: str) -> None:
    logger.warning(
        "event=proxmox_credential_deleted ip=%s admin=%s credential=%s",
        _client_ip(request),
        admin,
        credential_name,
    )


def log_credentials_imported(request: Request, admin: str, created: int, skipped: int) -> None:
    logger.info(
        "event=proxmox_credentials_imported ip=%s admin=%s created=%d skipped=%d",
        _client_ip(request),
        admin,
        created,
        skipped,
    )




def log_backup_created(request: Request, admin: str, filename: str) -> None:
    logger.info(
        "event=backup_created ip=%s admin=%s filename=%s",
        _client_ip(request),
        admin,
        filename,
    )


def log_backup_restored(request: Request, admin: str, filename: str) -> None:
    logger.warning(
        "event=backup_restored ip=%s admin=%s filename=%s",
        _client_ip(request),
        admin,
        filename,
    )


def log_backup_deleted(request: Request, admin: str, filename: str) -> None:
    logger.info(
        "event=backup_deleted ip=%s admin=%s filename=%s",
        _client_ip(request),
        admin,
        filename,
    )


def log_backup_downloaded(request: Request, admin: str, filename: str) -> None:
    logger.info(
        "event=backup_downloaded ip=%s admin=%s filename=%s",
        _client_ip(request),
        admin,
        filename,
    )
