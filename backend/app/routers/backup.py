import threading
from datetime import datetime, timezone

from apscheduler.triggers.cron import CronTrigger
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..audit import log_backup_created, log_backup_deleted, log_backup_downloaded, log_backup_restored
from ..database import get_db
from ..deps import require_admin
from ..models.auth import AppUser
from ..models.backup import AppBackupHistory
from ..schemas.backup import BackupConfigRead, BackupConfigUpdate, BackupHistoryRead, RestoreRequest
from ..services.backup import (
    delete_backup,
    get_backup_config,
    get_backup_filepath,
    notify_backup_schedule_changed,
    run_backup_thread,
    run_restore,
)

router = APIRouter(prefix="/backups", tags=["backups"])


@router.get("/config", response_model=BackupConfigRead)
def get_config(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    return get_backup_config(db)


@router.patch("/config", response_model=BackupConfigRead)
def update_config(
    body: BackupConfigUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    try:
        CronTrigger.from_crontab(body.cron_expression, timezone=body.timezone)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid cron configuration: {exc}") from exc

    config = get_backup_config(db)
    config.schedule_enabled = body.schedule_enabled
    config.cron_expression = body.cron_expression
    config.timezone = body.timezone
    config.retention_count = body.retention_count
    config.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(config)

    notify_backup_schedule_changed()
    return config


@router.post("/trigger", response_model=BackupHistoryRead, status_code=status.HTTP_202_ACCEPTED)
def trigger_backup(
    request: Request,
    db: Session = Depends(get_db),
    admin: AppUser = Depends(require_admin),
):
    # Create a placeholder history record so we can return it immediately
    history = AppBackupHistory(
        filename=f"pending_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.enc",
        status="running",
        trigger_source="manual",
        started_at=datetime.now(timezone.utc).replace(tzinfo=None),
        created_by=admin.username,
    )
    db.add(history)
    db.commit()
    db.refresh(history)

    # Remove the placeholder — the thread will create the real record
    db.delete(history)
    db.commit()

    log_backup_created(request, admin.username, "manual trigger")
    thread = threading.Thread(
        target=run_backup_thread,
        args=("manual", admin.username),
        daemon=True,
    )
    thread.start()

    # Return a synthetic response since the backup runs async
    return BackupHistoryRead(
        id=0,
        filename="backup in progress",
        size_bytes=0,
        status="running",
        trigger_source="manual",
        started_at=datetime.now(timezone.utc),
        created_by=admin.username,
    )


@router.get("/history", response_model=dict)
def list_history(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    total = db.query(func.count(AppBackupHistory.id)).scalar()
    items = db.query(AppBackupHistory).order_by(AppBackupHistory.started_at.desc()).offset(skip).limit(limit).all()
    return {
        "items": [BackupHistoryRead.model_validate(i) for i in items],
        "total": total,
    }


@router.get("/{backup_id}/download")
def download_backup(
    backup_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin: AppUser = Depends(require_admin),
):
    try:
        filepath, filename = get_backup_filepath(db, backup_id)
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    log_backup_downloaded(request, admin.username, filename)

    def iter_file():
        with open(filepath, "rb") as f:
            while chunk := f.read(65536):
                yield chunk

    return StreamingResponse(
        iter_file(),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/restore", status_code=status.HTTP_200_OK)
def restore_backup(
    body: RestoreRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: AppUser = Depends(require_admin),
):
    if not body.confirm:
        raise HTTPException(
            status_code=400,
            detail="Restore requires confirm=true. This is a destructive operation.",
        )

    history = db.get(AppBackupHistory, body.backup_id)
    if not history:
        raise HTTPException(status_code=404, detail="Backup not found")

    log_backup_restored(request, admin.username, history.filename)

    try:
        run_restore(db, body.backup_id)
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        if "already in progress" in str(exc).lower():
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"detail": f"Database restored from {history.filename}"}


@router.delete("/{backup_id}", status_code=status.HTTP_200_OK)
def delete_backup_endpoint(
    backup_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin: AppUser = Depends(require_admin),
):
    try:
        filename = delete_backup(db, backup_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    log_backup_deleted(request, admin.username, filename)
    return {"detail": f"Backup {filename} deleted"}
