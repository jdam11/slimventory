from __future__ import annotations

import re
from typing import Any

import yaml
from sqlalchemy import Select, bindparam, or_, select, text
from sqlalchemy.orm import Session

from app.models.inventory import Environment, Host, HostRole, Role, Vlan
from app.models.job_templates import InventoryFilterType
from app.services.field_encryption import decrypt_field_value

_FIELD_VALUES_QUERY = """\
SELECT h.name AS hostname, af.name AS field_name, haf.value, af.default_value
FROM host_app_fields haf
JOIN app_fields af ON af.id = haf.field_id
JOIN hosts h ON h.id = haf.host_id
"""

_DEFAULTS_QUERY = """\
SELECT h.name AS hostname, af.name AS field_name, af.default_value
FROM host_apps ha
JOIN hosts h ON h.id = ha.host_id
JOIN app_fields af ON af.app_id = ha.app_id
WHERE af.default_value IS NOT NULL
"""

_GLOBAL_ROLE_DEFAULTS_QUERY = """\
SELECT h.name AS hostname, rf.name AS field_name, rf.default_value, gdr.priority
FROM hosts h
CROSS JOIN global_default_roles gdr
JOIN role_fields rf ON rf.role_id = gdr.role_id
WHERE rf.default_value IS NOT NULL
"""

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

_HOST_TYPE_ROLE_DEFAULTS_QUERY = """\
SELECT h.name AS hostname, rf.name AS field_name, rf.default_value, htr.priority
FROM hosts h
JOIN host_type_roles htr ON htr.host_type_id = h.host_type_id
JOIN role_fields rf ON rf.role_id = htr.role_id
WHERE rf.default_value IS NOT NULL
"""

_HOST_ROLE_DEFAULTS_QUERY = """\
SELECT h.name AS hostname, rf.name AS field_name, rf.default_value, hr.priority
FROM hosts h
JOIN host_roles hr ON hr.host_id = h.id
JOIN role_fields rf ON rf.role_id = hr.role_id
WHERE rf.default_value IS NOT NULL
"""

_ROLE_FIELD_VALUES_QUERY = """\
SELECT h.name AS hostname, rf.name AS field_name, hrf.value
FROM host_role_fields hrf
JOIN role_fields rf ON rf.id = hrf.field_id
JOIN hosts h ON h.id = hrf.host_id
"""

_STATUS_DEFAULTS_QUERY = """\
SELECT h.name AS hostname, sf.name AS field_name, sf.default_value
FROM hosts h
JOIN status_fields sf ON sf.status_id = h.status_id
WHERE h.status_id IS NOT NULL AND sf.default_value IS NOT NULL
"""

_STATUS_FIELD_VALUES_QUERY = """\
SELECT h.name AS hostname, sf.name AS field_name, hsf.value
FROM host_status_fields hsf
JOIN status_fields sf ON sf.id = hsf.field_id
JOIN hosts h ON h.id = hsf.host_id
"""

_ANSIBLE_DEFAULTS_QUERY = """\
SELECT name AS field_name, value
FROM ansible_defaults
WHERE value IS NOT NULL
"""

_HOST_ANSIBLE_VARS_QUERY = """\
SELECT h.name AS hostname, ad.name AS field_name, hav.value
FROM host_ansible_vars hav
JOIN ansible_defaults ad ON ad.id = hav.var_id
JOIN hosts h ON h.id = hav.host_id
"""


def _coerce_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _normalize_int_list(value: Any) -> list[int]:
    seen: list[int] = []
    for item in _coerce_list(value):
        try:
            parsed = int(item)
        except (TypeError, ValueError):
            continue
        if parsed not in seen:
            seen.append(parsed)
    return seen


