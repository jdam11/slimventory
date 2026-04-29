import ipaddress
from datetime import datetime
from typing import Generic, List, Literal, Optional, TypeVar
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _is_dangerous_url(url: str) -> bool:
    """Block loopback and link-local URLs to prevent SSRF.

    RFC1918 private ranges are allowed because Proxmox hosts are typically
    on private LANs.
    """
    parsed = urlparse(url)
    hostname = parsed.hostname
    if not hostname:
        return True
    if hostname in ("localhost", "0.0.0.0"):
        return True
    try:
        addr = ipaddress.ip_address(hostname)
        return addr.is_loopback or addr.is_link_local or addr.is_reserved
    except ValueError:
        return False


T = TypeVar("T")


class PageResponse(BaseModel, Generic[T]):
    items: List[T]
    total: int




class EnvironmentCreate(BaseModel):
    name: str


class EnvironmentUpdate(BaseModel):
    name: Optional[str] = None


class EnvironmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str




class HostTypeCreate(BaseModel):
    name: str


class HostTypeUpdate(BaseModel):
    name: Optional[str] = None


class HostTypeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str




class VlanCreate(BaseModel):
    vlan_id: int
    subnet: Optional[str] = None
    description: Optional[str] = None


class VlanUpdate(BaseModel):
    vlan_id: Optional[int] = None
    subnet: Optional[str] = None
    description: Optional[str] = None


class VlanRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    vlan_id: int
    subnet: Optional[str] = None
    description: Optional[str] = None




class RoleCreate(BaseModel):
    name: str
    description: Optional[str] = None


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class RoleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    description: Optional[str] = None




class AppCreate(BaseModel):
    name: str
    description: Optional[str] = None


class AppUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class AppRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    description: Optional[str] = None




class DatastoreCreate(BaseModel):
    name: str
    description: Optional[str] = None


class DatastoreUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class DatastoreRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    description: Optional[str] = None




class DomainCreate(BaseModel):
    fqdn: str


class DomainUpdate(BaseModel):
    fqdn: Optional[str] = None


class DomainRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    fqdn: str




class K3sClusterCreate(BaseModel):
    name: str
    environment_id: int


class K3sClusterUpdate(BaseModel):
    name: Optional[str] = None
    environment_id: Optional[int] = None


class K3sClusterRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    environment_id: int


class K3sClusterAppCreate(BaseModel):
    cluster_id: int
    app_id: int


class K3sClusterAppBulkCreate(BaseModel):
    cluster_id: int
    app_ids: List[int]


class K3sClusterAppRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    cluster_id: int
    app_id: int




class HostStatusCreate(BaseModel):
    name: str


class HostStatusUpdate(BaseModel):
    name: Optional[str] = None


class HostStatusRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str




class StatusFieldCreate(BaseModel):
    status_id: int
    name: str
    default_value: Optional[str] = None
    is_secret: Optional[bool] = None  # None = auto-detect from name


class StatusFieldUpdate(BaseModel):
    name: Optional[str] = None
    default_value: Optional[str] = None
    is_secret: Optional[bool] = None  # None = auto-detect from name


class StatusFieldRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    status_id: int
    name: str
    default_value: Optional[str] = None
    is_secret: bool = False


class StatusFieldsBulkYaml(BaseModel):
    """Map of ansible_var_name -> default_value (string or None)."""

    fields: dict[str, Optional[str]]




class HostStatusFieldEntry(BaseModel):
    field_id: int
    value: Optional[str] = None


class HostStatusFieldBatchUpsert(BaseModel):
    host_id: int
    values: List[HostStatusFieldEntry]


class HostStatusFieldRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    host_id: int
    field_id: int
    value: Optional[str] = None
    field_name: Optional[str] = None
    is_secret: bool = False


