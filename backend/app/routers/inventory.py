import csv
import io
import re
import secrets
from typing import Any, Dict, List, Optional

import yaml
from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, oauth2_scheme, require_admin, require_authenticated
from app.models.auth import AppUser, InventoryApiKeyPermission
from app.models.inventory import (
    AnsibleDefault,
    AppField,
    Host,
    HostAnsibleVar,
    HostAppField,
    HostHostTypeField,
    HostRoleField,
    HostStatusField,
    HostTypeField,
    RoleField,
    StatusField,
)
from app.schemas.inventory import (
    InventoryExplorerGroupRead,
    InventoryExplorerHostRead,
    InventoryExplorerLineageEntryRead,
    InventoryExplorerOverrideBatchWrite,
    InventoryExplorerOverrideTargetRead,
    InventoryExplorerRead,
    InventoryExplorerVarRead,
    InventoryRow,
    PageResponse,
)
from app.services.field_encryption import decrypt_field_value, mask_value, maybe_encrypt
from app.services.inventory_api_keys import find_inventory_api_key_by_secret, mark_inventory_api_key_used

router = APIRouter(prefix="/inventory", tags=["inventory"])

_QUERY = "SELECT * FROM v_inventory"
_COUNT_QUERY = "SELECT COUNT(*) FROM v_inventory"

_FIELD_VALUES_QUERY = """\
SELECT h.name AS hostname, af.name AS field_name, haf.value, af.default_value
FROM host_app_fields haf
JOIN app_fields af ON af.id = haf.field_id
JOIN hosts h ON h.id = haf.host_id
"""
# All fields for apps assigned to hosts — used to inject defaults
_DEFAULTS_QUERY = """\
SELECT h.name AS hostname, af.name AS field_name, af.default_value
FROM host_apps ha
JOIN hosts h ON h.id = ha.host_id
JOIN app_fields af ON af.app_id = ha.app_id
WHERE af.default_value IS NOT NULL
"""

# Global role defaults — cross join all hosts with global default roles
_GLOBAL_ROLE_DEFAULTS_QUERY = """\
SELECT h.name AS hostname, rf.name AS field_name, rf.default_value, gdr.priority
FROM hosts h
CROSS JOIN global_default_roles gdr
JOIN role_fields rf ON rf.role_id = gdr.role_id
WHERE rf.default_value IS NOT NULL
"""

# Host-type direct field defaults
_HOST_TYPE_FIELD_DEFAULTS_QUERY = """\
SELECT h.name AS hostname, htf.name AS field_name, htf.default_value
FROM hosts h
JOIN host_type_fields htf ON htf.host_type_id = h.host_type_id
WHERE htf.default_value IS NOT NULL
"""

_HOST_TYPE_FIELD_VALUES_QUERY = """\
SELECT h.name AS hostname, htf.name AS field_name, hhtf.value
FROM host_host_type_fields hhtf
JOIN host_type_fields htf ON htf.id = hhtf.field_id
JOIN hosts h ON h.id = hhtf.host_id
"""

# Host-type role defaults
_HOST_TYPE_ROLE_DEFAULTS_QUERY = """\
SELECT h.name AS hostname, rf.name AS field_name, rf.default_value, htr.priority
FROM hosts h
JOIN host_type_roles htr ON htr.host_type_id = h.host_type_id
JOIN role_fields rf ON rf.role_id = htr.role_id
WHERE rf.default_value IS NOT NULL
"""

# Per-host role defaults (from host_roles junction)
_HOST_ROLE_DEFAULTS_QUERY = """\
SELECT h.name AS hostname, rf.name AS field_name, rf.default_value, hr.priority
FROM hosts h
JOIN host_roles hr ON hr.host_id = h.id
JOIN role_fields rf ON rf.role_id = hr.role_id
WHERE rf.default_value IS NOT NULL
"""

# Per-host overrides of role field defaults
_ROLE_FIELD_VALUES_QUERY = """\
SELECT h.name AS hostname, rf.name AS field_name, hrf.value
FROM host_role_fields hrf
JOIN role_fields rf ON rf.id = hrf.field_id
JOIN hosts h ON h.id = hrf.host_id
"""

# Default values for the status assigned to each host
_STATUS_DEFAULTS_QUERY = """\
SELECT h.name AS hostname, sf.name AS field_name, sf.default_value
FROM hosts h
JOIN status_fields sf ON sf.status_id = h.status_id
WHERE h.status_id IS NOT NULL AND sf.default_value IS NOT NULL
"""
# Per-host overrides of status field defaults
_STATUS_FIELD_VALUES_QUERY = """\
SELECT h.name AS hostname, sf.name AS field_name, hsf.value
FROM host_status_fields hsf
JOIN status_fields sf ON sf.id = hsf.field_id
JOIN hosts h ON h.id = hsf.host_id
"""

# Global ansible defaults — applied to every host
_ANSIBLE_DEFAULTS_QUERY = """\
SELECT name AS field_name, value
FROM ansible_defaults
WHERE value IS NOT NULL
"""
# Per-host ansible var overrides
_HOST_ANSIBLE_VARS_QUERY = """\
SELECT h.name AS hostname, ad.name AS field_name, hav.value
FROM host_ansible_vars hav
JOIN ansible_defaults ad ON ad.id = hav.var_id
JOIN hosts h ON h.id = hav.host_id
"""


def _group_slug(prefix: str, raw: str) -> str:
    """Return a valid Ansible group name like 'env_production' from a raw value."""
    slug = re.sub(r"[^a-zA-Z0-9_]", "_", raw.strip()).lower()
    slug = re.sub(r"_+", "_", slug).strip("_")
    if slug and slug[0].isdigit():
        slug = "_" + slug
    return f"{prefix}_{slug or 'unknown'}"


