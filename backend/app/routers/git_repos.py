"""Git repository CRUD router.

Endpoints:
  GET    /git-repos/                  – list all repos
  GET    /git-repos/{id}              – get one repo
  POST   /git-repos/                  – create (admin)
  PATCH  /git-repos/{id}              – update (admin)
  DELETE /git-repos/{id}              – delete (admin)
  POST   /git-repos/{id}/sync         – clone/pull and discover playbooks (admin)
  POST   /git-repos/{id}/preview-import – parse .env.example for app import (admin)
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.crud import delete_record, get_or_404, list_records
from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.git import GitCredential, GitRepo
from app.models.inventory import App, AppField, Role, RoleField
from app.schemas.git import (
    AnsibleRolePreview,
    AppImportPreview,
    BulkAppImportItem,
    BulkAppImportPreview,
    GitRepoCreate,
    GitRepoRead,
    GitRepoSyncResult,
    GitRepoUpdate,
    RoleImportRequest,
    RoleImportResult,
)
from app.schemas.inventory import PageResponse
from app.services.app_import import preview_app_import
from app.services.field_encryption import encrypt_field_value
from app.services.git_service import (
    bulk_preview_import,
    clone_or_pull_repo,
    discover_ansible_roles,
    get_repo_path,
    sync_repo,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/git-repos", tags=["git-repos"])


def _encrypt_repo_credentials(repo: GitRepo, data: dict) -> None:
    """Encrypt password and SSH key fields in-place on the ORM object."""
    if "https_password" in data and data["https_password"]:
        repo.https_password = encrypt_field_value(data["https_password"])
    elif "https_password" in data and data["https_password"] is None:
        repo.https_password = None

    if "ssh_private_key" in data and data["ssh_private_key"]:
        repo.ssh_private_key = encrypt_field_value(data["ssh_private_key"])
    elif "ssh_private_key" in data and data["ssh_private_key"] is None:
        repo.ssh_private_key = None


@router.get("/", response_model=PageResponse[GitRepoRead])
def list_repos(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    items, total = list_records(db, GitRepo, skip, limit)
    return {"items": [GitRepoRead.from_orm_safe(r) for r in items], "total": total}


@router.get("/{repo_id}", response_model=GitRepoRead)
def get_repo(
    repo_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    repo = get_or_404(db, GitRepo, repo_id)
    return GitRepoRead.from_orm_safe(repo)


@router.post("/", response_model=GitRepoRead, status_code=status.HTTP_201_CREATED)
def create_repo(
    body: GitRepoCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    data = body.model_dump()
    credential_id = data.get("credential_id")
    if credential_id is not None and db.get(GitCredential, credential_id) is None:
        raise HTTPException(status_code=404, detail="git credential not found")
    repo = GitRepo(
        name=data["name"],
        url=data["url"],
        branch=data["branch"],
        repo_type=data["repo_type"],
        auth_type=data["auth_type"],
        credential_id=credential_id,
        https_username=data.get("https_username"),
    )
    _encrypt_repo_credentials(repo, data)
    db.add(repo)
    db.commit()
    db.refresh(repo)
    return GitRepoRead.from_orm_safe(repo)


@router.patch("/{repo_id}", response_model=GitRepoRead)
def update_repo(
    repo_id: int,
    body: GitRepoUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    repo = get_or_404(db, GitRepo, repo_id)
    data = body.model_dump(exclude_unset=True)
    if (
        "credential_id" in data
        and data["credential_id"] is not None
        and db.get(GitCredential, data["credential_id"]) is None
    ):
        raise HTTPException(status_code=404, detail="git credential not found")

    for field in ("name", "url", "branch", "repo_type", "auth_type", "credential_id", "https_username"):
        if field in data:
            setattr(repo, field, data[field])

    _encrypt_repo_credentials(repo, data)
    db.commit()
    db.refresh(repo)
    return GitRepoRead.from_orm_safe(repo)


@router.delete("/{repo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_repo(
    repo_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    repo = get_or_404(db, GitRepo, repo_id)
    delete_record(db, repo)


@router.post("/{repo_id}/sync", response_model=GitRepoSyncResult)
def sync_git_repo(
    repo_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    """Clone or pull the repo and refresh the list of discovered playbooks."""
    repo = get_or_404(db, GitRepo, repo_id)
    try:
        count = sync_repo(db, repo.id)
    except Exception as exc:
        log.error("sync failed for repo %d: %s", repo_id, exc)
        raise HTTPException(status_code=500, detail="Sync failed") from exc

    return GitRepoSyncResult(
        repo_id=repo_id,
        synced_playbooks=count,
        message=f"Synced {count} playbook(s) from branch '{repo.branch}'.",
    )


@router.post("/{repo_id}/preview-import", response_model=AppImportPreview)
def preview_import(
    repo_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    """Parse the repo's docker-compose.yml + .env.example and return an import preview."""
    repo = get_or_404(db, GitRepo, repo_id)
    repo_path = get_repo_path(repo.id)

    if not (repo_path / ".git").exists():
        try:
            clone_or_pull_repo(repo)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Could not clone repo: {exc}") from exc

    try:
        preview = preview_app_import(repo_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    from app.schemas.git import AppImportField

    return AppImportPreview(
        suggested_name=preview["suggested_name"],
        fields=[
            AppImportField(
                name=f["name"],
                default_value=f["default_value"],
                is_secret_hint=f["is_secret_hint"],
            )
            for f in preview["fields"]
        ],
    )


@router.post("/{repo_id}/bulk-preview-import", response_model=list[BulkAppImportPreview])
def bulk_preview_repo_import(
    repo_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    repo = get_or_404(db, GitRepo, repo_id)
    repo_path = get_repo_path(repo.id)
    if not (repo_path / ".git").exists():
        try:
            clone_or_pull_repo(repo)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Could not clone repo: {exc}") from exc
    return [BulkAppImportPreview(**item) for item in bulk_preview_import(repo_path)]


@router.post("/{repo_id}/bulk-import", response_model=dict)
def bulk_import_repo_apps(
    repo_id: int,
    body: list[BulkAppImportItem],
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    get_or_404(db, GitRepo, repo_id)
    created = 0
    for item in body:
        app = App(name=item.app_name)
        db.add(app)
        db.flush()
        for field in item.fields:
            db.add(
                AppField(
                    app_id=app.id,
                    name=field.name,
                    default_value=field.default_value,
                    is_secret=field.is_secret_hint,
                )
            )
        created += 1
    db.commit()
    return {"created_apps": created}


@router.post("/{repo_id}/preview-roles", response_model=list[AnsibleRolePreview])
def preview_roles(
    repo_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    """Scan the cloned repo's roles/ directory and return discovered roles with defaults."""
    repo = get_or_404(db, GitRepo, repo_id)
    repo_path = get_repo_path(repo.id)

    if not (repo_path / ".git").exists():
        try:
            clone_or_pull_repo(repo)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Could not clone repo: {exc}") from exc

    try:
        roles = discover_ansible_roles(repo_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return [AnsibleRolePreview(**r) for r in roles]


@router.post("/{repo_id}/import-roles", response_model=RoleImportResult)
def import_roles(
    repo_id: int,
    body: RoleImportRequest,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    """Import selected Ansible roles from the repo into the roles table.

    Roles whose names already exist are skipped. If import_defaults is True for an item,
    defaults/main.yml variables are imported as RoleField rows (replacing any existing fields).
    """
    from sqlalchemy import select

    repo = get_or_404(db, GitRepo, repo_id)
    repo_path = get_repo_path(repo.id)

    if not (repo_path / ".git").exists():
        try:
            clone_or_pull_repo(repo)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Could not clone repo: {exc}") from exc

    try:
        discovered = {r["name"]: r for r in discover_ansible_roles(repo_path)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    existing_names = set(db.execute(select(Role.name)).scalars().all())

    created = 0
    skipped = 0
    errors: list[dict] = []

    for item in body.items:
        if item.name in existing_names:
            skipped += 1
            continue
        try:
            disc = discovered.get(item.name, {})
            description = item.description if item.description is not None else disc.get("description")
            role = Role(name=item.name, description=description)
            db.add(role)
            db.flush()

            if item.import_defaults:
                defaults: dict = disc.get("defaults") or {}
                for var_name, var_value in defaults.items():
                    db.add(RoleField(role_id=role.id, name=var_name, default_value=var_value, is_secret=False))

            existing_names.add(item.name)
            created += 1
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            errors.append({"name": item.name, "detail": str(exc)})

    db.commit()
    return RoleImportResult(
        requested=len(body.items),
        created=created,
        skipped=skipped,
        errors=errors,
    )
