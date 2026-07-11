"""Outbound notification dispatch.

Loads enabled notification channels subscribed to an event and POSTs a
formatted message to each. Delivery is best-effort: any failure is logged and
swallowed so a broken webhook never breaks the operation that triggered it.
"""

from __future__ import annotations

import logging
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from ..models.notifications import NotificationChannel
from .field_encryption import decrypt_field_value

logger = logging.getLogger("notifications")

_TIMEOUT = 5.0

EVENT_KEYS = [
    "playbook_run_failed",
    "proxmox_pending_host",
    "backup_failed",
    "backup_completed",
]


def _build_request(channel: NotificationChannel, title: str, body: str, event_key: str, context: dict):
    """Return (json, data, headers) tuple for the channel's webhook flavour."""
    secret = decrypt_field_value(channel.secret_encrypted)
    headers: dict[str, str] = {}

    if channel.type == "ntfy":
        if secret:
            headers["Authorization"] = f"Bearer {secret}"
        headers["Title"] = title
        return None, body.encode("utf-8"), headers

    if channel.type == "gotify":
        if secret:
            headers["X-Gotify-Key"] = secret
        return {"title": title, "message": body, "priority": 5}, None, headers

    if channel.type == "discord":
        return {"content": f"**{title}**\n{body}"}, None, headers

    if channel.type == "slack":
        return {"text": f"*{title}*\n{body}"}, None, headers

    # generic_webhook
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    return {"title": title, "body": body, "event": event_key, "context": context}, None, headers


def _post(channel: NotificationChannel, title: str, body: str, event_key: str, context: dict) -> tuple[bool, str]:
    json_body, data, headers = _build_request(channel, title, body, event_key, context)
    try:
        resp = httpx.post(channel.url, json=json_body, content=data, headers=headers, timeout=_TIMEOUT)
        resp.raise_for_status()
        return True, f"{resp.status_code}"
    except Exception as exc:  # noqa: BLE001 — delivery is best-effort
        logger.warning("notification to channel %r (%s) failed: %s", channel.name, channel.type, exc)
        return False, str(exc)


def dispatch(db: Session, event_key: str, title: str, body: str, context: Optional[dict] = None) -> None:
    """Send *title*/*body* to every enabled channel subscribed to *event_key*."""
    context = context or {}
    try:
        channels = (
            db.query(NotificationChannel)
            .filter(NotificationChannel.enabled.is_(True))
            .all()
        )
    except Exception:  # noqa: BLE001
        logger.exception("failed to load notification channels")
        return

    for channel in channels:
        if event_key in (channel.events or []):
            _post(channel, title, body, event_key, context)


def send_test(channel: NotificationChannel) -> tuple[bool, str]:
    """Deliver a one-off test message; used by the UI 'Test' button."""
    return _post(
        channel,
        "SLIM test notification",
        f"This is a test message from SLIM for channel '{channel.name}'.",
        "test",
        {},
    )
