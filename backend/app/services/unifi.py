from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.inventory import (
    Host,
    UnifiHostObservation,
    UnifiPortForwardObservation,
    UnifiSettings,
    UnifiSyncRun,
    Vlan,
)
from app.services.field_encryption import decrypt_field_value, encrypt_field_value


class UnifiSettingsError(RuntimeError):
    pass


@dataclass
class UnifiConnection:
    enabled: bool
    base_url: Optional[str]
    username: Optional[str]
    password: Optional[str]
    site: Optional[str]
    verify_tls: bool


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _singleton_row(db: Session) -> UnifiSettings | None:
    return db.execute(select(UnifiSettings).order_by(UnifiSettings.id.asc())).scalars().first()


def get_or_create_unifi_settings(db: Session) -> UnifiSettings:
    row = _singleton_row(db)
    if row is not None:
        return row
    row = UnifiSettings(
        enabled=False,
        verify_tls=True,
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_unifi_connection(db: Session) -> UnifiConnection:
    row = get_or_create_unifi_settings(db)
    return UnifiConnection(
        enabled=bool(row.enabled),
        base_url=row.base_url,
        username=row.username,
        password=decrypt_field_value(row.encrypted_password),
        site=row.site,
        verify_tls=bool(row.verify_tls),
    )


def update_unifi_settings(db: Session, payload: dict[str, Any]) -> UnifiSettings:
    row = get_or_create_unifi_settings(db)
    data = dict(payload)
    password = data.pop("password", None)
    for key, value in data.items():
        setattr(row, key, value)
    if password:
        row.encrypted_password = encrypt_field_value(password)
    if row.enabled and (not row.base_url or not row.username or not row.encrypted_password):
        raise UnifiSettingsError("base_url, username, and password are required when UniFi is enabled")
    row.updated_at = _now()
    db.commit()
    db.refresh(row)
    return row


class UnifiClient:
    def __init__(self, connection: UnifiConnection):
        if not connection.base_url:
            raise UnifiSettingsError("UniFi base URL is not configured")
        if not connection.username or not connection.password:
            raise UnifiSettingsError("UniFi username and password are required")
        self.connection = connection
        self.base_url = connection.base_url.rstrip("/")
        self.timeout = httpx.Timeout(settings.UNIFI_TIMEOUT_SECONDS, connect=10.0)

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self.base_url,
            timeout=self.timeout,
            verify=self.connection.verify_tls,
            headers={"Accept": "application/json"},
        )

    def _request_json(self, client: httpx.Client, method: str, path: str, **kwargs: Any) -> Any:
        response = client.request(method, path, **kwargs)
        response.raise_for_status()
        if not response.content:
            return {}
        payload = response.json()
        if isinstance(payload, dict) and "data" in payload:
            return payload["data"]
        return payload

    def _login(self, client: httpx.Client) -> None:
        body = {"username": self.connection.username, "password": self.connection.password}
        errors: list[str] = []
        for path in ("/api/auth/login", "/api/login"):
            try:
                self._request_json(client, "POST", path, json=body)
                return
            except Exception as exc:  # noqa: BLE001
                errors.append(str(exc))
        raise UnifiSettingsError(errors[-1] if errors else "Failed to authenticate to UniFi")

    def _get_many(self, path_options: Iterable[str]) -> list[dict[str, Any]]:
        with self._client() as client:
            self._login(client)
            errors: list[str] = []
            for path in path_options:
                try:
                    payload = self._request_json(client, "GET", path)
                    if isinstance(payload, list):
                        return [item for item in payload if isinstance(item, dict)]
                    return []
                except Exception as exc:  # noqa: BLE001
                    errors.append(str(exc))
            raise UnifiSettingsError(errors[-1] if errors else "UniFi request failed")

    def list_sites(self) -> list[dict[str, Any]]:
        return self._get_many(("/proxy/network/api/self/sites", "/api/self/sites"))

    def list_networks(self, site: str) -> list[dict[str, Any]]:
        return self._get_many(
            (
                f"/proxy/network/api/s/{site}/rest/networkconf",
                f"/api/s/{site}/rest/networkconf",
            )
        )

    def list_clients(self, site: str) -> list[dict[str, Any]]:
        return self._get_many(
            (
                f"/proxy/network/api/s/{site}/stat/sta",
                f"/api/s/{site}/stat/sta",
            )
        )

    def list_port_forwards(self, site: str) -> list[dict[str, Any]]:
        return self._get_many(
            (
                f"/proxy/network/api/s/{site}/rest/portforward",
                f"/api/s/{site}/rest/portforward",
            )
        )


def build_unifi_client(
    db: Session,
    *,
    require_enabled: bool = True,
    require_site: bool = True,
) -> tuple[UnifiSettings, UnifiClient]:
    row = get_or_create_unifi_settings(db)
    connection = get_unifi_connection(db)
    if require_enabled and not row.enabled:
        raise UnifiSettingsError("UniFi integration is disabled")
    if require_site and not connection.site:
        raise UnifiSettingsError("UniFi site is not configured")
    return row, UnifiClient(connection)


