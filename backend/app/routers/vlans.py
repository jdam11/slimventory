from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.crud import create_record, delete_record, get_or_404, list_records, update_record
from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import Vlan
from app.schemas.inventory import PageResponse, VlanCreate, VlanRead, VlanUpdate

router = APIRouter(prefix="/vlans", tags=["vlans"])


@router.get("/", response_model=PageResponse[VlanRead])
def list_vlans(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    items, total = list_records(db, Vlan, skip, limit)
    return {"items": items, "total": total}


@router.get("/{record_id}", response_model=VlanRead)
def get_vlan(
    record_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    return get_or_404(db, Vlan, record_id)


@router.post("/", response_model=VlanRead, status_code=status.HTTP_201_CREATED)
def create_vlan(
    body: VlanCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    return create_record(db, Vlan, body.model_dump())


@router.patch("/{record_id}", response_model=VlanRead)
def update_vlan(
    record_id: int,
    body: VlanUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    obj = get_or_404(db, Vlan, record_id)
    return update_record(db, obj, body.model_dump(exclude_unset=True))


@router.delete("/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vlan(
    record_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    obj = get_or_404(db, Vlan, record_id)
    delete_record(db, obj)
