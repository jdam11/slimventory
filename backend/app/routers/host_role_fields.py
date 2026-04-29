from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import Host, HostRole, HostRoleField, RoleField
from app.schemas.inventory import HostRoleFieldBatchUpsert, HostRoleFieldRead
from app.services.field_encryption import mask_value, maybe_encrypt

router = APIRouter(prefix="/host-role-fields", tags=["host_role_fields"])


@router.get("/", response_model=List[HostRoleFieldRead])
def list_host_role_fields(
    host_id: int | None = None,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    q = db.query(HostRoleField, RoleField.name, RoleField.is_secret).join(
        RoleField, RoleField.id == HostRoleField.field_id
    )
    if host_id is not None:
        q = q.filter(HostRoleField.host_id == host_id)

    return [
        HostRoleFieldRead(
            host_id=row.host_id,
            field_id=row.field_id,
            value=mask_value(row.value) if is_secret else row.value,
            field_name=field_name,
            is_secret=is_secret,
        )
        for row, field_name, is_secret in q.all()
    ]


@router.put("/", response_model=List[HostRoleFieldRead], status_code=status.HTTP_200_OK)
def upsert_host_role_fields(
    body: HostRoleFieldBatchUpsert,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    host = db.get(Host, body.host_id)
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")

    # Collect all role_ids assigned to this host
    host_role_ids = set(
        row[0] for row in db.execute(select(HostRole.role_id).where(HostRole.host_id == body.host_id)).all()
    )

    for entry in body.values:
        field = db.get(RoleField, entry.field_id)
        if not field or field.role_id not in host_role_ids:
            raise HTTPException(
                status_code=400,
                detail=f"Field {entry.field_id} does not belong to any of this host's roles",
            )
        stored_value = maybe_encrypt(entry.value, field.is_secret)
        existing = db.get(HostRoleField, (body.host_id, entry.field_id))
        if existing:
            existing.value = stored_value
        else:
            db.add(
                HostRoleField(
                    host_id=body.host_id,
                    field_id=entry.field_id,
                    value=stored_value,
                )
            )
    db.commit()

    q = (
        db.query(HostRoleField, RoleField.name, RoleField.is_secret)
        .join(RoleField, RoleField.id == HostRoleField.field_id)
        .filter(HostRoleField.host_id == body.host_id)
    )
    return [
        HostRoleFieldRead(
            host_id=row.host_id,
            field_id=row.field_id,
            value=mask_value(row.value) if is_secret else row.value,
            field_name=field_name,
            is_secret=is_secret,
        )
        for row, field_name, is_secret in q.all()
    ]
