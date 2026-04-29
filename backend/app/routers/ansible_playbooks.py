"""Ansible playbooks router.

GET /ansible-playbooks/          – list all (optionally filter by repo_id)
GET /ansible-playbooks/{id}      – get one
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_authenticated
from app.models.auth import AppUser
from app.models.git import AnsiblePlaybook
from app.schemas.git import AnsiblePlaybookRead
from app.schemas.inventory import PageResponse

router = APIRouter(prefix="/ansible-playbooks", tags=["ansible-playbooks"])


@router.get("/", response_model=PageResponse[AnsiblePlaybookRead])
def list_playbooks(
    repo_id: int = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    q = select(AnsiblePlaybook)
    if repo_id is not None:
        q = q.where(AnsiblePlaybook.repo_id == repo_id)
    from sqlalchemy import func
    from sqlalchemy import select as sa_select

    count_q = sa_select(func.count()).select_from(AnsiblePlaybook)
    if repo_id is not None:
        count_q = count_q.where(AnsiblePlaybook.repo_id == repo_id)
    total = db.scalar(count_q) or 0
    items = db.execute(q.offset(skip).limit(limit)).scalars().all()
    return {"items": list(items), "total": total}


@router.get("/{playbook_id}", response_model=AnsiblePlaybookRead)
def get_playbook(
    playbook_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    from app.crud import get_or_404

    return get_or_404(db, AnsiblePlaybook, playbook_id)
