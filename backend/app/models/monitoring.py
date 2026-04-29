from __future__ import annotations

import enum

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy import Enum as SAEnum

from .base import Base


class MonitoringAuthType(str, enum.Enum):
    none = "none"
    basic = "basic"
    bearer = "bearer"


class SecretInjectionMode(str, enum.Enum):
    extra_vars = "extra_vars"
    vault_password_file = "vault_password_file"


class MonitoringSettings(Base):
    __tablename__ = "monitoring_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    prometheus_enabled = Column(Boolean, nullable=False, default=False)
    prometheus_url = Column(String(512), nullable=True)
    prometheus_timeout_seconds = Column(Integer, nullable=False, default=10)
    prometheus_verify_tls = Column(Boolean, nullable=False, default=True)
    prometheus_auth_type = Column(SAEnum(MonitoringAuthType), nullable=False, default=MonitoringAuthType.none)
    prometheus_username = Column(String(255), nullable=True)
    prometheus_password = Column(Text, nullable=True)
    prometheus_bearer_token = Column(Text, nullable=True)

    loki_enabled = Column(Boolean, nullable=False, default=False)
    loki_url = Column(String(512), nullable=True)
    loki_timeout_seconds = Column(Integer, nullable=False, default=10)
    loki_verify_tls = Column(Boolean, nullable=False, default=True)
    loki_auth_type = Column(SAEnum(MonitoringAuthType), nullable=False, default=MonitoringAuthType.none)
    loki_username = Column(String(255), nullable=True)
    loki_password = Column(Text, nullable=True)
    loki_bearer_token = Column(Text, nullable=True)

    bitwarden_enabled = Column(Boolean, nullable=False, default=False)
    bitwarden_server_url = Column(String(512), nullable=True)
    bitwarden_access_token = Column(Text, nullable=True)
    bitwarden_verify_tls = Column(Boolean, nullable=False, default=True)
    bitwarden_organization_id = Column(String(128), nullable=True)
    bitwarden_collection_id = Column(String(128), nullable=True)
    bitwarden_auth_method = Column(String(32), nullable=False, default="token")

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class MonitoringSecretMapping(Base):
    __tablename__ = "monitoring_secret_mappings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(128), unique=True, nullable=False)
    job_template_id = Column(Integer, ForeignKey("job_templates.id", ondelete="CASCADE"), nullable=True)
    item_reference = Column(String(255), nullable=False)
    item_field = Column(String(255), nullable=False, default="password")
    ansible_var_name = Column(String(255), nullable=False)
    injection_mode = Column(SAEnum(SecretInjectionMode), nullable=False, default=SecretInjectionMode.extra_vars)
    is_enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
