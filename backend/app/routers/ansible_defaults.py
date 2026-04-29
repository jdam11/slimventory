from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import AnsibleDefault
from app.schemas.inventory import (
    AnsibleDefaultCreate,
    AnsibleDefaultRead,
    AnsibleDefaultsBulkYaml,
    AnsibleDefaultUpdate,
)
from app.services.field_encryption import (
    is_name_sensitive,
    mask_value,
    maybe_encrypt,
)

router = APIRouter(prefix="/ansible-defaults", tags=["ansible_defaults"])


def _resolve_is_secret(name: str, explicit: Optional[bool]) -> bool:
    return explicit if explicit is not None else is_name_sensitive(name)


def _read(obj: AnsibleDefault) -> AnsibleDefaultRead:
    return AnsibleDefaultRead(
        id=obj.id,
        name=obj.name,
        value=mask_value(obj.value) if obj.is_secret else obj.value,
        is_secret=obj.is_secret,
    )


@router.get("/", response_model=List[AnsibleDefaultRead])
def list_ansible_defaults(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    return [_read(v) for v in db.query(AnsibleDefault).order_by(AnsibleDefault.id).all()]


@router.post("/", response_model=AnsibleDefaultRead, status_code=status.HTTP_201_CREATED)
def create_ansible_default(
    body: AnsibleDefaultCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    is_secret = _resolve_is_secret(body.name, body.is_secret)
    obj = AnsibleDefault(
        name=body.name,
        value=maybe_encrypt(body.value, is_secret),
        is_secret=is_secret,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _read(obj)


@router.patch("/{var_id}", response_model=AnsibleDefaultRead)
def update_ansible_default(
    var_id: int,
    body: AnsibleDefaultUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    obj = db.get(AnsibleDefault, var_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Variable not found")
    new_name = body.name if body.name is not None else obj.name
    new_is_secret = _resolve_is_secret(new_name, body.is_secret)
    if body.name is not None:
        obj.name = body.name
    obj.is_secret = new_is_secret
    if body.value is not None:
        obj.value = maybe_encrypt(body.value, new_is_secret)
    db.commit()
    db.refresh(obj)
    return _read(obj)


@router.delete("/{var_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ansible_default(
    var_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    obj = db.get(AnsibleDefault, var_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Variable not found")
    db.delete(obj)
    db.commit()


@router.put("/yaml", response_model=List[AnsibleDefaultRead])
def bulk_upsert_yaml_defaults(
    body: AnsibleDefaultsBulkYaml,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    """
    Replace ALL global ansible defaults with the provided YAML-derived dict.
    Keys are Ansible variable names; values are their global default values.
    Variables not present in the incoming dict are deleted.
    """
    existing: List[AnsibleDefault] = db.query(AnsibleDefault).all()
    existing_by_name: Dict[str, AnsibleDefault] = {v.name: v for v in existing}
    incoming_names = set(body.fields.keys())

    for name, var in existing_by_name.items():
        if name not in incoming_names:
            db.delete(var)

    for name, value in body.fields.items():
        is_secret = is_name_sensitive(name)
        if name in existing_by_name:
            existing_by_name[name].is_secret = is_secret
            existing_by_name[name].value = maybe_encrypt(value, is_secret)
        else:
            db.add(
                AnsibleDefault(
                    name=name,
                    value=maybe_encrypt(value, is_secret),
                    is_secret=is_secret,
                )
            )

    db.commit()
    return [_read(v) for v in db.query(AnsibleDefault).order_by(AnsibleDefault.id).all()]
