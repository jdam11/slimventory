from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text, func

from .base import Base


class AnsibleRunnerSettings(Base):
    __tablename__ = "ansible_runner_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    kerberos_enabled = Column(Boolean, nullable=False, default=False)
    kerberos_krb5_conf = Column(Text, nullable=True)
    kerberos_ccache_name = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
