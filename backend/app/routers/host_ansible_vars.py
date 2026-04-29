from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import AnsibleDefault, Host, HostAnsibleVar
from app.schemas.inventory import HostAnsibleVarBatchUpsert, HostAnsibleVarRead
from app.services.field_encryption import mask_value, maybe_encrypt

router = APIRouter(prefix="/host-ansible-vars", tags=["host_ansible_vars"])


@router.get("/", response_model=List[HostAnsibleVarRead])
def list_host_ansible_vars(
    host_id: int | None = None,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    q = db.query(HostAnsibleVar, AnsibleDefault.name, AnsibleDefault.is_secret).join(
        AnsibleDefault, AnsibleDefault.id == HostAnsibleVar.var_id
    )
    if host_id is not None:
        q = q.filter(HostAnsibleVar.host_id == host_id)

    return [
        HostAnsibleVarRead(
            host_id=row.host_id,
            var_id=row.var_id,
            value=mask_value(row.value) if is_secret else row.value,
            var_name=var_name,
            is_secret=is_secret,
        )
        for row, var_name, is_secret in q.all()
    ]


@router.put("/", response_model=List[HostAnsibleVarRead], status_code=status.HTTP_200_OK)
def upsert_host_ansible_vars(
    body: HostAnsibleVarBatchUpsert,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    host = db.get(Host, body.host_id)
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")

    for entry in body.values:
        var = db.get(AnsibleDefault, entry.var_id)
        if not var:
            raise HTTPException(
                status_code=400,
                detail=f"AnsibleDefault {entry.var_id} not found",
            )
        stored_value = maybe_encrypt(entry.value, var.is_secret)
        existing = db.get(HostAnsibleVar, (body.host_id, entry.var_id))
        if existing:
            existing.value = stored_value
        else:
            db.add(
                HostAnsibleVar(
                    host_id=body.host_id,
                    var_id=entry.var_id,
                    value=stored_value,
                )
            )
    db.commit()

    q = (
        db.query(HostAnsibleVar, AnsibleDefault.name, AnsibleDefault.is_secret)
        .join(AnsibleDefault, AnsibleDefault.id == HostAnsibleVar.var_id)
        .filter(HostAnsibleVar.host_id == body.host_id)
    )
    return [
        HostAnsibleVarRead(
            host_id=row.host_id,
            var_id=row.var_id,
            value=mask_value(row.value) if is_secret else row.value,
            var_name=var_name,
            is_secret=is_secret,
        )
        for row, var_name, is_secret in q.all()
    ]
