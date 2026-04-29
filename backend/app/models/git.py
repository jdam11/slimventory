import enum

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import relationship

from .base import Base
from .job_templates import InventoryFilterType


class GitRepoType(str, enum.Enum):
    ansible = "ansible"
    app = "app"


class GitAuthType(str, enum.Enum):
    none = "none"
    https = "https"
    ssh = "ssh"


class PlaybookHostSource(str, enum.Enum):
    inventory = "inventory"
    repo = "repo"


class PlaybookRunStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    success = "success"
    failed = "failed"
    cancelled = "cancelled"


class GitRepo(Base):
    __tablename__ = "git_repos"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(128), unique=True, nullable=False)
    url = Column(String(512), nullable=False)
    branch = Column(String(128), nullable=False, default="main")
    repo_type = Column(SAEnum(GitRepoType), nullable=False, default=GitRepoType.ansible)
    auth_type = Column(SAEnum(GitAuthType), nullable=False, default=GitAuthType.none)
    credential_id = Column(Integer, ForeignKey("git_credentials.id", ondelete="SET NULL"), nullable=True)
    # Encrypted fields — never returned in API responses
    https_username = Column(String(255), nullable=True)
    https_password = Column(Text, nullable=True)
    ssh_private_key = Column(Text, nullable=True)
    last_synced_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    credential = relationship("GitCredential", foreign_keys=[credential_id])


class GitCredential(Base):
    __tablename__ = "git_credentials"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(128), unique=True, nullable=False)
    auth_type = Column(SAEnum(GitAuthType), nullable=False, default=GitAuthType.none)
    https_username = Column(String(255), nullable=True)
    https_password = Column(Text, nullable=True)
    ssh_private_key = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class AnsiblePlaybook(Base):
    __tablename__ = "ansible_playbooks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    repo_id = Column(Integer, ForeignKey("git_repos.id", ondelete="CASCADE"), nullable=False)
    path = Column(String(512), nullable=False)

    __table_args__ = (UniqueConstraint("repo_id", "path", name="uq_ansible_playbooks_repo_path"),)


class PlaybookRun(Base):
    __tablename__ = "playbook_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    playbook_id = Column(Integer, ForeignKey("ansible_playbooks.id", ondelete="RESTRICT"), nullable=False)
    run_by_id = Column(Integer, ForeignKey("app_users.id", ondelete="RESTRICT"), nullable=False)
    host_source = Column(SAEnum(PlaybookHostSource), nullable=False, default=PlaybookHostSource.inventory)
    target_host_ids = Column(JSON, nullable=True)
    inventory_filter_type = Column(SAEnum(InventoryFilterType), nullable=True)
    inventory_filter_value = Column(JSON, nullable=True)
    extra_vars = Column(JSON, nullable=True)
    job_template_id = Column(Integer, ForeignKey("job_templates.id", ondelete="SET NULL"), nullable=True)
    status = Column(SAEnum(PlaybookRunStatus), nullable=False, default=PlaybookRunStatus.pending)
    output = Column(Text().with_variant(LONGTEXT(), "mysql"), nullable=True)
    exit_code = Column(Integer, nullable=True)
    sidecar_job_id = Column(String(64), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
