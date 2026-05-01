from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects import mysql as mysql_dialect
from sqlalchemy.orm import relationship

from .base import Base


class Environment(Base):
    __tablename__ = "environments"

    id = Column(Integer, primary_key=True)
    name = Column(String(32), unique=True, nullable=False)


class HostType(Base):
    __tablename__ = "host_types"

    id = Column(Integer, primary_key=True)
    name = Column(String(32), unique=True, nullable=False)


class Vlan(Base):
    __tablename__ = "vlans"

    id = Column(Integer, primary_key=True)
    vlan_id = Column(Integer, unique=True, nullable=False)
    subnet = Column(String(18), nullable=True)
    description = Column(String(255), nullable=True)


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True)
    name = Column(String(64), unique=True, nullable=False)
    description = Column(String(255), nullable=True)


class App(Base):
    __tablename__ = "apps"

    id = Column(Integer, primary_key=True)
    name = Column(String(64), unique=True, nullable=False)
    description = Column(String(255), nullable=True)


class Datastore(Base):
    __tablename__ = "datastores"

    id = Column(Integer, primary_key=True)
    name = Column(String(64), unique=True, nullable=False)
    description = Column(String(255), nullable=True)


class Domain(Base):
    __tablename__ = "domains"

    id = Column(Integer, primary_key=True)
    fqdn = Column(String(255), unique=True, nullable=False)


class K3sCluster(Base):
    __tablename__ = "k3s_clusters"

    id = Column(Integer, primary_key=True)
    name = Column(String(64), unique=True, nullable=False)
    environment_id = Column(
        Integer,
        ForeignKey("environments.id", onupdate="CASCADE", ondelete="RESTRICT"),
        nullable=False,
    )


class K3sClusterApp(Base):
    __tablename__ = "k3s_cluster_apps"

    cluster_id = Column(
        Integer,
        ForeignKey("k3s_clusters.id", onupdate="CASCADE", ondelete="CASCADE"),
        primary_key=True,
    )
    app_id = Column(
        Integer,
        ForeignKey("apps.id", onupdate="CASCADE", ondelete="CASCADE"),
        primary_key=True,
    )


class HostStatus(Base):
    __tablename__ = "host_statuses"

    id = Column(Integer, primary_key=True)
    name = Column(String(64), unique=True, nullable=False)


