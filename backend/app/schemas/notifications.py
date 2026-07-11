from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

NotificationType = Literal["ntfy", "gotify", "discord", "slack", "generic_webhook"]


class NotificationChannelBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: NotificationType
    url: str = Field(min_length=1, max_length=512)
    events: List[str] = Field(default_factory=list)
    enabled: bool = True


class NotificationChannelCreate(NotificationChannelBase):
    secret: Optional[str] = None


class NotificationChannelUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    type: Optional[NotificationType] = None
    url: Optional[str] = Field(default=None, min_length=1, max_length=512)
    events: Optional[List[str]] = None
    enabled: Optional[bool] = None
    secret: Optional[str] = None


class NotificationChannelRead(NotificationChannelBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    has_secret: bool
    created_at: datetime


class NotificationTestResult(BaseModel):
    ok: bool
    detail: str
