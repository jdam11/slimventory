from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import StatusField
from app.schemas.inventory import StatusFieldCreate, StatusFieldRead, StatusFieldsBulkYaml, StatusFieldUpdate
from app.services.field_encryption import (
    is_name_sensitive,
    mask_value,
    maybe_encrypt,
)

router = APIRouter(prefix="/status-fields", tags=["status_fields"])


def _resolve_is_secret(name: str, explicit: Optional[bool]) -> bool:
    return explicit if explicit is not None else is_name_sensitive(name)


def _read(obj: StatusField) -> StatusFieldRead:
    return StatusFieldRead(
        id=obj.id,
        status_id=obj.status_id,
        name=obj.name,
        default_value=mask_value(obj.default_value) if obj.is_secret else obj.default_value,
        is_secret=obj.is_secret,
    )


@router.get("/", response_model=List[StatusFieldRead])
def list_status_fields(
    status_id: int | None = None,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    q = db.query(StatusField)
    if status_id is not None:
        q = q.filter(StatusField.status_id == status_id)
    return [_read(f) for f in q.order_by(StatusField.id).all()]


@router.post("/", response_model=StatusFieldRead, status_code=status.HTTP_201_CREATED)
def create_status_field(
    body: StatusFieldCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    is_secret = _resolve_is_secret(body.name, body.is_secret)
    obj = StatusField(
        status_id=body.status_id,
        name=body.name,
        default_value=maybe_encrypt(body.default_value, is_secret),
        is_secret=is_secret,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _read(obj)


@router.patch("/{field_id}", response_model=StatusFieldRead)
def update_status_field(
    field_id: int,
    body: StatusFieldUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    obj = db.get(StatusField, field_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Field not found")
    new_name = body.name if body.name is not None else obj.name
    new_is_secret = _resolve_is_secret(new_name, body.is_secret)
    if body.name is not None:
        obj.name = body.name
    obj.is_secret = new_is_secret
    if body.default_value is not None:
        obj.default_value = maybe_encrypt(body.default_value, new_is_secret)
    db.commit()
    db.refresh(obj)
    return _read(obj)


@router.delete("/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_status_field(
    field_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    obj = db.get(StatusField, field_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Field not found")
    db.delete(obj)
    db.commit()


@router.put("/yaml/{status_id}", response_model=List[StatusFieldRead])
def bulk_upsert_yaml_fields(
    status_id: int,
    body: StatusFieldsBulkYaml,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    """
    Replace all fields for a status with the provided YAML-derived dict.
    Keys are Ansible variable names; values are default values (may be null).
    Fields not present in the incoming dict are deleted.
    """
    existing: List[StatusField] = db.query(StatusField).filter(StatusField.status_id == status_id).all()
    existing_by_name: Dict[str, StatusField] = {f.name: f for f in existing}
    incoming_names = set(body.fields.keys())

    for name, field in existing_by_name.items():
        if name not in incoming_names:
            db.delete(field)

    for name, default_value in body.fields.items():
        is_secret = is_name_sensitive(name)
        if name in existing_by_name:
            existing_by_name[name].is_secret = is_secret
            existing_by_name[name].default_value = maybe_encrypt(default_value, is_secret)
        else:
            db.add(
                StatusField(
                    status_id=status_id,
                    name=name,
                    default_value=maybe_encrypt(default_value, is_secret),
                    is_secret=is_secret,
                )
            )

    db.commit()

    rows = db.query(StatusField).filter(StatusField.status_id == status_id).order_by(StatusField.id).all()
    return [_read(f) for f in rows]
