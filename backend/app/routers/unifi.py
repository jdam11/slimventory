from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import UnifiSettings, UnifiSyncRun
from app.schemas.inventory import (
    PageResponse,
    UnifiSettingsRead,
    UnifiSettingsUpdate,
    UnifiSiteRead,
    UnifiSyncRunRead,
    UnifiSyncTriggerRequest,
    UnifiVlanImportRequest,
    UnifiVlanImportResult,
    UnifiVlanPreviewRead,
)
from app.services.unifi import (
    UnifiSettingsError,
    get_or_create_unifi_settings,
    import_unifi_vlans,
    list_unifi_sites,
    preview_unifi_vlans,
    run_unifi_sync,
    update_unifi_settings,
)

router = APIRouter(prefix="/unifi", tags=["unifi"])


def _to_settings_read(item: UnifiSettings) -> UnifiSettingsRead:
    return UnifiSettingsRead(
        enabled=item.enabled,
        base_url=item.base_url,
        username=item.username,
        site=item.site,
        verify_tls=item.verify_tls,
        has_password=bool(item.encrypted_password),
        last_sync_at=item.last_sync_at,
        last_sync_error=item.last_sync_error,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.get("/settings", response_model=UnifiSettingsRead)
def get_unifi_settings(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    return _to_settings_read(get_or_create_unifi_settings(db))


@router.patch("/settings", response_model=UnifiSettingsRead)
def patch_unifi_settings(
    body: UnifiSettingsUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    try:
        item = update_unifi_settings(db, body.model_dump(exclude_unset=True))
        return _to_settings_read(item)
    except UnifiSettingsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/sites", response_model=list[UnifiSiteRead])
def get_unifi_sites(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    try:
        return list_unifi_sites(db)
    except UnifiSettingsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/sync", response_model=UnifiSyncRunRead, status_code=status.HTTP_202_ACCEPTED)
def trigger_unifi_sync(
    body: UnifiSyncTriggerRequest,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    try:
        return run_unifi_sync(db, trigger_source=body.trigger_source)
    except UnifiSettingsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/runs", response_model=PageResponse[UnifiSyncRunRead])
def list_unifi_runs(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    total = db.scalar(select(func.count()).select_from(UnifiSyncRun)) or 0
    items = db.execute(select(UnifiSyncRun).order_by(UnifiSyncRun.id.desc()).offset(skip).limit(limit)).scalars().all()
    return {"items": items, "total": total}


@router.get("/vlans/preview", response_model=list[UnifiVlanPreviewRead])
def get_unifi_vlan_preview(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    try:
        return preview_unifi_vlans(db)
    except UnifiSettingsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/vlans/import", response_model=UnifiVlanImportResult)
def import_unifi_vlan_preview(
    body: UnifiVlanImportRequest,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    try:
        return import_unifi_vlans(db, body.network_ids)
    except UnifiSettingsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