class HostCreate(BaseModel):
    id: int  # VMID — user-assigned
    environment_id: int
    host_type_id: int
    name: str
    vlan_id: int
    ipv4: str
    mac: Optional[str] = None
    role_ids: List[int]
    status_id: Optional[int] = None
    k3s_cluster_id: Optional[int] = None
    proxmox_host_id: Optional[int] = None
    proxmox_node: Optional[str] = None
    domain_internal_id: Optional[int] = None
    domain_external_id: Optional[int] = None
    notes: Optional[str] = None


class HostUpdate(BaseModel):
    environment_id: Optional[int] = None
    host_type_id: Optional[int] = None
    name: Optional[str] = None
    vlan_id: Optional[int] = None
    ipv4: Optional[str] = None
    mac: Optional[str] = None
    role_ids: Optional[List[int]] = None
    status_id: Optional[int] = None
    k3s_cluster_id: Optional[int] = None
    proxmox_host_id: Optional[int] = None
    proxmox_node: Optional[str] = None
    domain_internal_id: Optional[int] = None
    domain_external_id: Optional[int] = None
    notes: Optional[str] = None


class HostRolesBulkAdd(BaseModel):
    host_ids: List[int]
    role_ids: List[int]


class HostRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    environment_id: int
    host_type_id: int
    name: str
    vlan_id: int
    ipv4: str
    mac: Optional[str] = None
    role_ids: List[int] = []
    status_id: Optional[int] = None
    k3s_cluster_id: Optional[int] = None
    proxmox_host_id: Optional[int] = None
    proxmox_node: Optional[str] = None
    domain_internal_id: Optional[int] = None
    domain_external_id: Optional[int] = None
    notes: Optional[str] = None
    last_synced_at: Optional[datetime] = None
    unifi_observed_ip: Optional[str] = None
    effective_ipv4: Optional[str] = None
    unifi_network_name: Optional[str] = None
    unifi_vlan_tag: Optional[int] = None
    unifi_last_seen_at: Optional[datetime] = None
    unifi_port_forward_count: int = 0
    unifi_port_forwards: List["UnifiPortForwardRead"] = Field(default_factory=list)




class HostRoleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    host_id: int
    role_id: int
    priority: int




class RoleMatrixHost(BaseModel):
    id: int
    name: str
    environment_id: int
    host_type_id: int


class RoleMatrixRole(BaseModel):
    id: int
    name: str
    description: Optional[str] = None


class RoleMatrixAssignment(BaseModel):
    host_id: int
    role_id: int
    priority: int


class RoleMatrixResponse(BaseModel):
    hosts: List[RoleMatrixHost]
    roles: List[RoleMatrixRole]
    assignments: List[RoleMatrixAssignment]


class RoleMatrixToggleRequest(BaseModel):
    host_id: int
    role_id: int
    priority: Optional[int] = None


class RoleMatrixToggleResponse(BaseModel):
    host_id: int
    role_id: int
    action: Literal["added", "removed"]
    priority: Optional[int] = None




class GlobalDefaultRoleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    role_id: int
    priority: int


class GlobalDefaultRoleItem(BaseModel):
    role_id: int
    priority: int




class HostTypeRoleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    host_type_id: int
    role_id: int
    priority: int


class HostTypeRoleItem(BaseModel):
    role_id: int
    priority: int




class HostTypeFieldCreate(BaseModel):
    host_type_id: int
    name: str
    default_value: Optional[str] = None
    is_secret: Optional[bool] = None


class HostTypeFieldUpdate(BaseModel):
    name: Optional[str] = None
    default_value: Optional[str] = None
    is_secret: Optional[bool] = None


class HostTypeFieldRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    host_type_id: int
    name: str
    default_value: Optional[str] = None
    is_secret: bool = False


class HostTypeFieldsBulkYaml(BaseModel):
    fields: dict




class HostHostTypeFieldEntry(BaseModel):
    field_id: int
    value: Optional[str] = None


