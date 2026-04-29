from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.crud import delete_record, get_or_404
from app.database import get_db
from app.deps import require_admin
from app.models.auth import AppUser
from app.models.git import GitCredential, GitRepo
from app.schemas.git import GitCredentialCreate, GitCredentialRead, GitCredentialUpdate
from app.schemas.inventory import PageResponse
from app.services.field_encryption import encrypt_field_value

router = APIRouter(prefix="/git-credentials", tags=["git-credentials"])


def _to_read(credential: GitCredential) -> GitCredentialRead:
    return GitCredentialRead.from_orm_safe(credential)


def _apply_secret_fields(credential: GitCredential, data: dict) -> None:
    if "https_password" in data:
        credential.https_password = encrypt_field_value(data["https_password"]) if data["https_password"] else None
    if "ssh_private_key" in data:
        credential.ssh_private_key = encrypt_field_value(data["ssh_private_key"]) if data["ssh_private_key"] else None


@router.get("/", response_model=PageResponse[GitCredentialRead])
def list_git_credentials(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    items = db.query(GitCredential).order_by(GitCredential.name.asc()).offset(skip).limit(limit).all()
    total = db.query(GitCredential).count()
    return {"items": [_to_read(item) for item in items], "total": total}


@router.get("/{credential_id}", response_model=GitCredentialRead)
def get_git_credential(
    credential_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    return _to_read(get_or_404(db, GitCredential, credential_id))


@router.post("/", response_model=GitCredentialRead, status_code=status.HTTP_201_CREATED)
def create_git_credential(
    body: GitCredentialCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    credential = GitCredential(
        name=body.name,
        auth_type=body.auth_type,
        https_username=body.https_username,
    )
    _apply_secret_fields(credential, body.model_dump())
    db.add(credential)
    db.commit()
    db.refresh(credential)
    return _to_read(credential)


@router.patch("/{credential_id}", response_model=GitCredentialRead)
def update_git_credential(
    credential_id: int,
    body: GitCredentialUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    credential = get_or_404(db, GitCredential, credential_id)
    data = body.model_dump(exclude_unset=True)
    for field in ("name", "auth_type", "https_username"):
        if field in data:
            setattr(credential, field, data[field])
    _apply_secret_fields(credential, data)
    db.commit()
    db.refresh(credential)
    return _to_read(credential)


@router.delete("/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_git_credential(
    credential_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    in_use = db.query(GitRepo).filter(GitRepo.credential_id == credential_id).first()
    if in_use:
        raise HTTPException(
            status_code=409,
            detail=f"Credential is still in use by repository '{in_use.name}'",
        )
    delete_record(db, get_or_404(db, GitCredential, credential_id))
