from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import Host, HostHostTypeField, HostTypeField
from app.schemas.inventory import HostHostTypeFieldBatchUpsert, HostHostTypeFieldRead
from app.services.field_encryption import mask_value, maybe_encrypt

router = APIRouter(prefix="/host-host-type-fields", tags=["host-host-type-fields"])


@router.get("/", response_model=List[HostHostTypeFieldRead])
def list_host_host_type_fields(
    host_id: int | None = None,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    q = db.query(HostHostTypeField, HostTypeField.name, HostTypeField.is_secret).join(
        HostTypeField, HostTypeField.id == HostHostTypeField.field_id
    )
    if host_id is not None:
        q = q.filter(HostHostTypeField.host_id == host_id)

    return [
        HostHostTypeFieldRead(
            host_id=row.host_id,
            field_id=row.field_id,
            value=mask_value(row.value) if is_secret else row.value,
            field_name=field_name,
            is_secret=is_secret,
        )
        for row, field_name, is_secret in q.all()
    ]


@router.put("/", response_model=List[HostHostTypeFieldRead], status_code=status.HTTP_200_OK)
def upsert_host_host_type_fields(
    body: HostHostTypeFieldBatchUpsert,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    host = db.get(Host, body.host_id)
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")

    for entry in body.values:
        field = db.get(HostTypeField, entry.field_id)
        if not field or field.host_type_id != host.host_type_id:
            raise HTTPException(
                status_code=400,
                detail=f"Field {entry.field_id} does not belong to this host's type",
            )
        stored_value = maybe_encrypt(entry.value, field.is_secret)
        existing = db.get(HostHostTypeField, (body.host_id, entry.field_id))
        if existing:
            existing.value = stored_value
        else:
            db.add(
                HostHostTypeField(
                    host_id=body.host_id,
                    field_id=entry.field_id,
                    value=stored_value,
                )
            )
    db.commit()

    q = (
        db.query(HostHostTypeField, HostTypeField.name, HostTypeField.is_secret)
        .join(HostTypeField, HostTypeField.id == HostHostTypeField.field_id)
        .filter(HostHostTypeField.host_id == body.host_id)
    )
    return [
        HostHostTypeFieldRead(
            host_id=row.host_id,
            field_id=row.field_id,
            value=mask_value(row.value) if is_secret else row.value,
            field_name=field_name,
            is_secret=is_secret,
        )
        for row, field_name, is_secret in q.all()
    ]