class HostHostTypeFieldBatchUpsert(BaseModel):
    host_id: int
    values: List[HostHostTypeFieldEntry]


class HostHostTypeFieldRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    host_id: int
    field_id: int
    value: Optional[str] = None
    field_name: Optional[str] = None
    is_secret: bool = False




class HostResourceCreate(BaseModel):
    host_id: int
    cpu_sockets: int = 1
    cpu_cores: int
    ram_mb: int


class HostResourceUpdate(BaseModel):
    cpu_sockets: Optional[int] = None
    cpu_cores: Optional[int] = None
    ram_mb: Optional[int] = None


class HostResourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    host_id: int
    cpu_sockets: int
    cpu_cores: int
    ram_mb: int




class HostStorageCreate(BaseModel):
    host_id: int
    purpose: str
    datastore_id: int
    size_gb: int


class HostStorageUpdate(BaseModel):
    purpose: Optional[str] = None
    datastore_id: Optional[int] = None
    size_gb: Optional[int] = None


class HostStorageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    host_id: int
    purpose: str
    datastore_id: int
    size_gb: int




class HostAppCreate(BaseModel):
    host_id: int
    app_id: int


class HostAppBulkCreate(BaseModel):
    app_id: int
    host_ids: List[int]


class HostAppRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    host_id: int
    app_id: int




class AppFieldCreate(BaseModel):
    app_id: int
    name: str
    default_value: Optional[str] = None
    is_secret: Optional[bool] = None  # None = auto-detect from name


class AppFieldUpdate(BaseModel):
    name: Optional[str] = None
    default_value: Optional[str] = None
    is_secret: Optional[bool] = None  # None = auto-detect from name


class AppFieldRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    app_id: int
    name: str
    default_value: Optional[str] = None
    is_secret: bool = False


class AppFieldsBulkYaml(BaseModel):
    """Map of ansible_var_name -> default_value (string or None)."""

    fields: dict[str, Optional[str]]




class HostAppFieldEntry(BaseModel):
    field_id: int
    value: Optional[str] = None


class HostAppFieldBatchUpsert(BaseModel):
    host_id: int
    app_id: int
    values: List[HostAppFieldEntry]


class HostAppFieldRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    host_id: int
    app_id: int
    field_id: int
    value: Optional[str] = None
    field_name: Optional[str] = None
    is_secret: bool = False




class RoleFieldCreate(BaseModel):
    role_id: int
    name: str
    default_value: Optional[str] = None
    is_secret: Optional[bool] = None  # None = auto-detect from name


class RoleFieldUpdate(BaseModel):
    name: Optional[str] = None
    default_value: Optional[str] = None
    is_secret: Optional[bool] = None  # None = auto-detect from name


class RoleFieldRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    role_id: int
    name: str
    default_value: Optional[str] = None
    is_secret: bool = False


class RoleFieldsBulkYaml(BaseModel):
    """Map of ansible_var_name -> default_value (string or None)."""

    fields: dict[str, Optional[str]]




class HostRoleFieldEntry(BaseModel):
    field_id: int
    value: Optional[str] = None


class HostRoleFieldBatchUpsert(BaseModel):
    host_id: int
    values: List[HostRoleFieldEntry]


class HostRoleFieldRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    host_id: int
    field_id: int
    value: Optional[str] = None
    field_name: Optional[str] = None
    is_secret: bool = False




class AnsibleDefaultCreate(BaseModel):
    name: str
    value: Optional[str] = None
    is_secret: Optional[bool] = None  # None = auto-detect from name


class AnsibleDefaultUpdate(BaseModel):
    name: Optional[str] = None
    value: Optional[str] = None
    is_secret: Optional[bool] = None  # None = auto-detect from name


class AnsibleDefaultRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    value: Optional[str] = None
    is_secret: bool = False


class AnsibleDefaultsBulkYaml(BaseModel):
    """Map of ansible_var_name -> value (string or None)."""

    fields: dict[str, Optional[str]]




