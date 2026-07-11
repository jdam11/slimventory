from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class AuditLogEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ts: datetime
    username: Optional[str] = None
    ip: Optional[str] = None
    method: str
    path: str
    entity: Optional[str] = None
    entity_id: Optional[str] = None
    action: Optional[str] = None
    status_code: int
