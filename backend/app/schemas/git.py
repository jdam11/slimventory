from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from app.models.git import (
    GitAuthType,
    GitRepoType,
    PlaybookHostSource,
    PlaybookRunStatus,
)
from app.models.job_templates import InventoryFilterType


class GitRepoCreate(BaseModel):
    name: str
    url: str
    branch: str = "main"
    repo_type: GitRepoType = GitRepoType.ansible
    auth_type: GitAuthType = GitAuthType.none
    credential_id: Optional[int] = None
    https_username: Optional[str] = None
    # Write-only — accepted on create/update but never returned
    https_password: Optional[str] = None
    ssh_private_key: Optional[str] = None

    @field_validator("url")
    @classmethod
    def url_must_not_contain_credentials(cls, v: str) -> str:
        from urllib.parse import urlparse

        parsed = urlparse(v)
        if parsed.username or parsed.password:
            raise ValueError(
                "Do not embed credentials in the URL. "
                "Use the auth_type, https_username, and https_password fields instead."
            )
        return v


class GitRepoUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    branch: Optional[str] = None
    repo_type: Optional[GitRepoType] = None
    auth_type: Optional[GitAuthType] = None
    credential_id: Optional[int] = None
    https_username: Optional[str] = None
    https_password: Optional[str] = None
    ssh_private_key: Optional[str] = None

    @field_validator("url")
    @classmethod
    def url_must_not_contain_credentials(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        from urllib.parse import urlparse

        parsed = urlparse(v)
        if parsed.username or parsed.password:
            raise ValueError(
                "Do not embed credentials in the URL. "
                "Use the auth_type, https_username, and https_password fields instead."
            )
        return v


class GitRepoRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    url: str
    branch: str
    repo_type: GitRepoType
    auth_type: GitAuthType
    credential_id: Optional[int] = None
    credential_name: Optional[str] = None
    https_username: Optional[str] = None
    # Sensitive fields: indicate presence but never return plaintext
    has_https_password: bool = False
    has_ssh_key: bool = False
    last_synced_at: Optional[datetime] = None
    created_at: datetime

    @classmethod
    def from_orm_safe(cls, obj: Any) -> "GitRepoRead":
        return cls(
            id=obj.id,
            name=obj.name,
            url=obj.url,
            branch=obj.branch,
            repo_type=obj.repo_type,
            auth_type=obj.auth_type,
            credential_id=obj.credential_id,
            credential_name=getattr(getattr(obj, "credential", None), "name", None),
            https_username=obj.https_username,
            has_https_password=bool(
                obj.https_password or getattr(getattr(obj, "credential", None), "https_password", None)
            ),
            has_ssh_key=bool(obj.ssh_private_key or getattr(getattr(obj, "credential", None), "ssh_private_key", None)),
            last_synced_at=obj.last_synced_at,
            created_at=obj.created_at,
        )


class GitCredentialCreate(BaseModel):
    name: str
    auth_type: GitAuthType
    https_username: Optional[str] = None
    https_password: Optional[str] = None
    ssh_private_key: Optional[str] = None


class GitCredentialUpdate(BaseModel):
    name: Optional[str] = None
    auth_type: Optional[GitAuthType] = None
    https_username: Optional[str] = None
    https_password: Optional[str] = None
    ssh_private_key: Optional[str] = None


class GitCredentialRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    auth_type: GitAuthType
    https_username: Optional[str] = None
    has_https_password: bool = False
    has_ssh_key: bool = False
    created_at: datetime

    @classmethod
    def from_orm_safe(cls, obj: Any) -> "GitCredentialRead":
        return cls(
            id=obj.id,
            name=obj.name,
            auth_type=obj.auth_type,
            https_username=obj.https_username,
            has_https_password=bool(obj.https_password),
            has_ssh_key=bool(obj.ssh_private_key),
            created_at=obj.created_at,
        )




class GitRepoSyncResult(BaseModel):
    repo_id: int
    synced_playbooks: int
    message: str




class AppImportField(BaseModel):
    name: str
    default_value: Optional[str] = None
    is_secret_hint: bool = False


class AppImportPreview(BaseModel):
    suggested_name: str
    fields: List[AppImportField]


class BulkAppImportPreview(BaseModel):
    category: Optional[str] = None
    subpath: str
    suggested_name: str
    fields: List[AppImportField]


class BulkAppImportItem(BaseModel):
    app_name: str
    fields: List[AppImportField]
    category: Optional[str] = None
    subpath: str




class AnsiblePlaybookRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    repo_id: int
    path: str




class PlaybookRunCreate(BaseModel):
    playbook_id: int
    host_source: PlaybookHostSource = PlaybookHostSource.inventory
    # List of host IDs from slimventory inventory (used when host_source=inventory)
    target_host_ids: Optional[List[int]] = None
    inventory_filter_type: Optional[InventoryFilterType] = None
    inventory_filter_value: Any = None
    # Extra variables passed to ansible-playbook via -e
    extra_vars: Optional[Dict[str, Any]] = None

    @model_validator(mode="after")
    def normalize_inventory_filter(self) -> "PlaybookRunCreate":
        if self.host_source == PlaybookHostSource.repo:
            self.inventory_filter_type = None
            self.inventory_filter_value = None
            return self

        if self.inventory_filter_type is None:
            if self.target_host_ids:
                self.inventory_filter_type = InventoryFilterType.hosts
                self.inventory_filter_value = self.target_host_ids
            else:
                self.inventory_filter_type = InventoryFilterType.all
                self.inventory_filter_value = None
        elif (
            self.inventory_filter_type == InventoryFilterType.hosts
            and self.inventory_filter_value is None
            and self.target_host_ids is not None
        ):
            self.inventory_filter_value = self.target_host_ids

        return self


class PlaybookRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    playbook_id: int
    run_by_id: int
    host_source: PlaybookHostSource
    target_host_ids: Optional[List[int]] = None
    inventory_filter_type: Optional[InventoryFilterType] = None
    inventory_filter_value: Any = None
    extra_vars: Optional[Dict[str, Any]] = None
    job_template_id: Optional[int] = None
    status: PlaybookRunStatus
    output: Optional[str] = None
    exit_code: Optional[int] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None




class AnsibleRolePreview(BaseModel):
    """One discovered role from the roles/ directory of a cloned repo."""

    name: str
    description: Optional[str] = None
    defaults: Dict[str, Optional[str]] = {}


class RoleImportItem(BaseModel):
    """One role selected by the user for import."""

    name: str
    description: Optional[str] = None  # override; None = keep what was discovered
    import_defaults: bool = True  # create RoleField rows from defaults/main.yml


class RoleImportRequest(BaseModel):
    items: List[RoleImportItem]


class RoleImportResult(BaseModel):
    requested: int
    created: int
    skipped: int
    errors: List[Dict[str, Any]] = []
