from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class BackupConfigRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    schedule_enabled: bool
    cron_expression: str
    timezone: str
    retention_count: int
    updated_at: datetime


class BackupConfigUpdate(BaseModel):
    schedule_enabled: bool
    cron_expression: str
    timezone: str = "UTC"
    retention_count: int = Field(ge=1, le=100)


class BackupHistoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    filename: str
    size_bytes: int
    status: str
    trigger_source: str
    error_message: Optional[str] = None
    started_at: datetime
    completed_at: Optional[datetime] = None
    created_by: Optional[str] = None


class RestoreRequest(BaseModel):
    backup_id: int
    confirm: bool
