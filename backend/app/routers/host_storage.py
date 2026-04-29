from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.crud import create_record, delete_record, get_or_404, list_records, update_record
from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import HostStorage
from app.schemas.inventory import (
    HostStorageCreate,
    HostStorageRead,
    HostStorageUpdate,
    PageResponse,
)

router = APIRouter(prefix="/host-storage", tags=["host_storage"])


@router.get("/", response_model=PageResponse[HostStorageRead])
def list_storage(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    items, total = list_records(db, HostStorage, skip, limit)
    return {"items": items, "total": total}


@router.get("/{record_id}", response_model=HostStorageRead)
def get_storage(
    record_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    return get_or_404(db, HostStorage, record_id)


@router.post("/", response_model=HostStorageRead, status_code=status.HTTP_201_CREATED)
def create_storage(
    body: HostStorageCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    return create_record(db, HostStorage, body.model_dump())


@router.patch("/{record_id}", response_model=HostStorageRead)
def update_storage(
    record_id: int,
    body: HostStorageUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    obj = get_or_404(db, HostStorage, record_id)
    return update_record(db, obj, body.model_dump(exclude_unset=True))


@router.delete("/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_storage(
    record_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    obj = get_or_404(db, HostStorage, record_id)
    delete_record(db, obj)
