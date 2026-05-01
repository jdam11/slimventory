from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger(__name__)

from apscheduler.triggers.cron import CronTrigger
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import (
    log_credential_created,
    log_credential_deleted,
    log_credential_updated,
    log_credentials_imported,
)
from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import (
    ProxmoxCredential,
    ProxmoxNodeStorage,
    ProxmoxPendingHost,
    ProxmoxSyncRun,
)
from app.schemas.inventory import (
    PageResponse,
    ProxmoxCredentialCreate,
    ProxmoxCredentialImportRequest,
    ProxmoxCredentialImportResult,
    ProxmoxCredentialRead,
    ProxmoxCredentialUpdate,
    ProxmoxNodeStorageRead,
    ProxmoxPendingBulkActionRequest,
    ProxmoxPendingBulkActionResult,
    ProxmoxPendingHostRead,
    ProxmoxPendingHostUpdate,
    ProxmoxSyncRunRead,
    ProxmoxSyncScheduleRead,
    ProxmoxSyncScheduleUpdate,
    ProxmoxSyncTriggerRequest,
)
from app.security import encrypt_secret
from app.services.proxmox import (
    ensure_default_schedule,
    notify_schedule_changed,
    run_proxmox_sync,
)

router = APIRouter(prefix="/proxmox", tags=["proxmox"])


def _to_read(item: ProxmoxCredential) -> ProxmoxCredentialRead:
    return ProxmoxCredentialRead(
        id=item.id,
        name=item.name,
        base_url=item.base_url,
        auth_type=item.auth_type,
        token_id=item.token_id,
        username=item.username,
        verify_tls=item.verify_tls,
        is_active=item.is_active,
        has_secret=bool(item.encrypted_token_secret or item.encrypted_password),
        created_at=item.created_at,
        updated_at=item.updated_at,
        last_sync_at=item.last_sync_at,
        last_sync_error=item.last_sync_error,
    )


def _promote_pending_item(db: Session, item: ProxmoxPendingHost) -> None:
    """Promote a pending host row into hosts/resources/storage records."""
    import json as _json

    from app.models.inventory import Datastore, Host, HostResource, HostRole, HostStorage

    # Resolve host ID: node entries use host_id_override; VM/LXC entries use vmid
    resolved_host_id: int | None = item.host_id_override if item.vmid is None else item.vmid
    if resolved_host_id is None:
        raise HTTPException(
            status_code=422,
            detail="cannot promote: set host_id_override (this is a node entry with no VMID)",
        )

    missing = [
        field
        for field in ("environment_id", "host_type_id", "vlan_id", "role_id", "ipv4")
        if getattr(item, field) is None
    ]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"cannot promote: missing required fields: {', '.join(missing)}",
        )

    if db.get(Host, resolved_host_id):
        raise HTTPException(status_code=409, detail="a host with this ID already exists")

    host = Host(
        id=resolved_host_id,
        environment_id=item.environment_id,
        host_type_id=item.host_type_id,
        name=item.name,
        vlan_id=item.vlan_id,
        ipv4=item.ipv4,
        mac=item.mac,
        notes=item.notes or "Promoted from Proxmox pending",
        # For node-type entries, record the node name so VMs can link to this host.
        # For VM/LXC entries, record which node the guest currently lives on.
        proxmox_node=item.node,
    )
    db.add(host)
    db.flush()
    if item.role_id is not None:
        db.add(HostRole(host_id=resolved_host_id, role_id=item.role_id, priority=1))

    resource = HostResource(
        host_id=resolved_host_id,
        cpu_sockets=1,
        cpu_cores=item.cpu_cores,
        ram_mb=item.ram_mb,
    )
    db.add(resource)

    if item.disks_json:
        try:
            for idx, disk in enumerate(_json.loads(item.disks_json)):
                purpose = "os" if idx == 0 else f"hdd{idx:02d}"
                ds = db.execute(select(Datastore).where(Datastore.name == disk["datastore"])).scalar_one_or_none()
                if ds is None:
                    ds = Datastore(name=disk["datastore"], description="Synced from Proxmox")
                    db.add(ds)
                    db.flush()
                db.add(
                    HostStorage(
                        host_id=resolved_host_id,
                        purpose=purpose,
                        datastore_id=ds.id,
                        size_gb=disk["size_gb"],
                    )
                )
        except Exception:  # noqa: BLE001
            pass  # storage is optional — don't block promotion

    item.status = "promoted"
    item.reviewed_at = datetime.now(timezone.utc)


