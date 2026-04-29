from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import HostApp
from app.schemas.inventory import HostAppBulkCreate, HostAppCreate, HostAppRead

router = APIRouter(prefix="/host-apps", tags=["host_apps"])


@router.get("/", response_model=List[HostAppRead])
def list_host_apps(
    host_id: int | None = None,
    app_id: int | None = None,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    q = db.query(HostApp)
    if host_id is not None:
        q = q.filter(HostApp.host_id == host_id)
    if app_id is not None:
        q = q.filter(HostApp.app_id == app_id)
    return q.all()


@router.post("/", response_model=HostAppRead, status_code=status.HTTP_201_CREATED)
def create_host_app(
    body: HostAppCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    existing = db.get(HostApp, (body.host_id, body.app_id))
    if existing:
        raise HTTPException(status_code=409, detail="Association already exists")
    obj = HostApp(host_id=body.host_id, app_id=body.app_id)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.post("/bulk", status_code=status.HTTP_201_CREATED)
def bulk_create_host_apps(
    body: HostAppBulkCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    created = 0
    for host_id in body.host_ids:
        if db.get(HostApp, (host_id, body.app_id)) is None:
            db.add(HostApp(host_id=host_id, app_id=body.app_id))
            created += 1
    db.commit()
    return {"created": created}


@router.delete("/", status_code=status.HTTP_204_NO_CONTENT)
def delete_host_app(
    host_id: int,
    app_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    obj = db.get(HostApp, (host_id, app_id))
    if not obj:
        raise HTTPException(status_code=404, detail="Association not found")
    db.delete(obj)
    db.commit()