class HostAnsibleVarEntry(BaseModel):
    var_id: int
    value: Optional[str] = None


class HostAnsibleVarBatchUpsert(BaseModel):
    host_id: int
    values: List[HostAnsibleVarEntry]


class HostAnsibleVarRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    host_id: int
    var_id: int
    value: Optional[str] = None
    var_name: Optional[str] = None
    is_secret: bool = False



InventoryOverrideKind = Literal["ansible_default", "status_field", "role_field", "app_field", "host_type_field"]


class InventoryExplorerHostRead(BaseModel):
    id: int
    name: str
    ipv4: Optional[str] = None
    environment: Optional[str] = None
    host_type: Optional[str] = None
    status: Optional[str] = None
    roles: List[str] = Field(default_factory=list)
    apps: List[str] = Field(default_factory=list)


class InventoryExplorerGroupRead(BaseModel):
    name: str
    label: str
    category: Literal["environment", "role", "type", "vlan", "status", "k3s", "app", "datastore"]


class InventoryExplorerOverrideTargetRead(BaseModel):
    kind: InventoryOverrideKind
    target_id: Optional[int] = None
    target_name: Optional[str] = None
    app_id: Optional[int] = None
    label: str


class InventoryExplorerLineageEntryRead(BaseModel):
    layer_key: str
    layer_label: str
    precedence: int
    source_kind: str
    source_label: str
    value: Optional[str] = None
    is_secret: bool = False
    applied: bool = False
    editable: bool = False
    override_target: Optional[InventoryExplorerOverrideTargetRead] = None


class InventoryExplorerVarRead(BaseModel):
    key: str
    value: Optional[str] = None
    is_secret: bool = False
    source_label: Optional[str] = None
    source_layer: Optional[str] = None
    editable: bool = False
    edit_reason: Optional[str] = None
    override_target: Optional[InventoryExplorerOverrideTargetRead] = None
    has_host_override: bool = False
    lineage: List[InventoryExplorerLineageEntryRead] = Field(default_factory=list)


class InventoryExplorerRead(BaseModel):
    host: InventoryExplorerHostRead
    groups: List[InventoryExplorerGroupRead] = Field(default_factory=list)
    vars: List[InventoryExplorerVarRead] = Field(default_factory=list)


class InventoryExplorerOverrideWrite(BaseModel):
    key: str
    kind: InventoryOverrideKind
    target_id: Optional[int] = None
    target_name: Optional[str] = None
    app_id: Optional[int] = None
    value: Optional[str] = None
    remove: bool = False


class InventoryExplorerOverrideBatchWrite(BaseModel):
    updates: List[InventoryExplorerOverrideWrite]




class UnifiPortForwardRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    host_id: int
    rule_name: Optional[str] = None
    description: Optional[str] = None
    protocol: Optional[str] = None
    external_port: Optional[str] = None
    internal_port: Optional[str] = None
    source_restriction: Optional[str] = None
    enabled: bool
    observed_at: datetime


class UnifiSettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    enabled: bool
    base_url: Optional[str] = None
    username: Optional[str] = None
    site: Optional[str] = None
    verify_tls: bool
    has_password: bool = False
    last_sync_at: Optional[datetime] = None
    last_sync_error: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class UnifiSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    base_url: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    site: Optional[str] = None
    verify_tls: Optional[bool] = None

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        if not value.startswith(("http://", "https://")):
            raise ValueError("base_url must start with http:// or https://")
        if _is_dangerous_url(value):
            raise ValueError("base_url must not point to loopback or link-local addresses")
        return value.rstrip("/")


class UnifiSiteRead(BaseModel):
    id: str
    name: str
    description: Optional[str] = None


class UnifiSyncTriggerRequest(BaseModel):
    trigger_source: Literal["manual", "api"] = "manual"


class UnifiSyncRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    status: str
    trigger_source: str
    message: Optional[str] = None
    stats_json: Optional[str] = None
    started_at: datetime
    completed_at: Optional[datetime] = None


class UnifiVlanPreviewRead(BaseModel):
    network_id: str
    name: str
    vlan_tag: int
    subnet: Optional[str] = None
    purpose: Optional[str] = None


class UnifiVlanImportRequest(BaseModel):
    network_ids: List[str]

    @field_validator("network_ids")
    @classmethod
    def validate_network_ids(cls, value: List[str]) -> List[str]:
        cleaned = [item.strip() for item in value if item and item.strip()]
        if not cleaned:
            raise ValueError("network_ids must contain at least one network id")
        if len(set(cleaned)) != len(cleaned):
            raise ValueError("network_ids must not contain duplicates")
        return cleaned


class UnifiVlanImportResult(BaseModel):
    requested: int
    created: int
    updated: int
    skipped: int
    errors: List[dict[str, str]] = Field(default_factory=list)




class ProxmoxCredentialCreate(BaseModel):
    name: str
    base_url: str
    auth_type: Literal["token", "password"]
    token_id: Optional[str] = None
    token_secret: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    verify_tls: bool = True
    is_active: bool = True

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        if not value.startswith(("http://", "https://")):
            raise ValueError("base_url must start with http:// or https://")
        if _is_dangerous_url(value):
            raise ValueError("base_url must not point to loopback or link-local addresses")
        return value.rstrip("/")

    @model_validator(mode="after")
    def validate_auth_fields(self) -> "ProxmoxCredentialCreate":
        if not self.is_active:
            return self
        if self.auth_type == "token":
            if not self.token_id or not self.token_secret:
                raise ValueError("token_id and token_secret are required for active token auth")
        if self.auth_type == "password":
            if not self.username or not self.password:
                raise ValueError("username and password are required for active password auth")
        return self


