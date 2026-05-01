from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import AppField, HostApp, HostAppField
from app.schemas.inventory import HostAppFieldBatchUpsert, HostAppFieldRead
from app.services.field_encryption import mask_value, maybe_encrypt

router = APIRouter(prefix="/host-app-fields", tags=["host_app_fields"])


@router.get("/", response_model=List[HostAppFieldRead])
def list_host_app_fields(
    host_id: int | None = None,
    app_id: int | None = None,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    q = db.query(HostAppField, AppField.name, AppField.is_secret).join(AppField, AppField.id == HostAppField.field_id)
    if host_id is not None:
        q = q.filter(HostAppField.host_id == host_id)
    if app_id is not None:
        q = q.filter(HostAppField.app_id == app_id)

    results = []
    for row, field_name, is_secret in q.all():
        results.append(
            HostAppFieldRead(
                host_id=row.host_id,
                app_id=row.app_id,
                field_id=row.field_id,
                value=mask_value(row.value) if is_secret else row.value,
                field_name=field_name,
                is_secret=is_secret,
            )
        )
    return results


@router.put("/", response_model=List[HostAppFieldRead], status_code=status.HTTP_200_OK)
def upsert_host_app_fields(
    body: HostAppFieldBatchUpsert,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    ha = db.get(HostApp, (body.host_id, body.app_id))
    if not ha:
        raise HTTPException(status_code=404, detail="Host-app association not found")

    for entry in body.values:
        field = db.get(AppField, entry.field_id)
        if not field or field.app_id != body.app_id:
            raise HTTPException(
                status_code=400,
                detail=f"Field {entry.field_id} does not belong to app {body.app_id}",
            )
        stored_value = maybe_encrypt(entry.value, field.is_secret)
        existing = db.get(HostAppField, (body.host_id, body.app_id, entry.field_id))
        if existing:
            existing.value = stored_value
        else:
            db.add(
                HostAppField(
                    host_id=body.host_id,
                    app_id=body.app_id,
                    field_id=entry.field_id,
                    value=stored_value,
                )
            )
    db.commit()

    q = (
        db.query(HostAppField, AppField.name, AppField.is_secret)
        .join(AppField, AppField.id == HostAppField.field_id)
        .filter(
            HostAppField.host_id == body.host_id,
            HostAppField.app_id == body.app_id,
        )
    )
    return [
        HostAppFieldRead(
            host_id=row.host_id,
            app_id=row.app_id,
            field_id=row.field_id,
            value=mask_value(row.value) if is_secret else row.value,
            field_name=field_name,
            is_secret=is_secret,
        )
        for row, field_name, is_secret in q.all()
    ]