@router.get("/credentials", response_model=PageResponse[ProxmoxCredentialRead])
def list_credentials(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    total = db.scalar(select(func.count()).select_from(ProxmoxCredential)) or 0
    items = (
        db.execute(select(ProxmoxCredential).order_by(ProxmoxCredential.id.asc()).offset(skip).limit(limit))
        .scalars()
        .all()
    )
    return {"items": [_to_read(item) for item in items], "total": total}


@router.get("/credentials/{credential_id}", response_model=ProxmoxCredentialRead)
def get_credential(
    credential_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    item = db.get(ProxmoxCredential, credential_id)
    if item is None:
        raise HTTPException(status_code=404, detail="proxmox credential not found")
    return _to_read(item)


@router.post("/credentials", response_model=ProxmoxCredentialRead, status_code=status.HTTP_201_CREATED)
def create_credential(
    request: Request,
    body: ProxmoxCredentialCreate,
    db: Session = Depends(get_db),
    admin: AppUser = Depends(require_admin),
):
    now = datetime.now(timezone.utc)
    item = ProxmoxCredential(
        name=body.name,
        base_url=body.base_url,
        auth_type=body.auth_type,
        token_id=body.token_id,
        encrypted_token_secret=encrypt_secret(body.token_secret) if body.token_secret else None,
        username=body.username,
        encrypted_password=encrypt_secret(body.password) if body.password else None,
        verify_tls=body.verify_tls,
        is_active=body.is_active,
        created_at=now,
        updated_at=now,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    log_credential_created(request, admin.username, item.name)
    return _to_read(item)


@router.patch("/credentials/{credential_id}", response_model=ProxmoxCredentialRead)
def update_credential(
    request: Request,
    credential_id: int,
    body: ProxmoxCredentialUpdate,
    db: Session = Depends(get_db),
    admin: AppUser = Depends(require_admin),
):
    item = db.get(ProxmoxCredential, credential_id)
    if item is None:
        raise HTTPException(status_code=404, detail="proxmox credential not found")

    data = body.model_dump(exclude_unset=True)
    token_secret = data.pop("token_secret", None)
    password = data.pop("password", None)

    for key, value in data.items():
        setattr(item, key, value)

    if token_secret:
        item.encrypted_token_secret = encrypt_secret(token_secret)
    if password:
        item.encrypted_password = encrypt_secret(password)

    if item.auth_type == "token":
        item.encrypted_password = None
        item.username = None
    if item.auth_type == "password":
        item.encrypted_token_secret = None
        item.token_id = None

    if item.is_active:
        if item.auth_type == "token" and (not item.token_id or not item.encrypted_token_secret):
            raise HTTPException(
                status_code=400,
                detail="token_id and token_secret are required to activate a token auth credential",
            )
        if item.auth_type == "password" and (not item.username or not item.encrypted_password):
            raise HTTPException(
                status_code=400,
                detail="username and password are required to activate a password auth credential",
            )

    item.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)
    log_credential_updated(request, admin.username, item.name)
    return _to_read(item)


@router.delete("/credentials/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_credential(
    request: Request,
    credential_id: int,
    db: Session = Depends(get_db),
    admin: AppUser = Depends(require_admin),
):
    item = db.get(ProxmoxCredential, credential_id)
    if item is None:
        raise HTTPException(status_code=404, detail="proxmox credential not found")
    credential_name = item.name
    db.delete(item)
    db.commit()
    log_credential_deleted(request, admin.username, credential_name)


@router.post("/credentials/import", response_model=ProxmoxCredentialImportResult, status_code=status.HTTP_201_CREATED)
def import_credentials(
    request: Request,
    body: ProxmoxCredentialImportRequest,
    db: Session = Depends(get_db),
    admin: AppUser = Depends(require_admin),
):
    """Bulk-import Proxmox credentials with just name and URL. Created as inactive with no auth."""
    now = datetime.now(timezone.utc)
    created = 0
    skipped = 0
    errors: list[dict[str, str | int]] = []

    existing_names = set(db.execute(select(ProxmoxCredential.name)).scalars().all())

    for item in body.items:
        if item.name in existing_names:
            skipped += 1
            continue
        try:
            auth_type = item.auth_type or "token"
            has_token_auth = auth_type == "token" and item.token_id and item.token_secret
            has_password_auth = auth_type == "password" and item.username and item.password
            is_active = item.is_active and bool(has_token_auth or has_password_auth)
            credential = ProxmoxCredential(
                name=item.name,
                base_url=item.base_url,
                auth_type=auth_type,
                token_id=item.token_id if has_token_auth else None,
                encrypted_token_secret=encrypt_secret(item.token_secret) if has_token_auth else None,
                username=item.username if has_password_auth else None,
                encrypted_password=encrypt_secret(item.password) if has_password_auth else None,
                verify_tls=item.verify_tls,
                is_active=is_active,
                created_at=now,
                updated_at=now,
            )
            db.add(credential)
            db.flush()
            existing_names.add(item.name)
            created += 1
        except Exception:  # noqa: BLE001
            log.exception("Failed to import credential %r", item.name)
            errors.append({"id": 0, "detail": f"{item.name}: import failed"})

    db.commit()
    log_credentials_imported(request, admin.username, created, skipped)
    return {
        "requested": len(body.items),
        "created": created,
        "skipped": skipped,
        "errors": errors,
    }


@router.get("/schedule", response_model=ProxmoxSyncScheduleRead)
def get_schedule(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    return ensure_default_schedule(db)


@router.patch("/schedule", response_model=ProxmoxSyncScheduleRead)
def patch_schedule(
    body: ProxmoxSyncScheduleUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    try:
        CronTrigger.from_crontab(body.cron_expression, timezone=body.timezone)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"invalid cron configuration: {exc}") from exc

    item = ensure_default_schedule(db)
    item.enabled = body.enabled
    item.cron_expression = body.cron_expression
    item.timezone = body.timezone
    item.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)

    notify_schedule_changed()
    return item


@router.post("/sync", response_model=ProxmoxSyncRunRead, status_code=status.HTTP_202_ACCEPTED)
def trigger_sync(
    body: ProxmoxSyncTriggerRequest,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    try:
        return run_proxmox_sync(db, trigger_source=body.trigger_source)
    except RuntimeError as exc:
        if "already running" in str(exc).lower():
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/runs", response_model=PageResponse[ProxmoxSyncRunRead])
def list_runs(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    total = db.scalar(select(func.count()).select_from(ProxmoxSyncRun)) or 0
    items = (
        db.execute(select(ProxmoxSyncRun).order_by(ProxmoxSyncRun.started_at.desc()).offset(skip).limit(limit))
        .scalars()
        .all()
    )
    return {"items": items, "total": total}




@router.get("/pending", response_model=PageResponse[ProxmoxPendingHostRead])
def list_pending(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    """List VMs queued as pending because required lookup tables were empty at sync time."""
    total = (
        db.scalar(select(func.count()).select_from(ProxmoxPendingHost).where(ProxmoxPendingHost.status == "pending"))
        or 0
    )
    items = (
        db.execute(
            select(ProxmoxPendingHost)
            .where(ProxmoxPendingHost.status == "pending")
            .order_by(ProxmoxPendingHost.created_at.desc())
            .offset(skip)
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return {"items": items, "total": total}


@router.patch("/pending/{pending_id}", response_model=ProxmoxPendingHostRead)
def update_pending(
    pending_id: int,
    body: ProxmoxPendingHostUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    """Fill in FK fields (environment, vlan, role, host_type, ipv4) before promoting."""
    item = db.get(ProxmoxPendingHost, pending_id)
    if item is None or item.status != "pending":
        raise HTTPException(status_code=404, detail="pending host not found")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item


@router.post("/pending/{pending_id}/promote", response_model=ProxmoxPendingHostRead)
def promote_pending(
    pending_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    """Promote a pending host to a real Host once all required fields are filled."""

    item = db.get(ProxmoxPendingHost, pending_id)
    if item is None or item.status != "pending":
        raise HTTPException(status_code=404, detail="pending host not found")

    _promote_pending_item(db, item)
    db.commit()
    db.refresh(item)
    return item


@router.post("/pending/bulk-promote", response_model=ProxmoxPendingBulkActionResult)
def bulk_promote_pending(
    body: ProxmoxPendingBulkActionRequest,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    """Promote many pending hosts in one action; returns per-id failures for partial success."""
    succeeded_ids: list[int] = []
    errors: list[dict[str, str | int]] = []

    for pending_id in body.ids:
        item = db.get(ProxmoxPendingHost, pending_id)
        if item is None or item.status != "pending":
            errors.append({"id": pending_id, "detail": "pending host not found"})
            continue
        try:
            _promote_pending_item(db, item)
            db.commit()
            succeeded_ids.append(pending_id)
        except HTTPException as exc:
            db.rollback()
            errors.append({"id": pending_id, "detail": str(exc.detail)})
        except Exception:  # noqa: BLE001
            db.rollback()
            log.exception("Failed to promote pending host %d", pending_id)
            errors.append({"id": pending_id, "detail": "unexpected error promoting host"})

    return {
        "requested": len(body.ids),
        "succeeded": len(succeeded_ids),
        "succeeded_ids": succeeded_ids,
        "errors": errors,
    }


@router.delete("/pending/{pending_id}", status_code=status.HTTP_204_NO_CONTENT)
def dismiss_pending(
    pending_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    """Dismiss a pending host (marks it dismissed so it won't reappear unless re-synced)."""
    item = db.get(ProxmoxPendingHost, pending_id)
    if item is None or item.status != "pending":
        raise HTTPException(status_code=404, detail="pending host not found")
    item.status = "dismissed"
    item.reviewed_at = datetime.now(timezone.utc)
    db.commit()


@router.post("/pending/bulk-dismiss", response_model=ProxmoxPendingBulkActionResult)
def bulk_dismiss_pending(
    body: ProxmoxPendingBulkActionRequest,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    """Dismiss many pending hosts in one action; returns per-id failures for partial success."""
    succeeded_ids: list[int] = []
    errors: list[dict[str, str | int]] = []

    for pending_id in body.ids:
        item = db.get(ProxmoxPendingHost, pending_id)
        if item is None or item.status != "pending":
            errors.append({"id": pending_id, "detail": "pending host not found"})
            continue
        try:
            item.status = "dismissed"
            item.reviewed_at = datetime.now(timezone.utc)
            db.commit()
            succeeded_ids.append(pending_id)
        except Exception:  # noqa: BLE001
            db.rollback()
            log.exception("Failed to dismiss pending host %d", pending_id)
            errors.append({"id": pending_id, "detail": "unexpected error dismissing host"})

    return {
        "requested": len(body.ids),
        "succeeded": len(succeeded_ids),
        "succeeded_ids": succeeded_ids,
        "errors": errors,
    }


@router.get("/node-storage", response_model=PageResponse[ProxmoxNodeStorageRead])
def list_node_storage(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    """List synced Proxmox storage pool records, ordered by node then storage name."""
    total = db.scalar(select(func.count()).select_from(ProxmoxNodeStorage)) or 0
    items = (
        db.execute(
            select(ProxmoxNodeStorage)
            .order_by(ProxmoxNodeStorage.node.asc(), ProxmoxNodeStorage.storage.asc())
            .offset(skip)
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return {"items": list(items), "total": total}