def _clean_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_mac(value: Any) -> Optional[str]:
    text = _clean_text(value)
    if not text:
        return None
    text = text.replace("-", ":").upper()
    return text if len(text) == 17 and text.count(":") == 5 else None


def _int_or_none(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _timestamp_or_none(value: Any) -> Optional[datetime]:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def _string_port(value: Any) -> Optional[str]:
    text = _clean_text(value)
    return text


def _network_site_label(site: dict[str, Any]) -> str:
    return _clean_text(site.get("desc")) or _clean_text(site.get("name")) or "default"


def _site_name(site: dict[str, Any]) -> str:
    return _clean_text(site.get("name")) or "default"


def list_unifi_sites(db: Session) -> list[dict[str, str]]:
    _, client = build_unifi_client(db, require_enabled=False, require_site=False)
    return [
        {"id": _site_name(site), "name": _site_name(site), "description": _network_site_label(site)}
        for site in client.list_sites()
    ]


def _network_id(network: dict[str, Any]) -> Optional[str]:
    return _clean_text(network.get("_id")) or _clean_text(network.get("id"))


def _network_name(network: dict[str, Any]) -> Optional[str]:
    return _clean_text(network.get("name"))


def _network_subnet(network: dict[str, Any]) -> Optional[str]:
    return _clean_text(network.get("ip_subnet")) or _clean_text(network.get("subnet"))


def _network_purpose(network: dict[str, Any]) -> Optional[str]:
    return _clean_text(network.get("purpose"))


def _network_vlan_tag(network: dict[str, Any]) -> Optional[int]:
    return _int_or_none(network.get("vlan")) or _int_or_none(network.get("vlanid"))


def preview_unifi_vlans(db: Session) -> list[dict[str, Any]]:
    settings_row, client = build_unifi_client(db, require_enabled=False)
    networks = client.list_networks(settings_row.site or "default")
    items: list[dict[str, Any]] = []
    for network in networks:
        network_id = _network_id(network)
        vlan_tag = _network_vlan_tag(network)
        if not network_id or vlan_tag is None:
            continue
        items.append(
            {
                "network_id": network_id,
                "name": _network_name(network) or network_id,
                "vlan_tag": vlan_tag,
                "subnet": _network_subnet(network),
                "purpose": _network_purpose(network),
            }
        )
    items.sort(key=lambda item: (item["vlan_tag"], item["name"]))
    return items


def import_unifi_vlans(db: Session, network_ids: list[str]) -> dict[str, Any]:
    preview_items = preview_unifi_vlans(db)
    selected = [item for item in preview_items if item["network_id"] in set(network_ids)]
    result = {"requested": len(network_ids), "created": 0, "updated": 0, "skipped": 0, "errors": []}
    for item in selected:
        vlan = db.execute(select(Vlan).where(Vlan.vlan_id == item["vlan_tag"])).scalar_one_or_none()
        description = item["name"]
        if item["purpose"]:
            description = f"{item['name']} ({item['purpose']})"
        if vlan is None:
            db.add(
                Vlan(
                    vlan_id=item["vlan_tag"],
                    subnet=item["subnet"],
                    description=description,
                )
            )
            result["created"] += 1
            continue
        changed = False
        if item["subnet"] and vlan.subnet != item["subnet"]:
            vlan.subnet = item["subnet"]
            changed = True
        if description and vlan.description != description:
            vlan.description = description
            changed = True
        if changed:
            result["updated"] += 1
        else:
            result["skipped"] += 1
    missing_ids = sorted(set(network_ids) - {item["network_id"] for item in selected})
    for network_id in missing_ids:
        result["errors"].append({"network_id": network_id, "detail": "network not found in UniFi preview"})
    db.commit()
    return result


def _client_ip(client: dict[str, Any]) -> Optional[str]:
    return _clean_text(client.get("ip")) or _clean_text(client.get("fixed_ip"))


def _client_name(client: dict[str, Any]) -> Optional[str]:
    return _clean_text(client.get("name")) or _clean_text(client.get("hostname")) or _clean_text(client.get("oui"))


def _client_network_name(client: dict[str, Any]) -> Optional[str]:
    return (
        _clean_text(client.get("network"))
        or _clean_text(client.get("network_name"))
        or _clean_text(client.get("essid"))
    )


def _port_forward_target_ip(rule: dict[str, Any]) -> Optional[str]:
    for key in ("fwd", "dst", "forward_ip", "dst_addr", "fwd_ip", "internal_ip"):
        value = _clean_text(rule.get(key))
        if value:
            return value
    return None


def _port_forward_protocol(rule: dict[str, Any]) -> Optional[str]:
    return _clean_text(rule.get("proto")) or _clean_text(rule.get("protocol"))


def _port_forward_source(rule: dict[str, Any]) -> Optional[str]:
    return _clean_text(rule.get("src")) or _clean_text(rule.get("src_ip")) or _clean_text(rule.get("source"))


def _port_forward_external_port(rule: dict[str, Any]) -> Optional[str]:
    return (
        _string_port(rule.get("src_port")) or _string_port(rule.get("port")) or _string_port(rule.get("external_port"))
    )


def _port_forward_internal_port(rule: dict[str, Any]) -> Optional[str]:
    return (
        _string_port(rule.get("dst_port"))
        or _string_port(rule.get("fwd_port"))
        or _string_port(rule.get("internal_port"))
    )


def _port_forward_name(rule: dict[str, Any]) -> Optional[str]:
    return _clean_text(rule.get("name"))


def _port_forward_description(rule: dict[str, Any]) -> Optional[str]:
    return _clean_text(rule.get("description"))


def _port_forward_enabled(rule: dict[str, Any]) -> bool:
    return bool(rule.get("enabled", True))


def run_unifi_sync(db: Session, *, trigger_source: str = "manual") -> UnifiSyncRun:
    settings_row, client = build_unifi_client(db)
    run = UnifiSyncRun(
        status="running",
        trigger_source=trigger_source,
        started_at=_now(),
    )
    db.add(run)
    db.flush()

    try:
        site = settings_row.site or "default"
        networks = client.list_networks(site)
        clients = client.list_clients(site)
        port_forwards = client.list_port_forwards(site)
        network_by_name = {name: network for network in networks if (name := _network_name(network))}

        hosts = db.execute(select(Host).order_by(Host.id.asc())).scalars().all()
        hosts_by_mac = {}
        for host in hosts:
            normalized = _normalize_mac(host.mac)
            if normalized:
                hosts_by_mac[normalized] = host

        observations = db.execute(select(UnifiHostObservation)).scalars().all()
        observations_by_host_id = {item.host_id: item for item in observations}

        stats = {
            "matched_hosts": 0,
            "unmatched_clients": 0,
            "observations_updated": 0,
            "port_forwards_tracked": 0,
        }
        now = _now()

        for client_payload in clients:
            normalized_mac = _normalize_mac(client_payload.get("mac"))
            if not normalized_mac:
                stats["unmatched_clients"] += 1
                continue
            host = hosts_by_mac.get(normalized_mac)
            if host is None:
                stats["unmatched_clients"] += 1
                continue
            observation = observations_by_host_id.get(host.id)
            if observation is None:
                observation = UnifiHostObservation(host_id=host.id, updated_at=now)
                db.add(observation)
                observations_by_host_id[host.id] = observation
            network_name = _client_network_name(client_payload)
            network = network_by_name.get(network_name or "")
            observation.mac = normalized_mac
            observation.observed_ipv4 = _client_ip(client_payload)
            observation.network_name = network_name
            observation.network_id = _network_id(network) if network else None
            observation.vlan_tag = _int_or_none(client_payload.get("vlan")) or _network_vlan_tag(network or {})
            observation.unifi_client_name = _client_name(client_payload)
            observation.last_seen_at = _timestamp_or_none(client_payload.get("last_seen"))
            observation.updated_at = now
            stats["matched_hosts"] += 1
            stats["observations_updated"] += 1

        db.execute(delete(UnifiPortForwardObservation))
        db.flush()

        observed_ip_by_host = {
            item.host_id: item.observed_ipv4 for item in observations_by_host_id.values() if item.observed_ipv4
        }
        host_ip_map: dict[str, list[int]] = {}
        for host in hosts:
            if host.ipv4 == "DHCP":
                candidate_ip = observed_ip_by_host.get(host.id)
            else:
                candidate_ip = host.ipv4
            if candidate_ip and candidate_ip != "DHCP":
                host_ip_map.setdefault(candidate_ip, []).append(host.id)

        for rule in port_forwards:
            target_ip = _port_forward_target_ip(rule)
            if not target_ip:
                continue
            for host_id in host_ip_map.get(target_ip, []):
                db.add(
                    UnifiPortForwardObservation(
                        host_id=host_id,
                        rule_name=_port_forward_name(rule),
                        description=_port_forward_description(rule),
                        protocol=_port_forward_protocol(rule),
                        external_port=_port_forward_external_port(rule),
                        internal_port=_port_forward_internal_port(rule),
                        source_restriction=_port_forward_source(rule),
                        enabled=_port_forward_enabled(rule),
                        observed_at=now,
                    )
                )
                stats["port_forwards_tracked"] += 1

        run.status = "success"
        run.message = f"UniFi sync completed for site {site}"
        run.stats_json = json.dumps(stats, sort_keys=True)
        run.completed_at = now
        settings_row.last_sync_at = now
        settings_row.last_sync_error = None
        settings_row.updated_at = now
        db.commit()
        db.refresh(run)
        return run
    except Exception as exc:  # noqa: BLE001
        now = _now()
        run.status = "failed"
        run.message = str(exc)
        run.completed_at = now
        settings_row.last_sync_error = str(exc)
        settings_row.updated_at = now
        db.commit()
        db.refresh(run)
        raise
