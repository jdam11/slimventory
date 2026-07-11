from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_admin
from ..models.audit_log import AuditLog
from ..schemas.audit import AuditLogEntry
from ..schemas.inventory import PageResponse

router = APIRouter(prefix="/audit", tags=["audit"], dependencies=[Depends(require_admin)])


@router.get("", response_model=PageResponse[AuditLogEntry])
def list_audit_log(
    db: Session = Depends(get_db),
    entity: Optional[str] = None,
    username: Optional[str] = None,
    action: Optional[str] = None,
    since: Optional[datetime] = None,
    skip: int = 0,
    limit: int = Query(default=50, le=500),
) -> PageResponse[AuditLogEntry]:
    query = db.query(AuditLog)
    if entity:
        query = query.filter(AuditLog.entity == entity)
    if username:
        query = query.filter(AuditLog.username == username)
    if action:
        query = query.filter(AuditLog.action == action)
    if since:
        query = query.filter(AuditLog.ts >= since)

    total = query.count()
    rows = query.order_by(AuditLog.ts.desc(), AuditLog.id.desc()).offset(skip).limit(limit).all()
    return PageResponse[AuditLogEntry](items=rows, total=total)
