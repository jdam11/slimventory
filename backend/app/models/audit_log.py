from __future__ import annotations

from sqlalchemy import Column, DateTime, Integer, String, func

from .base import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ts = Column(DateTime, nullable=False, server_default=func.now(), index=True)
    username = Column(String(150), nullable=True)
    ip = Column(String(45), nullable=True)
    method = Column(String(10), nullable=False)
    path = Column(String(512), nullable=False)
    entity = Column(String(100), nullable=True, index=True)
    entity_id = Column(String(100), nullable=True)
    action = Column(String(20), nullable=True)
    status_code = Column(Integer, nullable=False)
