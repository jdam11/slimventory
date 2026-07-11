from __future__ import annotations

from sqlalchemy import JSON, Boolean, Column, DateTime, Integer, String, func

from .base import Base


class NotificationChannel(Base):
    __tablename__ = "notification_channels"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, unique=True)
    type = Column(String(20), nullable=False)
    url = Column(String(512), nullable=False)
    secret_encrypted = Column(String(512), nullable=True)
    events = Column(JSON, nullable=False, default=list)
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
