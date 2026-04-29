from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.crud import create_record, delete_record, get_or_404, list_records, update_record
from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import HostResource
from app.schemas.inventory import (
    HostResourceCreate,
    HostResourceRead,
    HostResourceUpdate,
    PageResponse,
)

router = APIRouter(prefix="/host-resources", tags=["host_resources"])


@router.get("/", response_model=PageResponse[HostResourceRead])
def list_resources(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    items, total = list_records(db, HostResource, skip, limit)
    return {"items": items, "total": total}


@router.get("/{record_id}", response_model=HostResourceRead)
def get_resource(
    record_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    return get_or_404(db, HostResource, record_id)


@router.post("/", response_model=HostResourceRead, status_code=status.HTTP_201_CREATED)
def create_resource(
    body: HostResourceCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    return create_record(db, HostResource, body.model_dump())


@router.patch("/{record_id}", response_model=HostResourceRead)
def update_resource(
    record_id: int,
    body: HostResourceUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    obj = get_or_404(db, HostResource, record_id)
    return update_record(db, obj, body.model_dump(exclude_unset=True))


@router.delete("/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resource(
    record_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    obj = get_or_404(db, HostResource, record_id)
    delete_record(db, obj)
