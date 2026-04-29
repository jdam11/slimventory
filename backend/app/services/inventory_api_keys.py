from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.auth import InventoryApiKey


def generate_inventory_api_key() -> tuple[str, str]:
    raw = f"slim_inv_{secrets.token_urlsafe(32)}"
    return raw, hashlib.sha256(raw.encode("utf-8")).hexdigest()


def inventory_api_key_prefix(raw_key: str) -> str:
    return raw_key[:12]


def find_inventory_api_key_by_secret(db: Session, raw_key: str) -> InventoryApiKey | None:
    key_hash = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()
    return (
        db.query(InventoryApiKey)
        .filter(InventoryApiKey.key_hash == key_hash, InventoryApiKey.is_active.is_(True))
        .first()
    )


def mark_inventory_api_key_used(db: Session, key: InventoryApiKey) -> None:
    key.last_used_at = datetime.now(timezone.utc)
    db.add(key)
    db.commit()
