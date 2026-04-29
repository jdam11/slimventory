from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import GlobalDefaultRole
from app.schemas.inventory import GlobalDefaultRoleItem, GlobalDefaultRoleRead

router = APIRouter(prefix="/global-default-roles", tags=["global-default-roles"])


@router.get("/", response_model=List[GlobalDefaultRoleRead])
def list_global_defaults(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    rows = db.execute(select(GlobalDefaultRole).order_by(GlobalDefaultRole.priority)).scalars().all()
    return list(rows)


@router.put("/", response_model=List[GlobalDefaultRoleRead])
def set_global_defaults(
    body: List[GlobalDefaultRoleItem],
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    """Replace all global default roles with the provided list."""
    from sqlalchemy import delete

    db.execute(delete(GlobalDefaultRole))
    for item in body:
        db.add(GlobalDefaultRole(role_id=item.role_id, priority=item.priority))
    db.commit()
    rows = db.execute(select(GlobalDefaultRole).order_by(GlobalDefaultRole.priority)).scalars().all()
    return list(rows)
