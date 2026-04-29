from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import AppField
from app.schemas.inventory import AppFieldCreate, AppFieldRead, AppFieldsBulkYaml, AppFieldUpdate
from app.services.field_encryption import (
    is_name_sensitive,
    mask_value,
    maybe_encrypt,
)

router = APIRouter(prefix="/app-fields", tags=["app_fields"])


def _resolve_is_secret(name: str, explicit: Optional[bool]) -> bool:
    """Return the effective is_secret flag: explicit value takes precedence over auto-detect."""
    return explicit if explicit is not None else is_name_sensitive(name)


def _read(obj: AppField) -> AppFieldRead:
    return AppFieldRead(
        id=obj.id,
        app_id=obj.app_id,
        name=obj.name,
        default_value=mask_value(obj.default_value) if obj.is_secret else obj.default_value,
        is_secret=obj.is_secret,
    )


@router.get("/", response_model=List[AppFieldRead])
def list_app_fields(
    app_id: int | None = None,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    q = db.query(AppField)
    if app_id is not None:
        q = q.filter(AppField.app_id == app_id)
    return [_read(f) for f in q.order_by(AppField.id).all()]


@router.post("/", response_model=AppFieldRead, status_code=status.HTTP_201_CREATED)
def create_app_field(
    body: AppFieldCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    is_secret = _resolve_is_secret(body.name, body.is_secret)
    obj = AppField(
        app_id=body.app_id,
        name=body.name,
        default_value=maybe_encrypt(body.default_value, is_secret),
        is_secret=is_secret,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _read(obj)


@router.patch("/{field_id}", response_model=AppFieldRead)
def update_app_field(
    field_id: int,
    body: AppFieldUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    obj = db.get(AppField, field_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Field not found")
    # Resolve new is_secret before updating name
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
def delete_app_field(
    field_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    obj = db.get(AppField, field_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Field not found")
    db.delete(obj)
    db.commit()


@router.put("/yaml/{app_id}", response_model=List[AppFieldRead])
def bulk_upsert_yaml_fields(
    app_id: int,
    body: AppFieldsBulkYaml,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    """
    Replace all fields for an app with the provided YAML-derived dict.
    Keys are Ansible variable names; values are default values (may be null).
    Fields not present in the incoming dict are deleted.
    """
    existing: List[AppField] = db.query(AppField).filter(AppField.app_id == app_id).all()
    existing_by_name: Dict[str, AppField] = {f.name: f for f in existing}
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
                AppField(
                    app_id=app_id,
                    name=name,
                    default_value=maybe_encrypt(default_value, is_secret),
                    is_secret=is_secret,
                )
            )

    db.commit()

    result = db.query(AppField).filter(AppField.app_id == app_id).order_by(AppField.id).all()
    return [_read(f) for f in result]
