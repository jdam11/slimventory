from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import Host, HostStatusField, StatusField
from app.schemas.inventory import HostStatusFieldBatchUpsert, HostStatusFieldRead
from app.services.field_encryption import mask_value, maybe_encrypt

router = APIRouter(prefix="/host-status-fields", tags=["host_status_fields"])


@router.get("/", response_model=List[HostStatusFieldRead])
def list_host_status_fields(
    host_id: int | None = None,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    q = db.query(HostStatusField, StatusField.name, StatusField.is_secret).join(
        StatusField, StatusField.id == HostStatusField.field_id
    )
    if host_id is not None:
        q = q.filter(HostStatusField.host_id == host_id)

    return [
        HostStatusFieldRead(
            host_id=row.host_id,
            field_id=row.field_id,
            value=mask_value(row.value) if is_secret else row.value,
            field_name=field_name,
            is_secret=is_secret,
        )
        for row, field_name, is_secret in q.all()
    ]


@router.put("/", response_model=List[HostStatusFieldRead], status_code=status.HTTP_200_OK)
def upsert_host_status_fields(
    body: HostStatusFieldBatchUpsert,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    host = db.get(Host, body.host_id)
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")

    for entry in body.values:
        field = db.get(StatusField, entry.field_id)
        if not field or field.status_id != host.status_id:
            raise HTTPException(
                status_code=400,
                detail=f"Field {entry.field_id} does not belong to this host's status",
            )
        stored_value = maybe_encrypt(entry.value, field.is_secret)
        existing = db.get(HostStatusField, (body.host_id, entry.field_id))
        if existing:
            existing.value = stored_value
        else:
            db.add(
                HostStatusField(
                    host_id=body.host_id,
                    field_id=entry.field_id,
                    value=stored_value,
                )
            )
    db.commit()

    q = (
        db.query(HostStatusField, StatusField.name, StatusField.is_secret)
        .join(StatusField, StatusField.id == HostStatusField.field_id)
        .filter(HostStatusField.host_id == body.host_id)
    )
    return [
        HostStatusFieldRead(
            host_id=row.host_id,
            field_id=row.field_id,
            value=mask_value(row.value) if is_secret else row.value,
            field_name=field_name,
            is_secret=is_secret,
        )
        for row, field_name, is_secret in q.all()
    ]