class StatusField(Base):
    __tablename__ = "status_fields"

    id = Column(Integer, primary_key=True)
    status_id = Column(
        Integer,
        ForeignKey("host_statuses.id", onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(String(64), nullable=False)
    default_value = Column(Text, nullable=True)
    is_secret = Column(Boolean, nullable=False, default=False)

    __table_args__ = (UniqueConstraint("status_id", "name", name="uq_status_fields_status_name"),)


class HostStatusField(Base):
    __tablename__ = "host_status_fields"

    host_id = Column(
        Integer,
        ForeignKey("hosts.id", onupdate="CASCADE", ondelete="CASCADE"),
        primary_key=True,
    )
    field_id = Column(
        Integer,
        ForeignKey("status_fields.id", onupdate="CASCADE", ondelete="CASCADE"),
        primary_key=True,
    )
    value = Column(Text, nullable=True)


class Host(Base):
    __tablename__ = "hosts"

    # Proxmox VMID — user-assigned, NOT auto-increment
    id = Column(Integer, primary_key=True, autoincrement=False)
    environment_id = Column(
        Integer,
        ForeignKey("environments.id", onupdate="CASCADE", ondelete="RESTRICT"),
        nullable=False,
    )
    host_type_id = Column(
        Integer,
        ForeignKey("host_types.id", onupdate="CASCADE", ondelete="RESTRICT"),
        nullable=False,
    )
    name = Column(String(64), nullable=False)
    vlan_id = Column(
        Integer,
        ForeignKey("vlans.id", onupdate="CASCADE", ondelete="RESTRICT"),
        nullable=False,
    )
    ipv4 = Column(String(15), nullable=False)
    mac = Column(String(17), nullable=True)
    k3s_cluster_id = Column(
        Integer,
        ForeignKey("k3s_clusters.id", onupdate="CASCADE", ondelete="SET NULL"),
        nullable=True,
    )
    proxmox_host_id = Column(
        Integer,
        ForeignKey("hosts.id", onupdate="CASCADE", ondelete="SET NULL"),
        nullable=True,
    )
    proxmox_node = Column(String(64), nullable=True)
    last_synced_at = Column(DateTime, nullable=True)
    domain_internal_id = Column(
        Integer,
        ForeignKey("domains.id", onupdate="CASCADE", ondelete="SET NULL"),
        nullable=True,
    )
    domain_external_id = Column(
        Integer,
        ForeignKey("domains.id", onupdate="CASCADE", ondelete="SET NULL"),
        nullable=True,
    )
    status_id = Column(
        Integer,
        ForeignKey("host_statuses.id", onupdate="CASCADE", ondelete="SET NULL"),
        nullable=True,
    )
    notes = Column(Text, nullable=True)


class HostResource(Base):
    __tablename__ = "host_resources"

    id = Column(Integer, primary_key=True)
    host_id = Column(
        Integer,
        ForeignKey("hosts.id", onupdate="CASCADE", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    cpu_sockets = Column(SmallInteger, nullable=False, default=1)
    cpu_cores = Column(SmallInteger, nullable=False)
    ram_mb = Column(Integer, nullable=False)


class HostStorage(Base):
    __tablename__ = "host_storage"

    id = Column(Integer, primary_key=True)
    host_id = Column(
        Integer,
        ForeignKey("hosts.id", onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False,
    )
    purpose = Column(String(32), nullable=False)
    datastore_id = Column(
        Integer,
        ForeignKey("datastores.id", onupdate="CASCADE", ondelete="RESTRICT"),
        nullable=False,
    )
    size_gb = Column(Integer, nullable=False)

    __table_args__ = (UniqueConstraint("host_id", "purpose", name="uq_host_storage_purpose"),)


class HostApp(Base):
    __tablename__ = "host_apps"

    host_id = Column(
        Integer,
        ForeignKey("hosts.id", onupdate="CASCADE", ondelete="CASCADE"),
        primary_key=True,
    )
    app_id = Column(
        Integer,
        ForeignKey("apps.id", onupdate="CASCADE", ondelete="CASCADE"),
        primary_key=True,
    )


class AppField(Base):
    __tablename__ = "app_fields"

    id = Column(Integer, primary_key=True)
    app_id = Column(
        Integer,
        ForeignKey("apps.id", onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(String(64), nullable=False)
    default_value = Column(Text, nullable=True)
    is_secret = Column(Boolean, nullable=False, default=False)

    __table_args__ = (UniqueConstraint("app_id", "name", name="uq_app_fields_app_name"),)


class HostAppField(Base):
    __tablename__ = "host_app_fields"

    host_id = Column(Integer, primary_key=True)
    app_id = Column(Integer, primary_key=True)
    field_id = Column(
        Integer,
        ForeignKey("app_fields.id", onupdate="CASCADE", ondelete="CASCADE"),
        primary_key=True,
    )
    value = Column(Text, nullable=True)


class RoleField(Base):
    __tablename__ = "role_fields"

    id = Column(Integer, primary_key=True)
    role_id = Column(
        Integer,
        ForeignKey("roles.id", onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(String(64), nullable=False)
    default_value = Column(Text, nullable=True)
    is_secret = Column(Boolean, nullable=False, default=False)

    __table_args__ = (UniqueConstraint("role_id", "name", name="uq_role_fields_role_name"),)


class HostRoleField(Base):
    __tablename__ = "host_role_fields"

    host_id = Column(
        Integer,
        ForeignKey("hosts.id", onupdate="CASCADE", ondelete="CASCADE"),
        primary_key=True,
    )
    field_id = Column(
        Integer,
        ForeignKey("role_fields.id", onupdate="CASCADE", ondelete="CASCADE"),
        primary_key=True,
    )
    value = Column(Text, nullable=True)


class AnsibleDefault(Base):
    __tablename__ = "ansible_defaults"

    id = Column(Integer, primary_key=True)
    name = Column(String(64), unique=True, nullable=False)
    value = Column(Text, nullable=True)
    is_secret = Column(Boolean, nullable=False, default=False)


class HostAnsibleVar(Base):
    __tablename__ = "host_ansible_vars"

    host_id = Column(
        Integer,
        ForeignKey("hosts.id", onupdate="CASCADE", ondelete="CASCADE"),
        primary_key=True,
    )
    var_id = Column(
        Integer,
        ForeignKey("ansible_defaults.id", onupdate="CASCADE", ondelete="CASCADE"),
        primary_key=True,
    )
    value = Column(Text, nullable=True)


class ProxmoxCredential(Base):
    __tablename__ = "proxmox_credentials"

    id = Column(Integer, primary_key=True)
    name = Column(String(64), unique=True, nullable=False)
    base_url = Column(String(255), nullable=False)
    auth_type = Column(String(16), nullable=False, default="token")
    token_id = Column(String(128), nullable=True)
    encrypted_token_secret = Column(Text, nullable=True)
    username = Column(String(128), nullable=True)
    encrypted_password = Column(Text, nullable=True)
    verify_tls = Column(Boolean, nullable=False, default=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
    last_sync_at = Column(DateTime, nullable=True)
    last_sync_error = Column(Text, nullable=True)


class ProxmoxNodeStorage(Base):
    __tablename__ = "proxmox_node_storage"

    id = Column(Integer, primary_key=True)
    node = Column(String(64), nullable=False)
    storage = Column(String(64), nullable=False)
    datastore_id = Column(
        Integer().with_variant(mysql_dialect.INTEGER(unsigned=True), "mysql"),
        ForeignKey("datastores.id", onupdate="CASCADE", ondelete="SET NULL"),
        nullable=True,
    )
    storage_type = Column(String(32), nullable=True)
    total_gb = Column(Integer, nullable=True)
    used_gb = Column(Integer, nullable=True)
    avail_gb = Column(Integer, nullable=True)
    enabled = Column(Boolean, nullable=False, default=True)
    last_synced_at = Column(DateTime, nullable=True)

    __table_args__ = (UniqueConstraint("node", "storage", name="uq_proxmox_node_storage"),)


class ProxmoxSyncSchedule(Base):
    __tablename__ = "proxmox_sync_schedules"

    id = Column(Integer, primary_key=True)
    enabled = Column(Boolean, nullable=False, default=False)
    cron_expression = Column(String(128), nullable=False, default="0 * * * *")
    timezone = Column(String(64), nullable=False, default="UTC")
    updated_at = Column(DateTime, nullable=False)


class ProxmoxSyncRun(Base):
    __tablename__ = "proxmox_sync_runs"

    id = Column(Integer, primary_key=True)
    status = Column(String(32), nullable=False)
    trigger_source = Column(String(32), nullable=False)
    message = Column(Text, nullable=True)
    stats_json = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=False)
    completed_at = Column(DateTime, nullable=True)


class ProxmoxPendingHost(Base):
    """Raw VM data queued when lookup tables lack the required defaults at sync time.

    Admin-only — not exposed in the regular inventory UI.
    Once the user fills in the required FK fields they can promote the row to a
    real Host via the /proxmox/pending/{id}/promote endpoint.
    """

    __tablename__ = "proxmox_pending_hosts"

    id = Column(Integer, primary_key=True)
    sync_run_id = Column(
        Integer,
        ForeignKey("proxmox_sync_runs.id", onupdate="CASCADE", ondelete="SET NULL"),
        nullable=True,
    )
    credential_id = Column(
        Integer,
        ForeignKey("proxmox_credentials.id", ondelete="SET NULL"),
        nullable=True,
    )
    vmid = Column(Integer, nullable=True, unique=True)
    host_id_override = Column(Integer, nullable=True)
    name = Column(String(64), nullable=False)
    vm_type = Column(String(16), nullable=False, default="qemu")
    node = Column(String(64), nullable=True)
    cpu_cores = Column(SmallInteger, nullable=False, default=1)
    ram_mb = Column(Integer, nullable=False, default=512)
    disks_json = Column(Text, nullable=True)  # JSON list of {datastore, size_gb} objects
    nets_json = Column(Text, nullable=True)  # JSON list of {key, mac, bridge, vlan_tag, ip} objects

    # User-supplied fields needed before promoting to a real Host
    environment_id = Column(Integer, ForeignKey("environments.id", ondelete="SET NULL"), nullable=True)
    host_type_id = Column(Integer, ForeignKey("host_types.id", ondelete="SET NULL"), nullable=True)
    vlan_id = Column(Integer, ForeignKey("vlans.id", ondelete="SET NULL"), nullable=True)
    role_id = Column(Integer, ForeignKey("roles.id", ondelete="SET NULL"), nullable=True)
    ipv4 = Column(String(15), nullable=True)
    mac = Column(String(17), nullable=True)
    notes = Column(Text, nullable=True)

    vlan = relationship("Vlan", foreign_keys=[vlan_id], lazy="joined")

    @property
    def vlan_tag(self) -> int | None:
        return self.vlan.vlan_id if self.vlan else None

    status = Column(String(16), nullable=False, default="pending")  # pending | promoted | dismissed
    created_at = Column(DateTime, nullable=False)
    reviewed_at = Column(DateTime, nullable=True)


class UnifiSettings(Base):
    __tablename__ = "unifi_settings"

    id = Column(Integer, primary_key=True)
    enabled = Column(Boolean, nullable=False, default=False)
    base_url = Column(String(255), nullable=True)
    username = Column(String(128), nullable=True)
    encrypted_password = Column(Text, nullable=True)
    site = Column(String(128), nullable=True)
    verify_tls = Column(Boolean, nullable=False, default=True)
    last_sync_at = Column(DateTime, nullable=True)
    last_sync_error = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)


class UnifiSyncRun(Base):
    __tablename__ = "unifi_sync_runs"

    id = Column(Integer, primary_key=True)
    status = Column(String(32), nullable=False)
    trigger_source = Column(String(32), nullable=False)
    message = Column(Text, nullable=True)
    stats_json = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=False)
    completed_at = Column(DateTime, nullable=True)


class UnifiHostObservation(Base):
    __tablename__ = "unifi_host_observations"

    id = Column(Integer, primary_key=True)
    host_id = Column(
        Integer,
        ForeignKey("hosts.id", onupdate="CASCADE", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    mac = Column(String(17), nullable=True)
    observed_ipv4 = Column(String(15), nullable=True)
    network_name = Column(String(128), nullable=True)
    network_id = Column(String(128), nullable=True)
    vlan_tag = Column(Integer, nullable=True)
    unifi_client_name = Column(String(128), nullable=True)
    last_seen_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, nullable=False)


class UnifiPortForwardObservation(Base):
    __tablename__ = "unifi_port_forward_observations"

    id = Column(Integer, primary_key=True)
    host_id = Column(
        Integer,
        ForeignKey("hosts.id", onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False,
    )
    rule_name = Column(String(128), nullable=True)
    description = Column(String(255), nullable=True)
    protocol = Column(String(16), nullable=True)
    external_port = Column(String(64), nullable=True)
    internal_port = Column(String(64), nullable=True)
    source_restriction = Column(String(255), nullable=True)
    enabled = Column(Boolean, nullable=False, default=True)
    observed_at = Column(DateTime, nullable=False)


class HostRole(Base):
    __tablename__ = "host_roles"

    host_id = Column(
        Integer,
        ForeignKey("hosts.id", onupdate="CASCADE", ondelete="CASCADE"),
        primary_key=True,
    )
    role_id = Column(
        Integer,
        ForeignKey("roles.id", onupdate="CASCADE", ondelete="CASCADE"),
        primary_key=True,
    )
    priority = Column(SmallInteger, nullable=False, default=100)


class GlobalDefaultRole(Base):
    __tablename__ = "global_default_roles"

    role_id = Column(
        Integer,
        ForeignKey("roles.id", onupdate="CASCADE", ondelete="CASCADE"),
        primary_key=True,
    )
    priority = Column(SmallInteger, nullable=False, default=100)


class HostTypeRole(Base):
    __tablename__ = "host_type_roles"

    host_type_id = Column(
        Integer,
        ForeignKey("host_types.id", onupdate="CASCADE", ondelete="CASCADE"),
        primary_key=True,
    )
    role_id = Column(
        Integer,
        ForeignKey("roles.id", onupdate="CASCADE", ondelete="CASCADE"),
        primary_key=True,
    )
    priority = Column(SmallInteger, nullable=False, default=100)


class HostTypeField(Base):
    __tablename__ = "host_type_fields"

    id = Column(Integer, primary_key=True)
    host_type_id = Column(
        Integer,
        ForeignKey("host_types.id", onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(String(64), nullable=False)
    default_value = Column(Text, nullable=True)
    is_secret = Column(Boolean, nullable=False, default=False)

    __table_args__ = (UniqueConstraint("host_type_id", "name", name="uq_host_type_fields_type_name"),)


class HostHostTypeField(Base):
    __tablename__ = "host_host_type_fields"

    host_id = Column(
        Integer,
        ForeignKey("hosts.id", onupdate="CASCADE", ondelete="CASCADE"),
        primary_key=True,
    )
    field_id = Column(
        Integer,
        ForeignKey("host_type_fields.id", onupdate="CASCADE", ondelete="CASCADE"),
        primary_key=True,
    )
    value = Column(Text, nullable=True)
