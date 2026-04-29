from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import HostTypeRole
from app.schemas.inventory import HostTypeRoleItem, HostTypeRoleRead

router = APIRouter(prefix="/host-type-roles", tags=["host-type-roles"])


@router.get("/", response_model=List[HostTypeRoleRead])
def list_host_type_roles(
    host_type_id: int | None = None,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    q = select(HostTypeRole).order_by(HostTypeRole.host_type_id, HostTypeRole.priority)
    if host_type_id is not None:
        q = q.where(HostTypeRole.host_type_id == host_type_id)
    rows = db.execute(q).scalars().all()
    return list(rows)


@router.put("/{host_type_id}", response_model=List[HostTypeRoleRead])
def set_host_type_roles(
    host_type_id: int,
    body: List[HostTypeRoleItem],
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    """Replace all roles for a host type with the provided list."""
    db.execute(delete(HostTypeRole).where(HostTypeRole.host_type_id == host_type_id))
    for item in body:
        db.add(HostTypeRole(host_type_id=host_type_id, role_id=item.role_id, priority=item.priority))
    db.commit()
    rows = (
        db.execute(
            select(HostTypeRole).where(HostTypeRole.host_type_id == host_type_id).order_by(HostTypeRole.priority)
        )
        .scalars()
        .all()
    )
    return list(rows)