class ProxmoxCredentialUpdate(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    auth_type: Optional[Literal["token", "password"]] = None
    token_id: Optional[str] = None
    token_secret: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    verify_tls: Optional[bool] = None
    is_active: Optional[bool] = None

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        if not value.startswith(("http://", "https://")):
            raise ValueError("base_url must start with http:// or https://")
        if _is_dangerous_url(value):
            raise ValueError("base_url must not point to loopback or link-local addresses")
        return value.rstrip("/")


class ProxmoxCredentialRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    base_url: str
    auth_type: Literal["token", "password"]
    token_id: Optional[str] = None
    username: Optional[str] = None
    verify_tls: bool
    is_active: bool
    has_secret: bool
    created_at: datetime
    updated_at: datetime
    last_sync_at: Optional[datetime] = None
    last_sync_error: Optional[str] = None


class ProxmoxSyncScheduleUpdate(BaseModel):
    enabled: bool
    cron_expression: str
    timezone: str = "UTC"


class ProxmoxSyncScheduleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    enabled: bool
    cron_expression: str
    timezone: str
    updated_at: datetime


class ProxmoxSyncTriggerRequest(BaseModel):
    trigger_source: Literal["manual", "api"] = "manual"


class ProxmoxSyncRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    status: str
    trigger_source: str
    message: Optional[str] = None
    stats_json: Optional[str] = None
    started_at: datetime
    completed_at: Optional[datetime] = None


class ProxmoxPendingHostRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    sync_run_id: Optional[int] = None
    credential_id: Optional[int] = None
    vmid: Optional[int] = None
    host_id_override: Optional[int] = None
    name: str
    vm_type: str
    node: Optional[str] = None
    cpu_cores: int
    ram_mb: int
    disks_json: Optional[str] = None
    nets_json: Optional[str] = None
    environment_id: Optional[int] = None
    host_type_id: Optional[int] = None
    vlan_id: Optional[int] = None
    vlan_tag: Optional[int] = None
    role_id: Optional[int] = None
    ipv4: Optional[str] = None
    mac: Optional[str] = None
    notes: Optional[str] = None
    status: str
    created_at: datetime
    reviewed_at: Optional[datetime] = None


class ProxmoxPendingHostUpdate(BaseModel):
    """Patch fields before promoting to a real Host."""

    environment_id: Optional[int] = None
    host_type_id: Optional[int] = None
    vlan_id: Optional[int] = None
    role_id: Optional[int] = None
    ipv4: Optional[str] = None
    mac: Optional[str] = None
    host_id_override: Optional[int] = None
    notes: Optional[str] = None


class ProxmoxPendingBulkActionRequest(BaseModel):
    ids: List[int]

    @field_validator("ids")
    @classmethod
    def validate_ids(cls, value: List[int]) -> List[int]:
        if not value:
            raise ValueError("ids must contain at least one pending host id")
        if len(set(value)) != len(value):
            raise ValueError("ids must not contain duplicates")
        return value


class ProxmoxPendingBulkActionError(BaseModel):
    id: int
    detail: str


class ProxmoxPendingBulkActionResult(BaseModel):
    requested: int
    succeeded: int
    succeeded_ids: List[int]
    errors: List[ProxmoxPendingBulkActionError]


class ProxmoxNodeStorageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    node: str
    storage: str
    datastore_id: Optional[int] = None
    storage_type: Optional[str] = None
    total_gb: Optional[int] = None
    used_gb: Optional[int] = None
    avail_gb: Optional[int] = None
    enabled: bool
    last_synced_at: Optional[datetime] = None


class ProxmoxCredentialImportItem(BaseModel):
    name: str
    base_url: str
    verify_tls: bool = True
    auth_type: Optional[str] = None  # "token" or "password"
    token_id: Optional[str] = None
    token_secret: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    is_active: bool = False

    @field_validator("base_url", mode="before")
    @classmethod
    def normalize_base_url(cls, value: str) -> str:
        if not value.startswith(("http://", "https://")):
            raise ValueError("base_url must start with http:// or https://")
        if _is_dangerous_url(value):
            raise ValueError("base_url must not point to loopback or link-local addresses")
        return value.rstrip("/")


class ProxmoxCredentialImportRequest(BaseModel):
    items: List[ProxmoxCredentialImportItem]

    @field_validator("items")
    @classmethod
    def validate_items(cls, value: List[ProxmoxCredentialImportItem]) -> List[ProxmoxCredentialImportItem]:
        if not value:
            raise ValueError("items must contain at least one credential")
        names = [item.name for item in value]
        if len(set(names)) != len(names):
            raise ValueError("items must not contain duplicate names")
        return value


class ProxmoxCredentialImportResult(BaseModel):
    requested: int
    created: int
    skipped: int
    errors: List[ProxmoxPendingBulkActionError]


HostRead.model_rebuild()




class InventoryRow(BaseModel):
    id: int
    env: Optional[str] = None
    type: Optional[str] = None
    name: Optional[str] = None
    vlan_id: Optional[int] = None
    ipv4: Optional[str] = None
    mac: Optional[str] = None
    role: Optional[str] = None
    k3s_cluster: Optional[str] = None
    apps: Optional[str] = None
    proxmox_host: Optional[str] = None
    vm_cpu_socket: Optional[int] = None
    vm_cpu_core: Optional[int] = None
    vm_ram: Optional[str] = None
    vm_storage_os_datastore: Optional[str] = None
    vm_storage_os_size: Optional[str] = None
    vm_storage_hdd01_datastore: Optional[str] = None
    vm_storage_hdd01_size: Optional[str] = None
    domain_internal: Optional[str] = None
    external_domain: Optional[str] = None
    notes: Optional[str] = None
    proxmox_node: Optional[str] = None
    last_synced_at: Optional[datetime] = None
    status: Optional[str] = None
