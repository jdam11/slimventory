from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import Host, HostRole, Role
from app.schemas.inventory import (
    RoleMatrixAssignment,
    RoleMatrixHost,
    RoleMatrixResponse,
    RoleMatrixRole,
    RoleMatrixToggleRequest,
    RoleMatrixToggleResponse,
)

router = APIRouter(prefix="/role-matrix", tags=["role-matrix"])


@router.get("/", response_model=RoleMatrixResponse)
def get_matrix(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
) -> RoleMatrixResponse:
    hosts = db.execute(select(Host).order_by(Host.name.asc())).scalars().all()
    roles = db.execute(select(Role).order_by(Role.name.asc())).scalars().all()
    assignments = db.execute(select(HostRole).order_by(HostRole.host_id.asc(), HostRole.priority.asc())).scalars().all()

    return RoleMatrixResponse(
        hosts=[
            RoleMatrixHost(
                id=h.id,
                name=h.name,
                environment_id=h.environment_id,
                host_type_id=h.host_type_id,
            )
            for h in hosts
        ],
        roles=[RoleMatrixRole(id=r.id, name=r.name, description=r.description) for r in roles],
        assignments=[
            RoleMatrixAssignment(host_id=a.host_id, role_id=a.role_id, priority=a.priority) for a in assignments
        ],
    )


@router.post(
    "/toggle",
    response_model=RoleMatrixToggleResponse,
    status_code=status.HTTP_200_OK,
)
def toggle_assignment(
    body: RoleMatrixToggleRequest,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
) -> RoleMatrixToggleResponse:
    host = db.get(Host, body.host_id)
    if host is None:
        raise HTTPException(status_code=404, detail=f"Host {body.host_id} not found")
    role = db.get(Role, body.role_id)
    if role is None:
        raise HTTPException(status_code=404, detail=f"Role {body.role_id} not found")

    existing = db.execute(
        select(HostRole).where(
            HostRole.host_id == body.host_id,
            HostRole.role_id == body.role_id,
        )
    ).scalar_one_or_none()

    if existing is not None:
        db.execute(
            delete(HostRole).where(
                HostRole.host_id == body.host_id,
                HostRole.role_id == body.role_id,
            )
        )
        db.commit()
        return RoleMatrixToggleResponse(
            host_id=body.host_id,
            role_id=body.role_id,
            action="removed",
            priority=None,
        )

    if body.priority is not None:
        priority = body.priority
    else:
        max_priority = db.execute(
            select(HostRole.priority)
            .where(HostRole.host_id == body.host_id)
            .order_by(HostRole.priority.desc())
            .limit(1)
        ).scalar_one_or_none()
        priority = (max_priority or 0) + 1

    db.add(HostRole(host_id=body.host_id, role_id=body.role_id, priority=priority))
    db.commit()
    return RoleMatrixToggleResponse(
        host_id=body.host_id,
        role_id=body.role_id,
        action="added",
        priority=priority,
    )
