from __future__ import annotations

import json
import logging
import ssl
import threading
from datetime import datetime, timezone
from typing import Any, Callable, Optional
from urllib import parse, request

logger = logging.getLogger(__name__)

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.inventory import (
    App,
    Datastore,
    Environment,
    Host,
    HostApp,
    HostResource,
    HostRole,
    HostStatus,
    HostStorage,
    HostType,
    ProxmoxCredential,
    ProxmoxNodeStorage,
    ProxmoxPendingHost,
    ProxmoxSyncRun,
    ProxmoxSyncSchedule,
    Role,
    Vlan,
)
from app.security import decrypt_secret

_scheduler_refresh_callback: Optional[Callable[[], None]] = None
_sync_lock = threading.Lock()


class ProxmoxClient:
    def __init__(self, credential: ProxmoxCredential):
        self.base_url = credential.base_url.rstrip("/")
        self.auth_type = credential.auth_type
        self.verify_tls = credential.verify_tls
        self.timeout = settings.PROXMOX_SYNC_TIMEOUT_SECONDS
        self.token_id = credential.token_id
        self.token_secret = (
            decrypt_secret(credential.encrypted_token_secret) if credential.encrypted_token_secret else None
        )
        self.username = credential.username
        self.password = decrypt_secret(credential.encrypted_password) if credential.encrypted_password else None
        self._ticket: Optional[str] = None

    def _ssl_context(self) -> ssl.SSLContext:
        if self.verify_tls:
            return ssl.create_default_context()
        logger.warning(
            "TLS verification disabled for Proxmox host %s — connections are vulnerable to MITM attacks",
            self.base_url,
        )
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        return context

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.auth_type == "token" and self.token_id and self.token_secret:
            headers["Authorization"] = f"PVEAPIToken={self.token_id}={self.token_secret}"
        if self.auth_type == "password" and self._ticket:
            headers["Cookie"] = f"PVEAuthCookie={self._ticket}"
        return headers

    def _request_json(
        self,
        path: str,
        *,
        method: str = "GET",
        data: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        body = None
        headers = self._headers()
        if data is not None:
            body = parse.urlencode(data).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"

        req = request.Request(f"{self.base_url}{path}", method=method, headers=headers, data=body)
        with request.urlopen(req, context=self._ssl_context(), timeout=self.timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            return payload.get("data", {})

    def _ensure_password_auth(self) -> None:
        if self.auth_type != "password" or self._ticket:
            return
        if not self.username or not self.password:
            raise RuntimeError("password auth requires username and password")
        payload = self._request_json(
            "/api2/json/access/ticket",
            method="POST",
            data={"username": self.username, "password": self.password},
        )
        self._ticket = payload.get("ticket")
        if not self._ticket:
            raise RuntimeError("failed to obtain Proxmox auth ticket")

    def list_resources(self) -> list[dict[str, Any]]:
        """Return all QEMU VMs and LXC containers from the cluster."""
        self._ensure_password_auth()
        data = self._request_json("/api2/json/cluster/resources?type=vm")
        if not isinstance(data, list):
            return []
        return [r for r in data if r.get("type") in ("qemu", "lxc")]

    def list_nodes(self) -> list[dict[str, Any]]:
        """Return all physical nodes in the cluster."""
        self._ensure_password_auth()
        data = self._request_json("/api2/json/nodes")
        if not isinstance(data, list):
            return []
        return data

    def list_node_storage(self, node: str) -> list[dict[str, Any]]:
        """Return all storage pools visible on *node*."""
        self._ensure_password_auth()
        data = self._request_json(f"/api2/json/nodes/{node}/storage")
        if not isinstance(data, list):
            return []
        return data

    def vm_config(self, node: str, vm_type: str, vmid: int) -> dict[str, Any]:
        self._ensure_password_auth()
        api_type = "qemu" if vm_type == "qemu" else "lxc"
        return self._request_json(f"/api2/json/nodes/{node}/{api_type}/{vmid}/config")

    def vm_agent_interfaces(self, node: str, vmid: int) -> list[dict[str, Any]]:
        """Query QEMU guest agent for network interfaces.  Raises on any failure."""
        self._ensure_password_auth()
        data = self._request_json(f"/api2/json/nodes/{node}/qemu/{vmid}/agent/network-get-interfaces")
        if isinstance(data, dict):
            return data.get("result", [])
        if isinstance(data, list):
            return data
        return []


def _extract_all_interfaces(config: dict[str, Any], vm_type: str) -> list[dict[str, Any]]:
    """Parse every netN key into a structured list.

    Each entry: {key, mac, bridge, vlan_tag, ip}
    Works for both LXC and QEMU configs.
    LXC  net0: name=eth0,bridge=vmbr0,hwaddr=AA:BB:...,tag=3,ip=10.0.0.1/24,...
    QEMU net0: virtio=AA:BB:...,bridge=vmbr0,firewall=1,tag=3
    """
    ifaces: list[dict[str, Any]] = []
    for key in sorted(config.keys()):
        if not key.startswith("net"):
            continue
        value = str(config.get(key) or "")
        if not value:
            continue
        tokens = [t.strip() for t in value.split(",")]
        mac: Optional[str] = None
        bridge: Optional[str] = None
        vlan_tag: Optional[int] = None
        ip: Optional[str] = None

        for i, token in enumerate(tokens):
            lower = token.lower()
            if lower.startswith("hwaddr="):
                mac = token.split("=", 1)[1].strip().upper() or None
            elif lower.startswith("bridge="):
                bridge = token.split("=", 1)[1].strip() or None
            elif lower.startswith("tag="):
                try:
                    t = int(token.split("=", 1)[1].strip())
                    if 1 <= t <= 4094:
                        vlan_tag = t
                except ValueError:
                    pass
            elif lower.startswith("ip="):
                raw = token.split("=", 1)[1].strip().split("/")[0]
                if raw and raw not in ("dhcp", "dhcp6", "auto", ""):
                    ip = raw
            elif i == 0 and "=" in token and mac is None:
                candidate = token.split("=", 1)[1].strip()
                if len(candidate) == 17 and candidate.count(":") == 5:
                    mac = candidate.upper()

        ifaces.append({"key": key, "mac": mac, "bridge": bridge, "vlan_tag": vlan_tag, "ip": ip})
    return ifaces


def _extract_ip_from_config(config: dict[str, Any], vm_type: str) -> Optional[str]:
    """For LXC containers: parse IP from netN config keys (e.g. 'net0=name=eth0,...,ip=10.0.0.1/24,...')."""
    if vm_type != "lxc":
        return None
    for key in sorted(config.keys()):
        if not key.startswith("net"):
            continue
        value = str(config.get(key) or "")
        for token in value.split(","):
            token = token.strip()
            if token.startswith("ip="):
                raw = token[3:]
                # strip CIDR prefix length and skip DHCP/link-local markers
                ip = raw.split("/")[0]
                if ip and ip not in ("dhcp", "dhcp6", "auto", ""):
                    return ip
    return None


def _extract_mac_from_config(config: dict[str, Any], vm_type: str) -> Optional[str]:
    """Parse MAC from VM/LXC config keys.

    LXC: 'net0=name=eth0,bridge=vmbr0,hwaddr=AA:BB:CC:DD:EE:FF,...'
    QEMU: 'net0=virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,...'
    """
    for key in sorted(config.keys()):
        if not key.startswith("net"):
            continue
        value = str(config.get(key) or "")
        for token in value.split(","):
            token = token.strip()
            if vm_type == "lxc" and token.lower().startswith("hwaddr="):
                mac = token.split("=", 1)[1].strip()
                if mac:
                    return mac.upper()
            # QEMU: first token is often 'model=AA:BB:CC:DD:EE:FF'
            if "=" in token:
                candidate = token.split("=", 1)[1].strip()
                if len(candidate) == 17 and candidate.count(":") == 5:
                    return candidate.upper()
    return None


def _extract_vlan_tag_from_config(config: dict[str, Any]) -> Optional[int]:
    """Return the VLAN tag (int) from the first netN interface that has one hardcoded.

    Works for both LXC and QEMU — Proxmox stores the tag as 'tag=NNN' in the netN value.
    LXC example:  net0=name=eth0,bridge=vmbr0,hwaddr=...,tag=100,ip=...
    QEMU example: net0=virtio=AA:...,bridge=vmbr0,tag=100
    """
    for key in sorted(config.keys()):
        if not key.startswith("net"):
            continue
        value = str(config.get(key) or "")
        logger.debug("VLAN scan — config key %r = %r", key, value)
        for token in value.split(","):
            token = token.strip()
            if token.lower().startswith("tag="):
                raw = token.split("=", 1)[1].strip()
                try:
                    tag = int(raw)
                    if 1 <= tag <= 4094:
                        logger.debug("VLAN tag found: %d", tag)
                        return tag
                except ValueError:
                    pass
    return None


def _get_or_create_vlan(db: Session, tag: int) -> int:
    """Return the `vlans.id` PK for the row whose `vlan_id` equals *tag*, creating it if absent."""
    row = db.execute(select(Vlan).where(Vlan.vlan_id == tag)).scalar_one_or_none()
    if row:
        return int(row.id)
    new_vlan = Vlan(vlan_id=tag)
    db.add(new_vlan)
    db.flush()
    logger.info("Auto-created VLAN %d (id=%d)", tag, new_vlan.id)
    return int(new_vlan.id)


def _try_detect_mac(
    client: "ProxmoxClient",
    node: str,
    vm_type: str,
    vmid: int,
    config: dict[str, Any],
) -> Optional[str]:
    """Best-effort MAC detection from config, then guest agent for QEMU. Never raises."""
    mac = _extract_mac_from_config(config, vm_type)
    if mac:
        return mac

    if vm_type == "qemu":
        try:
            ifaces = client.vm_agent_interfaces(node, vmid)
            for iface in ifaces:
                name = str(iface.get("name") or "")
                if name == "lo":
                    continue
                hw = iface.get("hardware-address") or ""
                if hw and hw != "00:00:00:00:00:00":
                    return hw.upper()
        except Exception as exc:  # noqa: BLE001
            logger.debug("Guest agent MAC query failed for vmid=%d: %s", vmid, exc)

    return None


def _try_detect_ip(
    client: "ProxmoxClient",
    node: str,
    vm_type: str,
    vmid: int,
    config: dict[str, Any],
) -> Optional[str]:
    """Best-effort IP detection.  Never raises — returns None on any failure."""
    # LXC: parse static IP from config
    ip = _extract_ip_from_config(config, vm_type)
    if ip:
        return ip

    # QEMU: try guest agent
    if vm_type == "qemu":
        try:
            ifaces = client.vm_agent_interfaces(node, vmid)
            for iface in ifaces:
                name = str(iface.get("name") or "")
                if name == "lo":
                    continue
                for addr in iface.get("ip-addresses", []):
                    if addr.get("ip-address-type") == "ipv4":
                        candidate = str(addr.get("ip-address") or "")
                        if candidate and not candidate.startswith("127."):
                            return candidate
        except Exception as exc:  # noqa: BLE001
            logger.debug("Guest agent IP query failed for vmid=%d: %s", vmid, exc)

    logger.warning("Could not detect IP for vmid=%d (node=%s, type=%s)", vmid, node, vm_type)
    return None


def _enrich_interfaces_with_agent_ips(
    ifaces: list[dict[str, Any]],
    client: "ProxmoxClient",
    node: str,
    vmid: int,
) -> None:
    """For QEMU VMs: fill in `ip` for any interface whose IP is still None by querying the guest agent.

    Mutates *ifaces* in place.  Never raises — failures are logged at DEBUG level.
    """
    try:
        agent_ifaces = client.vm_agent_interfaces(node, vmid)
    except Exception as exc:  # noqa: BLE001
        logger.debug("Guest agent interface query failed for vmid=%d: %s", vmid, exc)
        return

    mac_to_ip: dict[str, str] = {}
    for ai in agent_ifaces:
        name = str(ai.get("name") or "")
        if name == "lo":
            continue
        hw = str(ai.get("hardware-address") or "").upper()
        if not hw or hw == "00:00:00:00:00:00":
            continue
        for addr in ai.get("ip-addresses", []):
            if addr.get("ip-address-type") != "ipv4":
                continue
            candidate = str(addr.get("ip-address") or "")
            if not candidate or candidate.startswith("127.") or candidate.startswith("169.254."):
                continue
            if hw not in mac_to_ip:
                mac_to_ip[hw] = candidate
            break

    for iface in ifaces:
        if iface.get("ip") is not None:
            continue
        mac = str(iface.get("mac") or "").upper()
        if mac and mac in mac_to_ip:
            iface["ip"] = mac_to_ip[mac]
            logger.debug("Enriched %s on vmid=%d with agent IP %s", iface.get("key"), vmid, mac_to_ip[mac])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def set_scheduler_refresh(callback: Callable[[], None]) -> None:
    global _scheduler_refresh_callback
    _scheduler_refresh_callback = callback


def ensure_default_schedule(db: Session) -> ProxmoxSyncSchedule:
    schedule = db.get(ProxmoxSyncSchedule, 1)
    if schedule:
        return schedule
    schedule = ProxmoxSyncSchedule(
        id=1,
        enabled=False,
        cron_expression="0 * * * *",
        timezone="UTC",
        updated_at=_now(),
    )
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    return schedule


def apply_schedule(db: Session, scheduler: BackgroundScheduler) -> None:
    schedule = ensure_default_schedule(db)
    job_id = settings.PROXMOX_SCHEDULER_JOB_ID
    existing = scheduler.get_job(job_id)
    if existing:
        scheduler.remove_job(job_id)
    if not schedule.enabled:
        return

    trigger = CronTrigger.from_crontab(schedule.cron_expression, timezone=schedule.timezone)

    def scheduled_runner() -> None:
        from app.database import SessionLocal

        session = SessionLocal()
        try:
            run_proxmox_sync(session, trigger_source="scheduled")
        finally:
            session.close()

    scheduler.add_job(scheduled_runner, trigger=trigger, id=job_id, replace_existing=True)


def _first_id(db: Session, model: Any, field_name: str) -> Optional[int]:
    configured = getattr(settings, field_name, None)
    if configured:
        return int(configured)
    row = db.execute(select(model.id).order_by(model.id.asc()).limit(1)).first()
    if row:
        return int(row[0])
    return None


def _upsert_datastore(db: Session, datastore_name: str) -> int:
    existing = db.execute(select(Datastore).where(Datastore.name == datastore_name)).scalar_one_or_none()
    if existing:
        return int(existing.id)
    new_ds = Datastore(name=datastore_name, description="Synced from Proxmox")
    db.add(new_ds)
    db.flush()
    return int(new_ds.id)


def _sync_node_storage(
    db: Session,
    client: "ProxmoxClient",
    node_name: str,
) -> int:
    """Sync Proxmox storage pools for *node_name* into proxmox_node_storage.

    Returns the count of pools upserted.
    """
    try:
        pools = client.list_node_storage(node_name)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Storage pool fetch failed for node %r: %s", node_name, exc)
        return 0

    count = 0
    now = _now()
    for pool in pools:
        storage_name = str(pool.get("storage") or "")
        if not storage_name:
            continue

        storage_type = str(pool.get("type") or "")
        enabled = bool(pool.get("active", True))

        # Convert bytes → GiB (round up)
        def _bytes_to_gb(val: Any) -> Optional[int]:
            if val is None:
                return None
            try:
                return max(int(int(val) / (1024**3)), 0)
            except (TypeError, ValueError):
                return None

        total_gb = _bytes_to_gb(pool.get("total"))
        used_gb = _bytes_to_gb(pool.get("used"))
        avail_gb = _bytes_to_gb(pool.get("avail"))

        # Link to the Datastore row if one exists with the same name (don't auto-create here)
        ds_row = db.execute(select(Datastore).where(Datastore.name == storage_name)).scalar_one_or_none()
        datastore_id = int(ds_row.id) if ds_row else None

        row = db.execute(
            select(ProxmoxNodeStorage).where(
                ProxmoxNodeStorage.node == node_name,
                ProxmoxNodeStorage.storage == storage_name,
            )
        ).scalar_one_or_none()

        if row is None:
            row = ProxmoxNodeStorage(
                node=node_name,
                storage=storage_name,
                datastore_id=datastore_id,
                storage_type=storage_type or None,
                total_gb=total_gb,
                used_gb=used_gb,
                avail_gb=avail_gb,
                enabled=enabled,
                last_synced_at=now,
            )
            db.add(row)
        else:
            row.datastore_id = datastore_id
            row.storage_type = storage_type or None
            row.total_gb = total_gb
            row.used_gb = used_gb
            row.avail_gb = avail_gb
            row.enabled = enabled
            row.last_synced_at = now

        count += 1

    logger.debug("node %r: synced %d storage pool(s)", node_name, count)
    return count


def _vm_type_to_host_type_name(vm_type: str) -> str:
    """Map Proxmox vm_type ('qemu' or 'lxc') to a human-readable HostType name."""
    return "lxc" if vm_type == "lxc" else "vm"


def _get_or_create_host_type(db: Session, name: str) -> int:
    """Return the id of a HostType with the given name, creating it if absent."""
    existing = db.execute(select(HostType).where(HostType.name == name)).scalar_one_or_none()
    if existing:
        logger.debug("Found existing host type %r (id=%d)", name, existing.id)
        return int(existing.id)
    new_ht = HostType(name=name)
    db.add(new_ht)
    db.flush()
    logger.info("Auto-created host type %r (id=%d)", name, new_ht.id)
    return int(new_ht.id)


def _parse_size_to_gb(raw_size: str) -> int:
    value = raw_size.strip().upper()
    if value.endswith("G"):
        return max(int(float(value[:-1])), 1)
    if value.endswith("M"):
        return max(int(float(value[:-1]) / 1024), 1)
    if value.endswith("T"):
        return max(int(float(value[:-1]) * 1024), 1)
    try:
        return max(int(float(value)), 1)
    except ValueError:
        return 1


def _parse_disks(config: dict[str, Any]) -> list[tuple[str, int]]:
    disks: list[tuple[str, int]] = []
    disk_keys = sorted([k for k in config.keys() if k.startswith(("scsi", "ide", "sata", "virtio", "rootfs"))])
    for key in disk_keys:
        value = str(config.get(key) or "")
        if ":" not in value:
            continue
        datastore = value.split(":", 1)[0]
        size_gb = 1
        for token in value.split(","):
            if token.startswith("size="):
                size_gb = _parse_size_to_gb(token.split("=", 1)[1])
                break
        disks.append((datastore, size_gb))
    return disks


def _split_proxmox_tags(raw_tags: Any) -> list[str]:
    """Parse Proxmox `tags` payload into normalized tokens.

    Proxmox commonly returns a semicolon-separated string, but we accept list/tuple
    as a defensive fallback.
    """
    if raw_tags is None:
        return []

    if isinstance(raw_tags, (list, tuple, set)):
        values = [str(x).strip() for x in raw_tags]
    else:
        text = str(raw_tags).strip()
        if not text:
            return []
        # Proxmox uses ';' by default, but some callers may pass comma-separated tags.
        text = text.replace(",", ";")
        values = [part.strip() for part in text.split(";")]

    cleaned: list[str] = []
    for value in values:
        tag = value.strip().strip('"').strip("'")
        if tag:
            cleaned.append(tag)
    return cleaned


def _parse_vm_tags(raw_tags: Any) -> tuple[Optional[str], list[str]]:
    """Extract status and app tags from Proxmox VM tags.

    Supported forms:
    - status:<name> | status=<name> | status_<name>
    - app:<name>    | app=<name>    | app_<name>
    """
    status_name: Optional[str] = None
    app_names: list[str] = []

    for token in _split_proxmox_tags(raw_tags):
        lower = token.lower()
        value: Optional[str] = None
        if lower.startswith("status:") or lower.startswith("status="):
            value = token.split(":", 1)[1] if ":" in token else token.split("=", 1)[1]
            status_name = value.strip() or status_name
            continue
        if lower.startswith("status_"):
            value = token[len("status_") :]
            status_name = value.strip() or status_name
            continue

        if lower.startswith("app:") or lower.startswith("app="):
            value = token.split(":", 1)[1] if ":" in token else token.split("=", 1)[1]
            if value.strip():
                app_names.append(value.strip())
            continue
        if lower.startswith("app_"):
            value = token[len("app_") :]
            if value.strip():
                app_names.append(value.strip())

    # Keep deterministic order and uniqueness.
    app_names = sorted(set(app_names), key=str.lower)
    return status_name, app_names


def _get_or_create_host_status(db: Session, name: str) -> int:
    existing = db.execute(select(HostStatus).where(HostStatus.name == name)).scalar_one_or_none()
    if existing:
        return int(existing.id)
    new_status = HostStatus(name=name)
    db.add(new_status)
    db.flush()
    logger.info("Auto-created host status %r (id=%d)", name, new_status.id)
    return int(new_status.id)


def _get_or_create_app(db: Session, name: str) -> int:
    existing = db.execute(select(App).where(App.name == name)).scalar_one_or_none()
    if existing:
        return int(existing.id)
    new_app = App(name=name, description="Synced from Proxmox tags")
    db.add(new_app)
    db.flush()
    logger.info("Auto-created app %r (id=%d)", name, new_app.id)
    return int(new_app.id)


def _sync_host_apps_from_tags(db: Session, host_id: int, app_names: list[str]) -> None:
    target_app_ids = {_get_or_create_app(db, name) for name in app_names}
    existing_rows = db.execute(select(HostApp).where(HostApp.host_id == host_id)).scalars().all()
    existing_app_ids = {int(row.app_id) for row in existing_rows}

    for app_id in sorted(target_app_ids - existing_app_ids):
        db.add(HostApp(host_id=host_id, app_id=app_id))

    for row in existing_rows:
        if int(row.app_id) not in target_app_ids:
            db.delete(row)


def _active_credentials(db: Session) -> list[ProxmoxCredential]:
    credentials = (
        db.execute(
            select(ProxmoxCredential).where(ProxmoxCredential.is_active.is_(True)).order_by(ProxmoxCredential.id.asc())
        )
        .scalars()
        .all()
    )
    if not credentials:
        raise RuntimeError("No active Proxmox credential configured")
    return list(credentials)


def _upsert_node_pending(
    db: Session,
    run: ProxmoxSyncRun,
    credential: ProxmoxCredential,
    node_data: dict[str, Any],
) -> None:
    """Create or refresh a pending host entry for a physical Proxmox node.

    Nodes are keyed by (node name, credential_id) since they have no VMID.
    Already-promoted or dismissed entries are not re-queued.
    """
    node_name = str(node_data.get("node") or "")
    if not node_name:
        return

    existing = db.execute(
        select(ProxmoxPendingHost).where(
            ProxmoxPendingHost.vm_type == "node",
            ProxmoxPendingHost.node == node_name,
            ProxmoxPendingHost.credential_id == credential.id,
        )
    ).scalar_one_or_none()

    if existing is not None and existing.status in ("promoted", "dismissed"):
        return  # don't re-queue

    cpu_cores = int(node_data.get("maxcpu") or 1)
    ram_mb = int((node_data.get("maxmem") or 536870912) / (1024 * 1024))
    host_type_id = _get_or_create_host_type(db, "pve-node")

    if existing is None:
        pending = ProxmoxPendingHost(
            sync_run_id=run.id,
            credential_id=credential.id,
            vmid=None,
            name=node_name,
            vm_type="node",
            node=node_name,
            cpu_cores=cpu_cores,
            ram_mb=ram_mb,
            host_type_id=host_type_id,
            status="pending",
            created_at=_now(),
        )
        db.add(pending)
        logger.info(
            "Proxmox sync run_id=%d: node %r (credential_id=%d) queued as pending",
            run.id,
            node_name,
            credential.id,
        )
    else:
        # Refresh raw data from Proxmox
        existing.sync_run_id = run.id
        existing.cpu_cores = cpu_cores
        existing.ram_mb = ram_mb
        existing.host_type_id = host_type_id
        logger.debug(
            "Proxmox sync run_id=%d: node %r pending host refreshed",
            run.id,
            node_name,
        )


def run_proxmox_sync(db: Session, *, trigger_source: str = "manual") -> ProxmoxSyncRun:
    if not _sync_lock.acquire(blocking=False):
        raise RuntimeError("A sync is already running")

    run = ProxmoxSyncRun(
        status="running",
        trigger_source=trigger_source,
        message="Sync started",
        stats_json=None,
        started_at=_now(),
        completed_at=None,
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    logger.info("Proxmox sync started (run_id=%d, trigger=%s)", run.id, trigger_source)

    try:
        credentials = _active_credentials(db)
        default_environment_id = _first_id(db, Environment, "PROXMOX_DEFAULT_ENVIRONMENT_ID")
        default_vlan_id = _first_id(db, Vlan, "PROXMOX_DEFAULT_VLAN_ID")
        default_role_id = _first_id(db, Role, "PROXMOX_DEFAULT_ROLE_ID")
        # host_type is always resolvable — auto-created per vm_type — so excluded from has_defaults
        has_defaults = all(v is not None for v in (default_environment_id, default_vlan_id, default_role_id))

        stats = {
            "hosts_created": 0,
            "hosts_updated": 0,
            "resources_updated": 0,
            "storage_updated": 0,
            "hosts_pending": 0,
            "nodes_discovered": 0,
        }
        total_vms: list[dict[str, Any]] = []
        credential_clients: dict[int, ProxmoxClient] = {}  # credential.id -> ProxmoxClient

        for credential in credentials:
            try:
                client = ProxmoxClient(credential)
                # Discover physical nodes and queue as pending hosts; sync storage pools per node
                try:
                    nodes = client.list_nodes()
                    stats["nodes_discovered"] += len(nodes)
                    for node_data in nodes:
                        _upsert_node_pending(db, run, credential, node_data)
                        _sync_node_storage(db, client, str(node_data.get("node") or ""))
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "Proxmox sync run_id=%d: node discovery failed for credential %r: %s",
                        run.id,
                        credential.name,
                        exc,
                        exc_info=True,
                    )
                vms = client.list_resources()
                logger.info(
                    "Proxmox sync run_id=%d: credential %r discovered %d VM(s)",
                    run.id,
                    credential.name,
                    len(vms),
                )
                # Tag each vm dict with its credential id so the per-VM loop can get the right client
                for vm in vms:
                    vm["_credential_id"] = credential.id
                credential_clients[credential.id] = client
                total_vms.extend(vms)
                credential.last_sync_at = _now()
                credential.last_sync_error = None
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "Proxmox sync run_id=%d: credential %r failed: %s",
                    run.id,
                    credential.name,
                    exc,
                    exc_info=True,
                )
                credential.last_sync_at = _now()
                credential.last_sync_error = str(exc)

        vms = total_vms
        logger.info("Proxmox sync run_id=%d: total %d VM(s) across all credentials", run.id, len(vms))

        for vm in vms:
            vmid = int(vm.get("vmid"))
            vm_name = str(vm.get("name") or f"vm-{vmid}")
            vm_type = str(vm.get("type") or "qemu")
            vm_node = str(vm.get("node") or "")
            status_tag_name, app_tag_names = _parse_vm_tags(vm.get("tags"))
            tags_present = "tags" in vm
            # Resolve the client that fetched this VM so we can call vm_config
            client = credential_clients.get(int(vm.get("_credential_id", 0)))

            host = db.get(Host, vmid)
            if host is None and not has_defaults:
                # Can't create a Host without required FK defaults — queue as pending.
                # If already pending, just update the raw data from Proxmox.
                pending = db.execute(
                    select(ProxmoxPendingHost).where(ProxmoxPendingHost.vmid == vmid)
                ).scalar_one_or_none()
                cpu_cores = int(vm.get("maxcpu") or vm.get("cpus") or 1)
                ram_mb = int((vm.get("maxmem") or vm.get("mem") or 536870912) / (1024 * 1024))
                disks_json = None
                nets_json = None
                detected_ip: Optional[str] = None
                detected_mac: Optional[str] = None
                detected_vlan_fk: Optional[int] = None
                if vm_node and client:
                    try:
                        config = client.vm_config(vm_node, vm_type, vmid)
                        raw_disks = _parse_disks(config)
                        disks_json = json.dumps([{"datastore": ds, "size_gb": sg} for ds, sg in raw_disks])
                        ifaces = _extract_all_interfaces(config, vm_type)
                        if vm_type == "qemu":
                            _enrich_interfaces_with_agent_ips(ifaces, client, vm_node, vmid)
                        nets_json = json.dumps(ifaces)
                        logger.debug("vmid=%d: captured %d interface(s): %s", vmid, len(ifaces), nets_json[:200])
                        for iface in ifaces:
                            if detected_ip is None and iface.get("ip"):
                                detected_ip = iface["ip"]
                            if detected_mac is None and iface.get("mac"):
                                detected_mac = iface["mac"]
                            if detected_vlan_fk is None and iface.get("vlan_tag") is not None:
                                detected_vlan_fk = _get_or_create_vlan(db, iface["vlan_tag"])
                        if detected_ip is None:
                            detected_ip = _try_detect_ip(client, vm_node, vm_type, vmid, config)
                        if detected_mac is None:
                            detected_mac = _try_detect_mac(client, vm_node, vm_type, vmid, config)
                        if detected_vlan_fk is None:
                            vlan_tag = _extract_vlan_tag_from_config(config)
                            if vlan_tag is not None:
                                detected_vlan_fk = _get_or_create_vlan(db, vlan_tag)
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("Config fetch failed for vmid=%d: %s", vmid, exc, exc_info=True)
                host_type_name = _vm_type_to_host_type_name(vm_type)
                auto_host_type_id = _get_or_create_host_type(db, host_type_name)
                if pending is None or pending.status == "dismissed":
                    if pending is None:
                        pending = ProxmoxPendingHost(
                            sync_run_id=run.id,
                            credential_id=int(vm.get("_credential_id", 0)) or None,
                            vmid=vmid,
                            name=vm_name,
                            vm_type=vm_type,
                            node=vm_node or None,
                            cpu_cores=cpu_cores,
                            ram_mb=ram_mb,
                            disks_json=disks_json,
                            nets_json=nets_json,
                            ipv4=detected_ip,
                            mac=detected_mac,
                            vlan_id=detected_vlan_fk,
                            host_type_id=auto_host_type_id,
                            status="pending",
                            created_at=_now(),
                        )
                        db.add(pending)
                        logger.info(
                            "Proxmox sync run_id=%d: vmid=%d (%s) queued as pending (ip=%s, host_type=%s)",
                            run.id,
                            vmid,
                            vm_name,
                            detected_ip or "unknown",
                            host_type_name,
                        )
                    else:
                        # re-queue a previously dismissed VM that reappeared
                        pending.sync_run_id = run.id
                        pending.credential_id = int(vm.get("_credential_id", 0)) or None
                        pending.name = vm_name
                        pending.vm_type = vm_type
                        pending.node = vm_node or None
                        pending.cpu_cores = cpu_cores
                        pending.ram_mb = ram_mb
                        pending.disks_json = disks_json
                        pending.nets_json = nets_json
                        pending.host_type_id = auto_host_type_id
                        if detected_ip is not None:
                            pending.ipv4 = detected_ip
                        if detected_mac is not None:
                            pending.mac = detected_mac
                        if detected_vlan_fk is not None:
                            pending.vlan_id = detected_vlan_fk
                        pending.status = "pending"
                        pending.reviewed_at = None
                        logger.info(
                            "Proxmox sync run_id=%d: vmid=%d (%s) re-queued as pending",
                            run.id,
                            vmid,
                            vm_name,
                        )
                elif pending.status == "pending":
                    # Already pending — refresh raw data from Proxmox and fill IP/host_type if still unknown
                    pending.sync_run_id = run.id
                    pending.credential_id = int(vm.get("_credential_id", 0)) or None
                    pending.name = vm_name
                    pending.node = vm_node or None
                    pending.cpu_cores = cpu_cores
                    pending.ram_mb = ram_mb
                    if disks_json is not None:
                        pending.disks_json = disks_json
                    if nets_json is not None:
                        pending.nets_json = nets_json
                    if pending.host_type_id is None:
                        pending.host_type_id = auto_host_type_id
                    if detected_ip is not None:
                        pending.ipv4 = detected_ip
                    if detected_mac is not None:
                        pending.mac = detected_mac
                    if detected_vlan_fk is not None:
                        pending.vlan_id = detected_vlan_fk
                stats["hosts_pending"] += 1
                continue

            if host is None:
                # Try to detect IP, MAC and VLAN before creating the host
                detected_host_ip = "DHCP"
                detected_host_mac: Optional[str] = None
                detected_host_vlan_fk: Optional[int] = None
                if vm_node and client:
                    try:
                        config = client.vm_config(vm_node, vm_type, vmid)
                        ip = _try_detect_ip(client, vm_node, vm_type, vmid, config)
                        if ip:
                            detected_host_ip = ip
                        detected_host_mac = _try_detect_mac(client, vm_node, vm_type, vmid, config)
                        vlan_tag = _extract_vlan_tag_from_config(config)
                        if vlan_tag is not None:
                            detected_host_vlan_fk = _get_or_create_vlan(db, vlan_tag)
                    except Exception as exc:  # noqa: BLE001
                        logger.debug("Config fetch failed for vmid=%d during host create: %s", vmid, exc)
                host = Host(
                    id=vmid,
                    environment_id=default_environment_id,
                    host_type_id=_get_or_create_host_type(db, _vm_type_to_host_type_name(vm_type)),
                    name=vm_name,
                    vlan_id=detected_host_vlan_fk if detected_host_vlan_fk is not None else default_vlan_id,
                    ipv4=detected_host_ip,
                    mac=detected_host_mac,
                    proxmox_node=vm_node or None,
                    notes="Synced from Proxmox",
                    last_synced_at=_now(),
                )
                # Link VM to its physical Proxmox node host if one has been promoted
                if vm_node:
                    pve_node_type_id = _get_or_create_host_type(db, "pve-node")
                    node_host = db.execute(
                        select(Host).where(
                            Host.proxmox_node == vm_node,
                            Host.host_type_id == pve_node_type_id,
                        )
                    ).scalar_one_or_none()
                    if node_host is not None:
                        host.proxmox_host_id = node_host.id
                db.add(host)
                db.flush()
                if default_role_id is not None:
                    db.add(HostRole(host_id=vmid, role_id=default_role_id, priority=1))
                logger.info(
                    "Proxmox sync run_id=%d: vmid=%d (%s) created as host (ip=%s)",
                    run.id,
                    vmid,
                    vm_name,
                    detected_host_ip,
                )
                stats["hosts_created"] += 1
            else:
                host.name = vm_name
                host.proxmox_node = vm_node or None
                host.last_synced_at = _now()
                logger.debug("Proxmox sync run_id=%d: vmid=%d (%s) updated", run.id, vmid, vm_name)
                stats["hosts_updated"] += 1

            # Clean up any pending entry for this VMID now that a real host exists
            pending = db.execute(select(ProxmoxPendingHost).where(ProxmoxPendingHost.vmid == vmid)).scalar_one_or_none()
            if pending:
                db.delete(pending)
                stats.setdefault("pending_cleaned", 0)
                stats["pending_cleaned"] += 1

            if tags_present:
                if status_tag_name:
                    host.status_id = _get_or_create_host_status(db, status_tag_name)
                else:
                    host.status_id = None
                _sync_host_apps_from_tags(db, vmid, app_tag_names)

            resource = db.execute(select(HostResource).where(HostResource.host_id == vmid)).scalar_one_or_none()
            if resource is None:
                resource = HostResource(host_id=vmid, cpu_sockets=1, cpu_cores=1, ram_mb=512)
                db.add(resource)

            resource.cpu_cores = int(vm.get("maxcpu") or vm.get("cpus") or 1)
            resource.ram_mb = int((vm.get("maxmem") or vm.get("mem") or 536870912) / (1024 * 1024))
            resource.cpu_sockets = 1
            stats["resources_updated"] += 1

            disks: list[tuple[str, int]] = []
            if vm_node and client:
                try:
                    config = client.vm_config(vm_node, vm_type, vmid)
                    disks = _parse_disks(config)
                except Exception as exc:  # noqa: BLE001
                    logger.debug("Disk config fetch failed for vmid=%d: %s", vmid, exc)

            purposes = []
            for idx, (datastore_name, size_gb) in enumerate(disks):
                purpose = "os" if idx == 0 else f"hdd{idx:02d}"
                purposes.append(purpose)
                datastore_id = _upsert_datastore(db, datastore_name)
                storage = db.execute(
                    select(HostStorage).where(
                        HostStorage.host_id == vmid,
                        HostStorage.purpose == purpose,
                    )
                ).scalar_one_or_none()
                if storage is None:
                    storage = HostStorage(
                        host_id=vmid,
                        purpose=purpose,
                        datastore_id=datastore_id,
                        size_gb=size_gb,
                    )
                    db.add(storage)
                else:
                    storage.datastore_id = datastore_id
                    storage.size_gb = size_gb
                stats["storage_updated"] += 1

            if purposes:
                stale = (
                    db.execute(
                        select(HostStorage).where(
                            HostStorage.host_id == vmid,
                            HostStorage.purpose.not_in(purposes),
                        )
                    )
                    .scalars()
                    .all()
                )
                for row in stale:
                    db.delete(row)

        run.status = "success"
        discovered = len(vms)
        if discovered == 0:
            run.message = "Discovered 0 resources — verify token has VM.Audit on / with Propagate enabled"
        else:
            parts = [f"discovered={discovered}"]
            if stats["hosts_created"]:
                parts.append(f"created={stats['hosts_created']}")
            if stats["hosts_updated"]:
                parts.append(f"updated={stats['hosts_updated']}")
            if stats["hosts_pending"]:
                parts.append(f"pending={stats['hosts_pending']}")
            if stats["nodes_discovered"]:
                parts.append(f"nodes={stats['nodes_discovered']}")
            run.message = "Sync OK: " + ", ".join(parts)
        run.stats_json = json.dumps(stats)
        run.completed_at = _now()
        db.commit()
        db.refresh(run)
        logger.info("Proxmox sync run_id=%d completed: %s", run.id, run.message)
        return run
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.error("Proxmox sync run_id=%d failed: %s", run.id, exc, exc_info=True)
        run.status = "failed"
        run.message = str(exc)
        run.completed_at = _now()
        db.commit()
        db.refresh(run)
        raise
    finally:
        _sync_lock.release()


def list_recent_runs(db: Session, skip: int = 0, limit: int = 50) -> tuple[list[ProxmoxSyncRun], int]:
    total = db.execute(select(ProxmoxSyncRun)).scalars().all()
    items = (
        db.execute(select(ProxmoxSyncRun).order_by(ProxmoxSyncRun.started_at.desc()).offset(skip).limit(limit))
        .scalars()
        .all()
    )
    return items, len(total)


def notify_schedule_changed() -> None:
    if _scheduler_refresh_callback:
        _scheduler_refresh_callback()
