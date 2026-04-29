from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.crud import delete_record, get_or_404
from app.database import get_db
from app.deps import require_admin
from app.models.auth import AppUser
from app.models.job_templates import VaultCredential
from app.schemas.inventory import PageResponse
from app.schemas.job_templates import VaultCredentialCreate, VaultCredentialRead, VaultCredentialUpdate
from app.services.field_encryption import encrypt_field_value

router = APIRouter(prefix="/vault-credentials", tags=["vault-credentials"])


def _to_read(credential: VaultCredential) -> VaultCredentialRead:
    return VaultCredentialRead(
        id=credential.id,
        name=credential.name,
        has_password=bool(credential.vault_password),
        created_at=credential.created_at,
    )


@router.get("/", response_model=PageResponse[VaultCredentialRead])
def list_vault_credentials(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    items = db.query(VaultCredential).order_by(VaultCredential.name.asc()).offset(skip).limit(limit).all()
    total = db.query(VaultCredential).count()
    return {"items": [_to_read(item) for item in items], "total": total}


@router.get("/{credential_id}", response_model=VaultCredentialRead)
def get_vault_credential(
    credential_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    return _to_read(get_or_404(db, VaultCredential, credential_id))


@router.post("/", response_model=VaultCredentialRead, status_code=status.HTTP_201_CREATED)
def create_vault_credential(
    body: VaultCredentialCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    credential = VaultCredential(
        name=body.name,
        vault_password=encrypt_field_value(body.vault_password) if body.vault_password else None,
    )
    db.add(credential)
    db.commit()
    db.refresh(credential)
    return _to_read(credential)


@router.patch("/{credential_id}", response_model=VaultCredentialRead)
def update_vault_credential(
    credential_id: int,
    body: VaultCredentialUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    credential = get_or_404(db, VaultCredential, credential_id)
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        credential.name = data["name"]
    if "vault_password" in data:
        credential.vault_password = encrypt_field_value(data["vault_password"]) if data["vault_password"] else None
    db.commit()
    db.refresh(credential)
    return _to_read(credential)


@router.delete("/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vault_credential(
    credential_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    delete_record(db, get_or_404(db, VaultCredential, credential_id))
