import enum

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy import Enum as SAEnum

from .base import Base


class InventoryFilterType(str, enum.Enum):
    all = "all"
    environment = "environment"
    role = "role"
    status = "status"
    vlan = "vlan"
    pattern = "pattern"
    hosts = "hosts"


class VaultCredential(Base):
    __tablename__ = "vault_credentials"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(128), unique=True, nullable=False)
    vault_password = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class JobTemplate(Base):
    __tablename__ = "job_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(128), unique=True, nullable=False)
    description = Column(Text, nullable=True)
    playbook_id = Column(Integer, ForeignKey("ansible_playbooks.id", ondelete="SET NULL"), nullable=True)
    inventory_filter_type = Column(
        SAEnum(InventoryFilterType),
        nullable=False,
        default=InventoryFilterType.all,
    )
    inventory_filter_value = Column(JSON, nullable=True)
    inventory_filters = Column(JSON, nullable=True)
    extra_vars = Column(JSON, nullable=True)
    vault_credential_id = Column(
        Integer,
        ForeignKey("vault_credentials.id", ondelete="SET NULL"),
        nullable=True,
    )
    runbook_enabled = Column(Boolean, nullable=False, default=False)
    runbook_category = Column(String(64), nullable=True)
    recommended_when = Column(Text, nullable=True)
    risk_level = Column(String(32), nullable=True)
    alert_match_type = Column(String(64), nullable=True)
    alert_match_value = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class JobTemplateSchedule(Base):
    __tablename__ = "job_template_schedules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_template_id = Column(Integer, ForeignKey("job_templates.id", ondelete="CASCADE"), nullable=False, unique=True)
    cron_expr = Column(String(100), nullable=False)
    is_enabled = Column(Boolean, nullable=False, default=True)
    next_run_at = Column(DateTime, nullable=True)
    last_run_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class JobTemplatePreviewCache(Base):
    __tablename__ = "job_template_preview_cache"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_template_id = Column(Integer, ForeignKey("job_templates.id", ondelete="CASCADE"), nullable=False, unique=True)
    playbook_id = Column(Integer, ForeignKey("ansible_playbooks.id", ondelete="SET NULL"), nullable=True)
    repo_commit_sha = Column(String(64), nullable=True)
    template_fingerprint = Column(String(128), nullable=False)
    inventory_fingerprint = Column(String(128), nullable=False)
    preview_json = Column(JSON, nullable=False)
    generated_at = Column(DateTime, server_default=func.now(), nullable=False)
