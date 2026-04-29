from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser, InventoryApiKey
from app.schemas.admin import (
    AnsibleRunnerSettingsRead,
    AnsibleRunnerSettingsUpdate,
    ClearedKnownHostsRead,
    InventoryApiKeyCreate,
    InventoryApiKeyRead,
    InventoryApiKeySecretRead,
    InventoryApiKeyUpdate,
    LogLevelRead,
    LogLevelUpdate,
    SshKnownHostsSummaryRead,
)
from app.services.ansible_runner_settings import (
    get_or_create_ansible_runner_settings,
    update_ansible_runner_settings,
)
from app.services.inventory_api_keys import (
    generate_inventory_api_key,
    inventory_api_key_prefix,
)
from app.services.known_hosts import (
    clear_ansible_host_keys,
    clear_git_repo_host_keys,
    summarize_known_hosts_state,
)

router = APIRouter(prefix="/admin", tags=["admin"])

_VALID_LEVELS = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}


@router.get("/log-level", response_model=LogLevelRead)
def get_log_level(_: AppUser = Depends(require_authenticated)):
    """Return the current root logger level."""
    return {"log_level": logging.getLevelName(logging.root.level)}


@router.patch("/log-level", response_model=LogLevelRead)
def set_log_level(
    body: LogLevelUpdate,
    _: AppUser = Depends(require_admin),
):
    """Change the root logger level at runtime (resets to LOG_LEVEL env var on restart)."""
    level = body.log_level.upper()
    if level not in _VALID_LEVELS:
        raise HTTPException(
            status_code=422,
            detail=f"log_level must be one of {sorted(_VALID_LEVELS)}",
        )
    logging.root.setLevel(level)
    logging.getLogger(__name__).info("Log level changed to %s", level)
    return {"log_level": level}


@router.get("/inventory-api-keys", response_model=list[InventoryApiKeyRead])
def list_inventory_api_keys(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    return db.query(InventoryApiKey).order_by(InventoryApiKey.created_at.desc()).all()


@router.post("/inventory-api-keys", response_model=InventoryApiKeySecretRead, status_code=status.HTTP_201_CREATED)
def create_inventory_api_key(
    body: InventoryApiKeyCreate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_admin),
):
    raw_key, key_hash = generate_inventory_api_key()
    item = InventoryApiKey(
        name=body.name,
        description=body.description,
        key_prefix=inventory_api_key_prefix(raw_key),
        key_hash=key_hash,
        permissions=[permission.value for permission in body.permissions],
        is_active=body.is_active,
        created_by_user_id=user.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"api_key": raw_key, "key": item}


@router.patch("/inventory-api-keys/{key_id}", response_model=InventoryApiKeyRead)
def update_inventory_api_key(
    key_id: int,
    body: InventoryApiKeyUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    item = db.get(InventoryApiKey, key_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Inventory API key not found")
    data = body.model_dump(exclude_unset=True)
    if "permissions" in data and data["permissions"] is not None:
        data["permissions"] = [permission.value for permission in data["permissions"]]
    for field, value in data.items():
        setattr(item, field, value)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.post("/inventory-api-keys/{key_id}/rotate", response_model=InventoryApiKeySecretRead)
def rotate_inventory_api_key(
    key_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    item = db.get(InventoryApiKey, key_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Inventory API key not found")
    raw_key, key_hash = generate_inventory_api_key()
    item.key_prefix = inventory_api_key_prefix(raw_key)
    item.key_hash = key_hash
    item.last_used_at = None
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"api_key": raw_key, "key": item}


@router.delete("/inventory-api-keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_inventory_api_key(
    key_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    item = db.get(InventoryApiKey, key_id)
    if item is None:
        return None
    db.delete(item)
    db.commit()
    return None


@router.get("/ansible-runner-settings", response_model=AnsibleRunnerSettingsRead)
def get_ansible_runner_settings(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    return get_or_create_ansible_runner_settings(db)


@router.patch("/ansible-runner-settings", response_model=AnsibleRunnerSettingsRead)
def patch_ansible_runner_settings(
    body: AnsibleRunnerSettingsUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    data = body.model_dump(exclude_unset=True)
    return update_ansible_runner_settings(db, **data)


@router.get("/ssh-known-hosts", response_model=SshKnownHostsSummaryRead)
def get_ssh_known_hosts_summary(_: AppUser = Depends(require_admin)):
    return summarize_known_hosts_state()


@router.post("/ssh-known-hosts/ansible/hosts/{host_id}/clear", response_model=ClearedKnownHostsRead)
def clear_ansible_known_hosts_for_host(
    host_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    try:
        result = clear_ansible_host_keys(db, host_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {
        "target": f"host:{host_id}",
        "aliases": result["aliases"],
        "cache": result["cache"],
    }


@router.post("/ssh-known-hosts/git-repos/{repo_id}/clear", response_model=ClearedKnownHostsRead)
def clear_git_known_hosts_for_repo(
    repo_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    try:
        result = clear_git_repo_host_keys(db, repo_id)
    except ValueError as exc:
        detail = str(exc)
        status_code = 409 if "does not use SSH" in detail else 404
        raise HTTPException(status_code=status_code, detail=detail) from exc
    return {
        "target": f"git-repo:{repo_id}",
        "aliases": [result["alias"]],
        "cache": result["cache"],
    }
