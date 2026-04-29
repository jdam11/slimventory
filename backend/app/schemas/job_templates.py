from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict

from app.models.job_templates import InventoryFilterType


class VaultCredentialCreate(BaseModel):
    name: str
    vault_password: Optional[str] = None


class VaultCredentialUpdate(BaseModel):
    name: Optional[str] = None
    vault_password: Optional[str] = None


class VaultCredentialRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    has_password: bool
    created_at: datetime


class JobTemplateCreate(BaseModel):
    name: str
    description: Optional[str] = None
    playbook_id: Optional[int] = None
    inventory_filter_type: InventoryFilterType = InventoryFilterType.all
    inventory_filter_value: Any = None
    inventory_filters: Optional[Dict[str, Any]] = None
    extra_vars: Optional[Dict[str, Any]] = None
    vault_credential_id: Optional[int] = None
    runbook_enabled: bool = False
    runbook_category: Optional[str] = None
    recommended_when: Optional[str] = None
    risk_level: Optional[str] = None
    alert_match_type: Optional[str] = None
    alert_match_value: Optional[str] = None


class JobTemplateUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    playbook_id: Optional[int] = None
    inventory_filter_type: Optional[InventoryFilterType] = None
    inventory_filter_value: Any = None
    inventory_filters: Optional[Dict[str, Any]] = None
    extra_vars: Optional[Dict[str, Any]] = None
    vault_credential_id: Optional[int] = None
    runbook_enabled: Optional[bool] = None
    runbook_category: Optional[str] = None
    recommended_when: Optional[str] = None
    risk_level: Optional[str] = None
    alert_match_type: Optional[str] = None
    alert_match_value: Optional[str] = None


class JobTemplateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: Optional[str] = None
    playbook_id: Optional[int] = None
    inventory_filter_type: InventoryFilterType
    inventory_filter_value: Any = None
    inventory_filters: Optional[Dict[str, Any]] = None
    extra_vars: Optional[Dict[str, Any]] = None
    vault_credential_id: Optional[int] = None
    runbook_enabled: bool = False
    runbook_category: Optional[str] = None
    recommended_when: Optional[str] = None
    risk_level: Optional[str] = None
    alert_match_type: Optional[str] = None
    alert_match_value: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class JobTemplateScheduleCreate(BaseModel):
    cron_expr: str
    is_enabled: bool = True


class JobTemplateScheduleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_template_id: int
    cron_expr: str
    is_enabled: bool
    next_run_at: Optional[datetime] = None
    last_run_at: Optional[datetime] = None
    created_at: datetime


class JobTemplatePreviewHostRead(BaseModel):
    host_id: int
    hostname: str
    ipv4: Optional[str] = None
    groups: List[str] = []
    matched_by: List[str] = []
    matched_groups: List[str] = []
    matched_play_names: List[str] = []
    filter_reason: Optional[str] = None


class JobTemplatePreviewTaskRead(BaseModel):
    name: str
    kind: str
    source_path: str
    confidence: Literal["direct", "dynamic", "unknown"]
    dynamic_reason: Optional[str] = None
    tags: List[str] = []
    children: List["JobTemplatePreviewTaskRead"] = []


class JobTemplatePreviewPlayHostMatchRead(BaseModel):
    host_id: int
    hostname: str
    matched_by: List[str] = []
    matched_groups: List[str] = []
    target_reason: Optional[str] = None


class JobTemplatePreviewPlayRead(BaseModel):
    name: str
    hosts_pattern: str
    confidence: Literal["direct", "dynamic", "unknown"]
    matched_host_ids: List[int] = []
    matched_hostnames: List[str] = []
    host_matches: List[JobTemplatePreviewPlayHostMatchRead] = []
    tasks: List[JobTemplatePreviewTaskRead] = []


class JobTemplatePreviewRead(BaseModel):
    job_template_id: int
    playbook_id: Optional[int] = None
    playbook_path: Optional[str] = None
    repo_commit_sha: Optional[str] = None
    generated_at: datetime
    template_fingerprint: str
    inventory_fingerprint: str
    confidence: Literal["direct", "dynamic", "unknown"]
    target_hosts: List[JobTemplatePreviewHostRead] = []
    unmatched_patterns: List[str] = []
    dynamic_reasons: List[str] = []
    plays: List[JobTemplatePreviewPlayRead] = []