def _coerce_inventory_value(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    if not stripped:
        return value

    looks_structured = (
        stripped[0] in "[{"
        or stripped.startswith("---")
        or stripped.startswith("- ")
        or ("\n" in stripped and (stripped.lstrip().startswith("- ") or ":" in stripped))
        or stripped.lower() in {"true", "false", "null", "~"}
        or re.fullmatch(r"-?\d+", stripped) is not None
        or re.fullmatch(r"-?\d+\.\d+", stripped) is not None
    )
    if not looks_structured:
        return value

    try:
        parsed = yaml.safe_load(stripped)
    except Exception:
        return value

    return value if isinstance(parsed, str) and parsed == value else parsed


def _build_ansible_inventory(
    rows: List[Dict[str, Any]],
    field_rows: List[Dict[str, Any]] | None = None,
    default_rows: List[Dict[str, Any]] | None = None,
    role_field_rows: List[Dict[str, Any]] | None = None,
    global_role_default_rows: List[Dict[str, Any]] | None = None,
    host_type_field_default_rows: List[Dict[str, Any]] | None = None,
    host_type_role_default_rows: List[Dict[str, Any]] | None = None,
    host_role_default_rows: List[Dict[str, Any]] | None = None,
    status_field_rows: List[Dict[str, Any]] | None = None,
    status_default_rows: List[Dict[str, Any]] | None = None,
    ansible_default_rows: List[Dict[str, Any]] | None = None,
    host_type_field_rows: List[Dict[str, Any]] | None = None,
    host_ansible_var_rows: List[Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    """Convert v_inventory rows to the Ansible dynamic inventory JSON format.

    Variable precedence (lowest → highest):
    1. Base hostvars (computed from v_inventory: ipv4, env, roles, etc.)
    2. Ansible global defaults (ansible_defaults table) — setdefault
    3. Status field defaults (status_fields table) — setdefault
    4. Global role defaults (global_default_roles) — setdefault
    5. Host-type direct field defaults (host_type_fields) — setdefault
    6. Host-type role defaults (host_type_roles) — direct assign
    7. Per-host role defaults (host_roles) — direct assign
    8. App field defaults (app_fields via host_apps) — setdefault
    9. Per-host host-type field overrides (host_host_type_fields) — direct assign
    10. Per-host status field overrides (host_status_fields) — direct assign
    11. Per-host role field overrides (host_role_fields) — direct assign
    12. Per-host app field overrides (host_app_fields) — direct assign
    13. Per-host ansible var overrides (host_ansible_vars) — direct assign (highest)
    """
    hostvars: Dict[str, Any] = {}
    groups: Dict[str, List[str]] = {}

    for row in rows:
        hostname = row.get("name")
        if not hostname:
            continue

        # Host variables
        hostvars[hostname] = {
            "ansible_host": row.get("ipv4") or hostname,
            "inventory_id": row.get("id"),
            "env": row.get("env"),
            "type": row.get("type"),
            "vlan_id": row.get("vlan_id"),
            "ipv4": row.get("ipv4"),
            "mac": row.get("mac"),
            "role": row.get("role"),
            "k3s_cluster": row.get("k3s_cluster"),
            "apps": row.get("apps"),
            "proxmox_host": row.get("proxmox_host"),
            "vm_cpu_socket": row.get("vm_cpu_socket"),
            "vm_cpu_core": row.get("vm_cpu_core"),
            "vm_ram": row.get("vm_ram"),
            "vm_storage_os_datastore": row.get("vm_storage_os_datastore"),
            "vm_storage_os_size": row.get("vm_storage_os_size"),
            "vm_storage_hdd01_datastore": row.get("vm_storage_hdd01_datastore"),
            "vm_storage_hdd01_size": row.get("vm_storage_hdd01_size"),
            "domain_internal": row.get("domain_internal"),
            "external_domain": row.get("external_domain"),
            "notes": row.get("notes"),
            "status": row.get("status"),
        }

        def _add_to_group(prefix: str, value: Optional[Any]) -> None:
            if value is None:
                return
            gname = _group_slug(prefix, str(value))
            groups.setdefault(gname, [])
            if hostname not in groups[gname]:
                groups[gname].append(hostname)

        _add_to_group("env", row.get("env"))
        roles_str = row.get("role")
        if roles_str:
            for role_name in roles_str.split(", "):
                _add_to_group("role", role_name.strip())
        _add_to_group("type", row.get("type"))

        vlan_id = row.get("vlan_id")
        if vlan_id is not None:
            _add_to_group("vlan", str(vlan_id))

        _add_to_group("k3s", row.get("k3s_cluster"))
        _add_to_group("status", row.get("status"))
        _add_to_group("ds_os", row.get("vm_storage_os_datastore"))
        _add_to_group("ds_hdd01", row.get("vm_storage_hdd01_datastore"))

        # apps is a comma-separated string from GROUP_CONCAT
        apps_str = row.get("apps")
        if apps_str:
            for app in apps_str.split(","):
                _add_to_group("app", app.strip())

    all_hosts = list(hostvars.keys())

    # 1. Ansible global defaults (setdefault — base hostvars take priority
    #    for computed fields; ansible_defaults add extra user-defined vars)
    if ansible_default_rows:
        for ar in ansible_default_rows:
            fname = ar.get("field_name")
            val = _coerce_inventory_value(decrypt_field_value(ar.get("value")))
            if fname:
                for hv in hostvars.values():
                    hv.setdefault(fname, val)

    # 2. Status field defaults — per host, based on the host's assigned status
    if status_default_rows:
        for sdr in status_default_rows:
            h = sdr.get("hostname")
            fname = sdr.get("field_name")
            dval = _coerce_inventory_value(decrypt_field_value(sdr.get("default_value")))
            if h and fname and h in hostvars:
                hostvars[h].setdefault(fname, dval)

    # 3. Global role defaults (lowest role-layer priority — setdefault)
    # Apply high-priority-number first so low-number wins
    if global_role_default_rows:
        for row in sorted(global_role_default_rows, key=lambda r: -(r.get("priority") or 100)):
            h = row.get("hostname")
            fname = row.get("field_name")
            dval = _coerce_inventory_value(decrypt_field_value(row.get("default_value")))
            if h and fname and h in hostvars:
                hostvars[h].setdefault(fname, dval)

    # 4a. Host-type direct field defaults (setdefault)
    if host_type_field_default_rows:
        for row in host_type_field_default_rows:
            h = row.get("hostname")
            fname = row.get("field_name")
            dval = _coerce_inventory_value(decrypt_field_value(row.get("default_value")))
            if h and fname and h in hostvars:
                hostvars[h].setdefault(fname, dval)

    # 4b. Host-type role defaults — direct assign (overrides global defaults)
    # Apply high-priority-number first so low-number wins last
    if host_type_role_default_rows:
        for row in sorted(host_type_role_default_rows, key=lambda r: -(r.get("priority") or 100)):
            h = row.get("hostname")
            fname = row.get("field_name")
            dval = _coerce_inventory_value(decrypt_field_value(row.get("default_value")))
            if h and fname and h in hostvars:
                hostvars[h][fname] = dval

    # 4c. Per-host role defaults — direct assign (highest role-layer precedence)
    # Apply high-priority-number first so low-number wins last
    if host_role_default_rows:
        for row in sorted(host_role_default_rows, key=lambda r: -(r.get("priority") or 100)):
            h = row.get("hostname")
            fname = row.get("field_name")
            dval = _coerce_inventory_value(decrypt_field_value(row.get("default_value")))
            if h and fname and h in hostvars:
                hostvars[h][fname] = dval

    # 5. App field defaults (lowest per-host default precedence)
    if default_rows:
        for dr in default_rows:
            h = dr.get("hostname")
            fname = dr.get("field_name")
            dval = _coerce_inventory_value(decrypt_field_value(dr.get("default_value")))
            if h and fname and h in hostvars:
                hostvars[h].setdefault(fname, dval)

    # 5. Per-host host-type field overrides
    if host_type_field_rows:
        for htfr in host_type_field_rows:
            h = htfr.get("hostname")
            fname = htfr.get("field_name")
            val = _coerce_inventory_value(decrypt_field_value(htfr.get("value")))
            if h and fname and h in hostvars:
                hostvars[h][fname] = val

    # 6. Per-host status field overrides
    if status_field_rows:
        for sfr in status_field_rows:
            h = sfr.get("hostname")
            fname = sfr.get("field_name")
            val = _coerce_inventory_value(decrypt_field_value(sfr.get("value")))
            if h and fname and h in hostvars:
                hostvars[h][fname] = val

    # 7. Per-host role field overrides
    if role_field_rows:
        for rfr in role_field_rows:
            h = rfr.get("hostname")
            fname = rfr.get("field_name")
            val = _coerce_inventory_value(decrypt_field_value(rfr.get("value")))
            if h and fname and h in hostvars:
                hostvars[h][fname] = val

    # 8. Per-host app field overrides
    if field_rows:
        for fr in field_rows:
            h = fr.get("hostname")
            fname = fr.get("field_name")
            val = _coerce_inventory_value(decrypt_field_value(fr.get("value")))
            if h and fname and h in hostvars:
                hostvars[h][fname] = val

    # 9. Per-host ansible var overrides (highest precedence)
    if host_ansible_var_rows:
        for har in host_ansible_var_rows:
            h = har.get("hostname")
            fname = har.get("field_name")
            val = _coerce_inventory_value(decrypt_field_value(har.get("value")))
            if h and fname and h in hostvars:
                hostvars[h][fname] = val

    inventory: Dict[str, Any] = {
        "all": {"hosts": all_hosts, "children": list(groups.keys())},
        "_meta": {"hostvars": hostvars},
    }
    for gname, hosts in groups.items():
        inventory[gname] = {"hosts": hosts, "children": []}

    return inventory


def _split_csv(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return [str(value)]


def _display_value(value: Optional[str], is_secret: bool) -> Optional[str]:
    if not is_secret:
        return value
    return mask_value(value)


def _inventory_row_or_404(db: Session, host_id: int) -> Dict[str, Any]:
    row = db.execute(text(f"{_QUERY} WHERE id = :host_id"), {"host_id": host_id}).first()  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    if not row:
        raise HTTPException(status_code=404, detail="Host not found")
    return dict(row._mapping)


def _host_or_404(db: Session, host_id: int) -> Host:
    host = db.get(Host, host_id)
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")
    return host


def _build_inventory_groups(row: Dict[str, Any]) -> List[InventoryExplorerGroupRead]:
    groups: List[InventoryExplorerGroupRead] = []

    def add(category: str, prefix: str, raw: Any, label: str) -> None:
        if raw is None or raw == "":
            return
        groups.append(
            InventoryExplorerGroupRead(
                name=_group_slug(prefix, str(raw)),
                label=label,
                category=category,  # type: ignore[arg-type]
            )
        )

    add("environment", "env", row.get("env"), f"Environment · {row.get('env')}")
    for role_name in _split_csv(row.get("role")):
        add("role", "role", role_name, f"Role · {role_name}")
    add("type", "type", row.get("type"), f"Host Type · {row.get('type')}")
    if row.get("vlan_id") is not None:
        add("vlan", "vlan", row.get("vlan_id"), f"VLAN · {row.get('vlan_id')}")
    add("status", "status", row.get("status"), f"Status · {row.get('status')}")
    add("k3s", "k3s", row.get("k3s_cluster"), f"K3s · {row.get('k3s_cluster')}")
    for app_name in _split_csv(row.get("apps")):
        add("app", "app", app_name, f"App · {app_name}")
    add(
        "datastore", "ds_os", row.get("vm_storage_os_datastore"), f"OS Datastore · {row.get('vm_storage_os_datastore')}"
    )
    add(
        "datastore",
        "ds_hdd01",
        row.get("vm_storage_hdd01_datastore"),
        f"HDD01 Datastore · {row.get('vm_storage_hdd01_datastore')}",
    )
    return groups


def _append_lineage(
    entries_by_key: Dict[str, List[dict[str, Any]]],
    current: Dict[str, Any],
    *,
    key: str,
    value: Optional[str],
    is_secret: bool,
    layer_key: str,
    layer_label: str,
    precedence: int,
    source_kind: str,
    source_label: str,
    mode: str,
    override_target: Optional[InventoryExplorerOverrideTargetRead] = None,
) -> None:
    entry = {
        "layer_key": layer_key,
        "layer_label": layer_label,
        "precedence": precedence,
        "source_kind": source_kind,
        "source_label": source_label,
        "value": _display_value(value, is_secret),
        "value_plain": value,
        "is_secret": is_secret,
        "applied": False,
        "editable": override_target is not None,
        "override_target": override_target,
    }
    entries_by_key.setdefault(key, []).append(entry)
    if mode == "assign":
        current[key] = entry
        entry["applied"] = True
    elif mode == "setdefault":
        if key not in current:
            current[key] = entry
            entry["applied"] = True
    else:
        raise ValueError(f"Unsupported lineage mode: {mode}")


def _fallback_ansible_override_target(key: str) -> InventoryExplorerOverrideTargetRead:
    return InventoryExplorerOverrideTargetRead(
        kind="ansible_default",
        target_id=None,
        target_name=key,
        label=f"Host ansible override · {key}",
    )


def _build_inventory_explorer_payload(db: Session, host_id: int) -> InventoryExplorerRead:
    host = _host_or_404(db, host_id)
    row = _inventory_row_or_404(db, host_id)
    entries_by_key: Dict[str, List[dict[str, Any]]] = {}
    current: Dict[str, dict[str, Any]] = {}

    base_fields = [
        ("ansible_host", row.get("ipv4") or row.get("name")),
        ("inventory_id", str(row.get("id")) if row.get("id") is not None else None),
        ("env", row.get("env")),
        ("type", row.get("type")),
        ("vlan_id", str(row.get("vlan_id")) if row.get("vlan_id") is not None else None),
        ("ipv4", row.get("ipv4")),
        ("mac", row.get("mac")),
        ("role", row.get("role")),
        ("k3s_cluster", row.get("k3s_cluster")),
        ("apps", row.get("apps")),
        ("proxmox_host", row.get("proxmox_host")),
        ("vm_cpu_socket", str(row.get("vm_cpu_socket")) if row.get("vm_cpu_socket") is not None else None),
        ("vm_cpu_core", str(row.get("vm_cpu_core")) if row.get("vm_cpu_core") is not None else None),
        ("vm_ram", row.get("vm_ram")),
        ("vm_storage_os_datastore", row.get("vm_storage_os_datastore")),
        ("vm_storage_os_size", row.get("vm_storage_os_size")),
        ("vm_storage_hdd01_datastore", row.get("vm_storage_hdd01_datastore")),
        ("vm_storage_hdd01_size", row.get("vm_storage_hdd01_size")),
        ("domain_internal", row.get("domain_internal")),
        ("external_domain", row.get("external_domain")),
        ("notes", row.get("notes")),
        ("status", row.get("status")),
    ]
    for key, value in base_fields:
        _append_lineage(
            entries_by_key,
            current,
            key=key,
            value=value,
            is_secret=False,
            layer_key="base",
            layer_label="Base Inventory",
            precedence=1,
            source_kind="base",
            source_label="v_inventory host row",
            mode="assign",
        )

    ansible_defaults = db.execute(
        text("SELECT id, name, value, is_secret FROM ansible_defaults WHERE value IS NOT NULL ORDER BY name ASC")
    ).all()
    for item in ansible_defaults:
        data = dict(item._mapping)
        _append_lineage(
            entries_by_key,
            current,
            key=data["name"],
            value=decrypt_field_value(data.get("value")),
            is_secret=bool(data.get("is_secret")),
            layer_key="ansible_defaults",
            layer_label="Global Ansible Defaults",
            precedence=2,
            source_kind="ansible_default",
            source_label=f"Ansible default · {data['name']}",
            mode="setdefault",
            override_target=InventoryExplorerOverrideTargetRead(
                kind="ansible_default",
                target_id=int(data["id"]),
                target_name=data["name"],
                label=f"Host override for {data['name']}",
            ),
        )

    if host.status_id is not None:
        status_defaults = db.execute(
            text(
                """\
SELECT sf.id, sf.name, sf.default_value, sf.is_secret, hs.name AS status_name
FROM status_fields sf
JOIN host_statuses hs ON hs.id = sf.status_id
WHERE sf.status_id = :status_id AND sf.default_value IS NOT NULL
ORDER BY sf.name ASC
"""
            ),
            {"status_id": host.status_id},
        ).all()
        for item in status_defaults:
            data = dict(item._mapping)
            _append_lineage(
                entries_by_key,
                current,
                key=data["name"],
                value=decrypt_field_value(data.get("default_value")),
                is_secret=bool(data.get("is_secret")),
                layer_key="status_defaults",
                layer_label="Status Defaults",
                precedence=3,
                source_kind="status_default",
                source_label=f"Status default · {data['status_name']}",
                mode="setdefault",
                override_target=InventoryExplorerOverrideTargetRead(
                    kind="status_field",
                    target_id=int(data["id"]),
                    label=f"Host status override · {data['status_name']}",
                ),
            )

    global_role_defaults = db.execute(
        text(
            """\
SELECT rf.id, rf.name, rf.default_value, rf.is_secret, r.name AS role_name, gdr.priority
FROM global_default_roles gdr
JOIN roles r ON r.id = gdr.role_id
JOIN role_fields rf ON rf.role_id = gdr.role_id
WHERE rf.default_value IS NOT NULL
ORDER BY gdr.priority DESC, rf.name ASC
"""
        )
    ).all()
    for item in global_role_defaults:
        data = dict(item._mapping)
        _append_lineage(
            entries_by_key,
            current,
            key=data["name"],
            value=decrypt_field_value(data.get("default_value")),
            is_secret=bool(data.get("is_secret")),
            layer_key="global_role_defaults",
            layer_label="Global Role Defaults",
            precedence=4,
            source_kind="global_role_default",
            source_label=f"Global role default · {data['role_name']} (priority {data['priority']})",
            mode="setdefault",
            override_target=InventoryExplorerOverrideTargetRead(
                kind="role_field",
                target_id=int(data["id"]),
                label=f"Host role override · {data['role_name']}",
            ),
        )

    host_type_defaults = db.execute(
        text(
            """\
SELECT htf.id, htf.name, htf.default_value, htf.is_secret, ht.name AS host_type_name
FROM host_type_fields htf
JOIN host_types ht ON ht.id = htf.host_type_id
WHERE htf.host_type_id = :host_type_id AND htf.default_value IS NOT NULL
ORDER BY htf.name ASC
"""
        ),
        {"host_type_id": host.host_type_id},
    ).all()
    for item in host_type_defaults:
        data = dict(item._mapping)
        _append_lineage(
            entries_by_key,
            current,
            key=data["name"],
            value=decrypt_field_value(data.get("default_value")),
            is_secret=bool(data.get("is_secret")),
            layer_key="host_type_defaults",
            layer_label="Host Type Defaults",
            precedence=5,
            source_kind="host_type_default",
            source_label=f"Host type default · {data['host_type_name']}",
            mode="setdefault",
            override_target=InventoryExplorerOverrideTargetRead(
                kind="host_type_field",
                target_id=int(data["id"]),
                label=f"Host-type override · {data['host_type_name']}",
            ),
        )

    host_type_role_defaults = db.execute(
        text(
            """\
SELECT rf.id, rf.name, rf.default_value, rf.is_secret, r.name AS role_name, htr.priority
FROM host_type_roles htr
JOIN roles r ON r.id = htr.role_id
JOIN role_fields rf ON rf.role_id = htr.role_id
WHERE htr.host_type_id = :host_type_id AND rf.default_value IS NOT NULL
ORDER BY htr.priority DESC, rf.name ASC
"""
        ),
        {"host_type_id": host.host_type_id},
    ).all()
    for item in host_type_role_defaults:
        data = dict(item._mapping)
        _append_lineage(
            entries_by_key,
            current,
            key=data["name"],
            value=decrypt_field_value(data.get("default_value")),
            is_secret=bool(data.get("is_secret")),
            layer_key="host_type_role_defaults",
            layer_label="Host Type Role Defaults",
            precedence=6,
            source_kind="host_type_role_default",
            source_label=f"Host type role default · {data['role_name']} (priority {data['priority']})",
            mode="assign",
            override_target=InventoryExplorerOverrideTargetRead(
                kind="role_field",
                target_id=int(data["id"]),
                label=f"Host role override · {data['role_name']}",
            ),
        )

    host_role_defaults = db.execute(
        text(
            """\
SELECT rf.id, rf.name, rf.default_value, rf.is_secret, r.name AS role_name, hr.priority
FROM host_roles hr
JOIN roles r ON r.id = hr.role_id
JOIN role_fields rf ON rf.role_id = hr.role_id
WHERE hr.host_id = :host_id AND rf.default_value IS NOT NULL
ORDER BY hr.priority DESC, rf.name ASC
"""
        ),
        {"host_id": host_id},
    ).all()
    for item in host_role_defaults:
        data = dict(item._mapping)
        _append_lineage(
            entries_by_key,
            current,
            key=data["name"],
            value=decrypt_field_value(data.get("default_value")),
            is_secret=bool(data.get("is_secret")),
            layer_key="host_role_defaults",
            layer_label="Host Role Defaults",
            precedence=7,
            source_kind="host_role_default",
            source_label=f"Host role default · {data['role_name']} (priority {data['priority']})",
            mode="assign",
            override_target=InventoryExplorerOverrideTargetRead(
                kind="role_field",
                target_id=int(data["id"]),
                label=f"Host role override · {data['role_name']}",
            ),
        )

    app_defaults = db.execute(
        text(
            """\
SELECT af.id, af.app_id, af.name, af.default_value, af.is_secret, a.name AS app_name
FROM host_apps ha
JOIN apps a ON a.id = ha.app_id
JOIN app_fields af ON af.app_id = ha.app_id
WHERE ha.host_id = :host_id AND af.default_value IS NOT NULL
ORDER BY a.name ASC, af.name ASC
"""
        ),
        {"host_id": host_id},
    ).all()
    for item in app_defaults:
        data = dict(item._mapping)
        _append_lineage(
            entries_by_key,
            current,
            key=data["name"],
            value=decrypt_field_value(data.get("default_value")),
            is_secret=bool(data.get("is_secret")),
            layer_key="app_defaults",
            layer_label="App Defaults",
            precedence=8,
            source_kind="app_default",
            source_label=f"App default · {data['app_name']}",
            mode="setdefault",
            override_target=InventoryExplorerOverrideTargetRead(
                kind="app_field",
                target_id=int(data["id"]),
                app_id=int(data["app_id"]),
                label=f"Host app override · {data['app_name']}",
            ),
        )

    host_type_overrides = db.execute(
        text(
            """\
SELECT htf.id, htf.name, hhtf.value, htf.is_secret, ht.name AS host_type_name
FROM host_host_type_fields hhtf
JOIN host_type_fields htf ON htf.id = hhtf.field_id
JOIN host_types ht ON ht.id = htf.host_type_id
WHERE hhtf.host_id = :host_id
ORDER BY htf.name ASC
"""
        ),
        {"host_id": host_id},
    ).all()
    for item in host_type_overrides:
        data = dict(item._mapping)
        _append_lineage(
            entries_by_key,
            current,
            key=data["name"],
            value=decrypt_field_value(data.get("value")),
            is_secret=bool(data.get("is_secret")),
            layer_key="host_type_overrides",
            layer_label="Host Type Overrides",
            precedence=9,
            source_kind="host_type_override",
            source_label=f"Host-type override · {data['host_type_name']}",
            mode="assign",
            override_target=InventoryExplorerOverrideTargetRead(
                kind="host_type_field",
                target_id=int(data["id"]),
                label=f"Host-type override · {data['host_type_name']}",
            ),
        )

    status_overrides = db.execute(
        text(
            """\
SELECT sf.id, sf.name, hsf.value, sf.is_secret, hs.name AS status_name
FROM host_status_fields hsf
JOIN status_fields sf ON sf.id = hsf.field_id
JOIN host_statuses hs ON hs.id = sf.status_id
WHERE hsf.host_id = :host_id
ORDER BY sf.name ASC
"""
        ),
        {"host_id": host_id},
    ).all()
    for item in status_overrides:
        data = dict(item._mapping)
        _append_lineage(
            entries_by_key,
            current,
            key=data["name"],
            value=decrypt_field_value(data.get("value")),
            is_secret=bool(data.get("is_secret")),
            layer_key="status_overrides",
            layer_label="Status Overrides",
            precedence=10,
            source_kind="status_override",
            source_label=f"Host status override · {data['status_name']}",
            mode="assign",
            override_target=InventoryExplorerOverrideTargetRead(
                kind="status_field",
                target_id=int(data["id"]),
                label=f"Host status override · {data['status_name']}",
            ),
        )

    role_overrides = db.execute(
        text(
            """\
SELECT rf.id, rf.name, hrf.value, rf.is_secret, r.name AS role_name
FROM host_role_fields hrf
JOIN role_fields rf ON rf.id = hrf.field_id
JOIN roles r ON r.id = rf.role_id
WHERE hrf.host_id = :host_id
ORDER BY r.name ASC, rf.name ASC
"""
        ),
        {"host_id": host_id},
    ).all()
    for item in role_overrides:
        data = dict(item._mapping)
        _append_lineage(
            entries_by_key,
            current,
            key=data["name"],
            value=decrypt_field_value(data.get("value")),
            is_secret=bool(data.get("is_secret")),
            layer_key="role_overrides",
            layer_label="Role Overrides",
            precedence=11,
            source_kind="role_override",
            source_label=f"Host role override · {data['role_name']}",
            mode="assign",
            override_target=InventoryExplorerOverrideTargetRead(
                kind="role_field",
                target_id=int(data["id"]),
                label=f"Host role override · {data['role_name']}",
            ),
        )

    app_overrides = db.execute(
        text(
            """\
SELECT af.id, af.app_id, af.name, haf.value, af.is_secret, a.name AS app_name
FROM host_app_fields haf
JOIN app_fields af ON af.id = haf.field_id
JOIN apps a ON a.id = af.app_id
WHERE haf.host_id = :host_id
ORDER BY a.name ASC, af.name ASC
"""
        ),
        {"host_id": host_id},
    ).all()
    for item in app_overrides:
        data = dict(item._mapping)
        _append_lineage(
            entries_by_key,
            current,
            key=data["name"],
            value=decrypt_field_value(data.get("value")),
            is_secret=bool(data.get("is_secret")),
            layer_key="app_overrides",
            layer_label="App Overrides",
            precedence=12,
            source_kind="app_override",
            source_label=f"Host app override · {data['app_name']}",
            mode="assign",
            override_target=InventoryExplorerOverrideTargetRead(
                kind="app_field",
                target_id=int(data["id"]),
                app_id=int(data["app_id"]),
                label=f"Host app override · {data['app_name']}",
            ),
        )

    ansible_overrides = db.execute(
        text(
            """\
SELECT ad.id, ad.name, hav.value, ad.is_secret
FROM host_ansible_vars hav
JOIN ansible_defaults ad ON ad.id = hav.var_id
WHERE hav.host_id = :host_id
ORDER BY ad.name ASC
"""
        ),
        {"host_id": host_id},
    ).all()
    for item in ansible_overrides:
        data = dict(item._mapping)
        _append_lineage(
            entries_by_key,
            current,
            key=data["name"],
            value=decrypt_field_value(data.get("value")),
            is_secret=bool(data.get("is_secret")),
            layer_key="ansible_overrides",
            layer_label="Ansible Overrides",
            precedence=13,
            source_kind="ansible_override",
            source_label=f"Host ansible override · {data['name']}",
            mode="assign",
            override_target=InventoryExplorerOverrideTargetRead(
                kind="ansible_default",
                target_id=int(data["id"]),
                target_name=data["name"],
                label=f"Host ansible override · {data['name']}",
            ),
        )

    vars_payload: List[InventoryExplorerVarRead] = []
    for key in sorted(entries_by_key.keys()):
        lineage_entries = entries_by_key[key]
        effective = current.get(key)
        unique_targets: Dict[tuple[str, int, Optional[int]], InventoryExplorerOverrideTargetRead] = {}
        for entry in lineage_entries:
            target = entry.get("override_target")
            if target is not None:
                unique_targets[(target.kind, target.target_id or 0, target.app_id)] = target

        effective_target = effective.get("override_target") if effective else None

        if effective_target is not None:
            editable = True
            edit_reason = None
            override_target = effective_target
        elif len(unique_targets) == 1:
            editable = True
            edit_reason = None
            override_target = next(iter(unique_targets.values()))
        else:
            editable = True
            override_target = _fallback_ansible_override_target(key)
            if len(unique_targets) == 0:
                edit_reason = "Saving here creates a host-only Ansible override for this rendered variable."
            else:
                edit_reason = (
                    "This variable inherits from multiple layers. Saving here creates a host-only "
                    "Ansible override because there is no single current field override target."
                )

        has_host_override = any(
            entry["source_kind"]
            in {"host_type_override", "status_override", "role_override", "app_override", "ansible_override"}
            for entry in lineage_entries
        )
        vars_payload.append(
            InventoryExplorerVarRead(
                key=key,
                value=effective.get("value") if effective else None,
                is_secret=bool(effective.get("is_secret")) if effective else False,
                source_label=effective.get("source_label") if effective else None,
                source_layer=effective.get("layer_label") if effective else None,
                editable=editable,
                edit_reason=edit_reason,
                override_target=override_target,
                has_host_override=has_host_override,
                lineage=[
                    InventoryExplorerLineageEntryRead(
                        layer_key=entry["layer_key"],
                        layer_label=entry["layer_label"],
                        precedence=entry["precedence"],
                        source_kind=entry["source_kind"],
                        source_label=entry["source_label"],
                        value=entry["value"],
                        is_secret=bool(entry["is_secret"]),
                        applied=bool(entry["applied"]),
                        editable=bool(entry["editable"]),
                        override_target=entry.get("override_target"),
                    )
                    for entry in lineage_entries
                ],
            )
        )

    return InventoryExplorerRead(
        host=InventoryExplorerHostRead(
            id=host.id,
            name=host.name,
            ipv4=host.ipv4,
            environment=row.get("env"),
            host_type=row.get("type"),
            status=row.get("status"),
            roles=_split_csv(row.get("role")),
            apps=_split_csv(row.get("apps")),
        ),
        groups=_build_inventory_groups(row),
        vars=vars_payload,
    )


def _apply_inventory_override(db: Session, host: Host, update: dict[str, Any]) -> None:
    kind = update["kind"]
    target_id = update["target_id"]
    target_name = update.get("target_name")
    app_id = update.get("app_id")
    remove = bool(update.get("remove"))
    value = update.get("value")

    if kind == "ansible_default":
        field: Optional[AnsibleDefault] = None
        if target_id is not None:
            field = db.get(AnsibleDefault, target_id)
        elif target_name:
            field = db.query(AnsibleDefault).filter(AnsibleDefault.name == target_name).one_or_none()

        if field is None:
            fallback_name = (target_name or "").strip()
            if not fallback_name:
                raise HTTPException(status_code=400, detail="Ansible override target is missing a variable name")
            field = AnsibleDefault(name=fallback_name, value=None, is_secret=False)
            db.add(field)
            db.flush()

        existing = db.get(HostAnsibleVar, (host.id, field.id))
        if remove:
            if existing:
                db.delete(existing)
            return
        stored_value = maybe_encrypt(value, field.is_secret)
        if existing:
            existing.value = stored_value
        else:
            db.add(HostAnsibleVar(host_id=host.id, var_id=field.id, value=stored_value))
        return

    if kind == "status_field":
        field = db.get(StatusField, target_id)
        if not field or field.status_id != host.status_id:
            raise HTTPException(status_code=400, detail=f"Status field {target_id} does not belong to this host")
        existing = db.get(HostStatusField, (host.id, target_id))
        if remove:
            if existing:
                db.delete(existing)
            return
        stored_value = maybe_encrypt(value, field.is_secret)
        if existing:
            existing.value = stored_value
        else:
            db.add(HostStatusField(host_id=host.id, field_id=target_id, value=stored_value))
        return

    if kind == "role_field":
        field = db.get(RoleField, target_id)
        host_role_ids = {
            int(role_id)
            for (role_id,) in db.execute(
                text("SELECT role_id FROM host_roles WHERE host_id = :host_id"), {"host_id": host.id}
            ).all()
        }
        if not field or field.role_id not in host_role_ids:
            raise HTTPException(status_code=400, detail=f"Role field {target_id} does not belong to this host")
        existing = db.get(HostRoleField, (host.id, target_id))
        if remove:
            if existing:
                db.delete(existing)
            return
        stored_value = maybe_encrypt(value, field.is_secret)
        if existing:
            existing.value = stored_value
        else:
            db.add(HostRoleField(host_id=host.id, field_id=target_id, value=stored_value))
        return

    if kind == "app_field":
        field = db.get(AppField, target_id)
        host_app_ids = {
            int(host_app_id)
            for (host_app_id,) in db.execute(
                text("SELECT app_id FROM host_apps WHERE host_id = :host_id"), {"host_id": host.id}
            ).all()
        }
        if not field or field.app_id not in host_app_ids or app_id != field.app_id:
            raise HTTPException(status_code=400, detail=f"App field {target_id} does not belong to this host")
        existing = db.get(HostAppField, (host.id, field.app_id, target_id))
        if remove:
            if existing:
                db.delete(existing)
            return
        stored_value = maybe_encrypt(value, field.is_secret)
        if existing:
            existing.value = stored_value
        else:
            db.add(HostAppField(host_id=host.id, app_id=field.app_id, field_id=target_id, value=stored_value))
        return

    if kind == "host_type_field":
        field = db.get(HostTypeField, target_id)
        if not field or field.host_type_id != host.host_type_id:
            raise HTTPException(status_code=400, detail=f"Host type field {target_id} does not belong to this host")
        existing = db.get(HostHostTypeField, (host.id, target_id))
        if remove:
            if existing:
                db.delete(existing)
            return
        stored_value = maybe_encrypt(value, field.is_secret)
        if existing:
            existing.value = stored_value
        else:
            db.add(HostHostTypeField(host_id=host.id, field_id=target_id, value=stored_value))
        return

    raise HTTPException(status_code=400, detail=f"Unsupported override kind: {kind}")


@router.get("/", response_model=PageResponse[InventoryRow])
def list_inventory(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    total = db.execute(text(_COUNT_QUERY)).scalar() or 0
    rows = db.execute(text(f"{_QUERY} LIMIT :limit OFFSET :skip"), {"limit": limit, "skip": skip})  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    items = [dict(row._mapping) for row in rows]
    return {"items": items, "total": total}


@router.get("/export", response_class=StreamingResponse)
def export_inventory(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    rows = db.execute(text(_QUERY))
    keys = list(rows.keys())
    data = [dict(row._mapping) for row in rows]

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=keys)
    writer.writeheader()
    writer.writerows(data)
    output.seek(0)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=inventory.csv"},
    )


@router.get("/hosts/{host_id}/explorer", response_model=InventoryExplorerRead)
def get_inventory_host_explorer(
    host_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    return _build_inventory_explorer_payload(db, host_id)


@router.put("/hosts/{host_id}/explorer/overrides", response_model=InventoryExplorerRead)
def save_inventory_host_overrides(
    host_id: int,
    body: InventoryExplorerOverrideBatchWrite,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    host = _host_or_404(db, host_id)
    detail = _build_inventory_explorer_payload(db, host_id)
    vars_by_key = {item.key: item for item in detail.vars}

    for update in body.updates:
        item = vars_by_key.get(update.key)
        if not item:
            raise HTTPException(status_code=400, detail=f"Variable '{update.key}' not found for host {host_id}")
        if not item.editable or not item.override_target:
            raise HTTPException(status_code=400, detail=f"Variable '{update.key}' is not editable")
        target = item.override_target
        if (
            update.kind != target.kind
            or update.target_id != target.target_id
            or update.target_name != target.target_name
            or update.app_id != target.app_id
        ):
            raise HTTPException(
                status_code=400, detail=f"Variable '{update.key}' no longer maps to that override target"
            )
        _apply_inventory_override(
            db,
            host,
            {
                "kind": update.kind,
                "target_id": update.target_id,
                "target_name": update.target_name,
                "app_id": update.app_id,
                "value": update.value,
                "remove": update.remove,
            },
        )

    db.commit()
    return _build_inventory_explorer_payload(db, host_id)


@router.get("/ansible")
def ansible_inventory(
    request: Request,
    x_inventory_token: Optional[str] = Header(default=None),
    bearer: Optional[str] = Depends(oauth2_scheme),
    access_token: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
):
    """
    Return an Ansible dynamic inventory JSON document.

    Three authentication modes are supported:

    1. **Session/bearer auth** (no ``token`` param): the standard
       ``Authorization: Bearer <jwt>`` header or ``access_token`` cookie.
       Use this mode for frontend downloads and CI pipelines that already
       hold a JWT.

    2. **Header token auth** (``X-Inventory-Token: <value>``): preferred
       method for pre-shared secret auth.  The token is not logged in URLs
       or proxy access logs.

    Modes 2 requires the ``ANSIBLE_INVENTORY_TOKEN`` environment
    variable to be set.
    """
    effective_token = x_inventory_token
    if effective_token is not None:
        managed_key = find_inventory_api_key_by_secret(db, effective_token)
        if managed_key is not None:
            permissions = set(managed_key.permissions or [])
            if InventoryApiKeyPermission.ansible_inventory_read.value not in permissions:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Inventory API key does not have ansible inventory access",
                )
            mark_inventory_api_key_used(db, managed_key)
        else:
            # Script-mode: static pre-shared token
            if not settings.ANSIBLE_INVENTORY_TOKEN:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Ansible inventory script endpoint is not enabled. "
                    "Set ANSIBLE_INVENTORY_TOKEN to enable it or create a managed inventory API key.",
                )
            if not secrets.compare_digest(effective_token, settings.ANSIBLE_INVENTORY_TOKEN):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid inventory token",
                )
    else:
        # Normal session/bearer auth — call get_current_user directly
        get_current_user(request=request, bearer=bearer, access_token=access_token, db=db)

    rows_result = db.execute(text(_QUERY))
    data = [dict(row._mapping) for row in rows_result]
    field_rows = [dict(row._mapping) for row in db.execute(text(_FIELD_VALUES_QUERY))]
    default_rows = [dict(row._mapping) for row in db.execute(text(_DEFAULTS_QUERY))]
    role_field_rows = [dict(row._mapping) for row in db.execute(text(_ROLE_FIELD_VALUES_QUERY))]
    global_role_default_rows = [dict(row._mapping) for row in db.execute(text(_GLOBAL_ROLE_DEFAULTS_QUERY))]
    host_type_field_default_rows = [dict(row._mapping) for row in db.execute(text(_HOST_TYPE_FIELD_DEFAULTS_QUERY))]
    host_type_field_rows = [dict(row._mapping) for row in db.execute(text(_HOST_TYPE_FIELD_VALUES_QUERY))]
    host_type_role_default_rows = [dict(row._mapping) for row in db.execute(text(_HOST_TYPE_ROLE_DEFAULTS_QUERY))]
    host_role_default_rows = [dict(row._mapping) for row in db.execute(text(_HOST_ROLE_DEFAULTS_QUERY))]
    status_field_rows = [dict(row._mapping) for row in db.execute(text(_STATUS_FIELD_VALUES_QUERY))]
    status_default_rows = [dict(row._mapping) for row in db.execute(text(_STATUS_DEFAULTS_QUERY))]
    ansible_default_rows = [dict(row._mapping) for row in db.execute(text(_ANSIBLE_DEFAULTS_QUERY))]
    host_ansible_var_rows = [dict(row._mapping) for row in db.execute(text(_HOST_ANSIBLE_VARS_QUERY))]
    payload = _build_ansible_inventory(
        data,
        field_rows=field_rows,
        default_rows=default_rows,
        role_field_rows=role_field_rows,
        global_role_default_rows=global_role_default_rows,
        host_type_field_default_rows=host_type_field_default_rows,
        host_type_field_rows=host_type_field_rows,
        host_type_role_default_rows=host_type_role_default_rows,
        host_role_default_rows=host_role_default_rows,
        status_field_rows=status_field_rows,
        status_default_rows=status_default_rows,
        ansible_default_rows=ansible_default_rows,
        host_ansible_var_rows=host_ansible_var_rows,
    )
    return JSONResponse(content=payload)