def _normalize_inventory_filters(
    filter_type: InventoryFilterType | None,
    filter_value: Any,
    inventory_filters: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if inventory_filters:
        return {
            "environment_ids": _normalize_int_list(inventory_filters.get("environment_ids")),
            "role_ids": _normalize_int_list(inventory_filters.get("role_ids")),
            "status_ids": _normalize_int_list(inventory_filters.get("status_ids")),
            "vlan_ids": _normalize_int_list(inventory_filters.get("vlan_ids")),
            "host_ids": _normalize_int_list(inventory_filters.get("host_ids")),
            "pattern": str(inventory_filters.get("pattern") or "").strip() or None,
        }

    normalized = {
        "environment_ids": [],
        "role_ids": [],
        "status_ids": [],
        "vlan_ids": [],
        "host_ids": [],
        "pattern": None,
    }
    if filter_type is None or filter_type == InventoryFilterType.all:
        return normalized
    if filter_type == InventoryFilterType.environment:
        normalized["environment_ids"] = _normalize_int_list(filter_value)
    elif filter_type == InventoryFilterType.role:
        normalized["role_ids"] = _normalize_int_list(filter_value)
    elif filter_type == InventoryFilterType.status:
        normalized["status_ids"] = _normalize_int_list(filter_value)
    elif filter_type == InventoryFilterType.vlan:
        normalized["vlan_ids"] = _normalize_int_list(filter_value)
    elif filter_type == InventoryFilterType.hosts:
        normalized["host_ids"] = _normalize_int_list(filter_value)
    elif filter_type == InventoryFilterType.pattern:
        normalized["pattern"] = str(filter_value or "").strip() or None
    return normalized


def _sanitize_group_name(prefix: str, value: str) -> str:
    sanitized = re.sub(r"[^a-zA-Z0-9_]+", "_", value.strip()).strip("_").lower()
    return f"{prefix}_{sanitized or 'default'}"


def _group_slug(prefix: str, raw: str) -> str:
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


def _host_select() -> Select:
    return (
        select(
            Host.id,
            Host.name,
            Host.ipv4,
            Environment.name.label("environment_name"),
            Role.name.label("role_name"),
            Vlan.vlan_id.label("vlan_value"),
        )
        .join(Environment, Environment.id == Host.environment_id)
        .outerjoin(HostRole, HostRole.host_id == Host.id)
        .outerjoin(Role, Role.id == HostRole.role_id)
        .join(Vlan, Vlan.id == Host.vlan_id)
        .distinct()
    )


def _apply_filter(
    stmt: Select,
    filter_type: InventoryFilterType,
    filter_value: Any,
    inventory_filters: dict[str, Any] | None = None,
) -> Select:
    filters = _normalize_inventory_filters(filter_type, filter_value, inventory_filters)

    if filters["environment_ids"]:
        stmt = stmt.where(Host.environment_id.in_(filters["environment_ids"]))
    if filters["role_ids"]:
        stmt = stmt.where(HostRole.role_id.in_(filters["role_ids"]))
    if filters["status_ids"]:
        stmt = stmt.where(Host.status_id.in_(filters["status_ids"]))
    if filters["vlan_ids"]:
        stmt = stmt.where(Host.vlan_id.in_(filters["vlan_ids"]))
    if filters["host_ids"]:
        stmt = stmt.where(Host.id.in_(filters["host_ids"]))
    if filters["pattern"]:
        like = str(filters["pattern"]).replace("*", "%")
        stmt = stmt.where(or_(Host.name.ilike(like), Host.ipv4.ilike(like)))

    if filter_type != InventoryFilterType.all and not any(
        [
            filters["environment_ids"],
            filters["role_ids"],
            filters["status_ids"],
            filters["vlan_ids"],
            filters["host_ids"],
            filters["pattern"],
        ]
    ):
        return stmt.where(False)

    return stmt


def _build_ansible_inventory(db: Session, rows: list[dict[str, Any]], hostnames: set[str]) -> dict[str, Any]:
    hostvars: dict[str, Any] = {}
    groups: dict[str, list[str]] = {}

    for row in rows:
        hostname = row.get("name")
        if not hostname:
            continue
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

        def add_to_group(prefix: str, value: Any) -> None:
            if value is None:
                return
            gname = _group_slug(prefix, str(value))
            groups.setdefault(gname, [])
            if hostname not in groups[gname]:
                groups[gname].append(hostname)

        add_to_group("env", row.get("env"))
        roles_str = row.get("role")
        if roles_str:
            for role_name in roles_str.split(", "):
                add_to_group("role", role_name.strip())
        add_to_group("type", row.get("type"))
        if row.get("vlan_id") is not None:
            add_to_group("vlan", row.get("vlan_id"))
        add_to_group("k3s", row.get("k3s_cluster"))
        add_to_group("status", row.get("status"))
        add_to_group("ds_os", row.get("vm_storage_os_datastore"))
        add_to_group("ds_hdd01", row.get("vm_storage_hdd01_datastore"))
        apps_str = row.get("apps")
        if apps_str:
            for app in apps_str.split(","):
                add_to_group("app", app.strip())

    def filter_host_rows(query: str) -> list[dict[str, Any]]:
        rows = [dict(row._mapping) for row in db.execute(text(query))]
        return [row for row in rows if row.get("hostname") in hostnames]

    for row in [dict(row._mapping) for row in db.execute(text(_ANSIBLE_DEFAULTS_QUERY))]:
        fname = row.get("field_name")
        val = _coerce_inventory_value(decrypt_field_value(row.get("value")))
        if fname:
            for hv in hostvars.values():
                hv.setdefault(fname, val)

    for row in filter_host_rows(_STATUS_DEFAULTS_QUERY):
        hostvars[row["hostname"]].setdefault(
            row["field_name"], _coerce_inventory_value(decrypt_field_value(row.get("default_value")))
        )

    for row in sorted(filter_host_rows(_GLOBAL_ROLE_DEFAULTS_QUERY), key=lambda r: -(r.get("priority") or 100)):
        hostvars[row["hostname"]].setdefault(
            row["field_name"], _coerce_inventory_value(decrypt_field_value(row.get("default_value")))
        )

    for row in filter_host_rows(_HOST_TYPE_FIELD_DEFAULTS_QUERY):
        hostvars[row["hostname"]].setdefault(
            row["field_name"], _coerce_inventory_value(decrypt_field_value(row.get("default_value")))
        )

    for row in sorted(filter_host_rows(_HOST_TYPE_ROLE_DEFAULTS_QUERY), key=lambda r: -(r.get("priority") or 100)):
        hostvars[row["hostname"]][row["field_name"]] = _coerce_inventory_value(
            decrypt_field_value(row.get("default_value"))
        )

    for row in sorted(filter_host_rows(_HOST_ROLE_DEFAULTS_QUERY), key=lambda r: -(r.get("priority") or 100)):
        hostvars[row["hostname"]][row["field_name"]] = _coerce_inventory_value(
            decrypt_field_value(row.get("default_value"))
        )

    for row in filter_host_rows(_DEFAULTS_QUERY):
        hostvars[row["hostname"]].setdefault(
            row["field_name"], _coerce_inventory_value(decrypt_field_value(row.get("default_value")))
        )

    for row in filter_host_rows(_HOST_TYPE_FIELD_VALUES_QUERY):
        hostvars[row["hostname"]][row["field_name"]] = _coerce_inventory_value(decrypt_field_value(row.get("value")))

    for row in filter_host_rows(_STATUS_FIELD_VALUES_QUERY):
        hostvars[row["hostname"]][row["field_name"]] = _coerce_inventory_value(decrypt_field_value(row.get("value")))

    for row in filter_host_rows(_ROLE_FIELD_VALUES_QUERY):
        hostvars[row["hostname"]][row["field_name"]] = _coerce_inventory_value(decrypt_field_value(row.get("value")))

    for row in filter_host_rows(_FIELD_VALUES_QUERY):
        hostvars[row["hostname"]][row["field_name"]] = _coerce_inventory_value(decrypt_field_value(row.get("value")))

    for row in filter_host_rows(_HOST_ANSIBLE_VARS_QUERY):
        hostvars[row["hostname"]][row["field_name"]] = _coerce_inventory_value(decrypt_field_value(row.get("value")))

    inventory: dict[str, Any] = {
        "all": {
            "hosts": {hostname: values for hostname, values in hostvars.items()},
            "children": {},
        }
    }
    for group_name, group_hosts in groups.items():
        inventory["all"]["children"][group_name] = {
            "hosts": {hostname: {} for hostname in group_hosts},
        }
    return inventory


def build_inventory_ini(
    db: Session,
    filter_type: InventoryFilterType,
    filter_value: Any,
    inventory_filters: dict[str, Any] | None = None,
) -> str:
    stmt = _apply_filter(_host_select(), filter_type, filter_value, inventory_filters).order_by(
        Host.name.asc(), Host.id.asc()
    )
    host_ids = [row.id for row in db.execute(stmt).all()]

    if not host_ids:
        return "[all]\nlocalhost ansible_connection=local\n"

    inventory_rows = db.execute(
        text("SELECT * FROM v_inventory WHERE id IN :host_ids ORDER BY name ASC, id ASC").bindparams(
            bindparam("host_ids", expanding=True)
        ),
        {"host_ids": host_ids},
    ).all()
    rows = [dict(row._mapping) for row in inventory_rows]
    payload = _build_ansible_inventory(db, rows, {str(row["name"]) for row in rows if row.get("name")})
    return yaml.safe_dump(payload, sort_keys=False)


def resolve_host_ssh_aliases(db: Session, host_id: int) -> list[str]:
    inventory_rows = db.execute(
        text("SELECT * FROM v_inventory WHERE id = :host_id"),
        {"host_id": host_id},
    ).all()
    rows = [dict(row._mapping) for row in inventory_rows]
    if not rows:
        return []
    hostname = str(rows[0].get("name") or "").strip()
    payload = _build_ansible_inventory(db, rows, {hostname} if hostname else set())
    hostvars = payload.get("all", {}).get("hosts", {}).get(hostname, {}) if hostname else {}
    aliases: list[str] = []
    for candidate in (hostname, hostvars.get("ansible_host"), rows[0].get("ipv4")):
        if candidate is None:
            continue
        alias = str(candidate).strip()
        if alias and alias not in aliases:
            aliases.append(alias)
    return aliases


def get_filtered_inventory_rows(
    db: Session,
    filter_type: InventoryFilterType,
    filter_value: Any,
    inventory_filters: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    stmt = _apply_filter(_host_select(), filter_type, filter_value, inventory_filters).order_by(
        Host.name.asc(), Host.id.asc()
    )
    host_ids = [row.id for row in db.execute(stmt).all()]
    if not host_ids:
        return []
    inventory_rows = db.execute(
        text("SELECT * FROM v_inventory WHERE id IN :host_ids ORDER BY name ASC, id ASC").bindparams(
            bindparam("host_ids", expanding=True)
        ),
        {"host_ids": host_ids},
    ).all()
    return [dict(row._mapping) for row in inventory_rows]


def normalize_inventory_filters_for_template(
    filter_type: InventoryFilterType | None,
    filter_value: Any,
    inventory_filters: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return _normalize_inventory_filters(filter_type, filter_value, inventory_filters)
