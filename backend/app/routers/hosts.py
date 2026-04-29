from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.crud import delete_record, get_or_404
from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import Host, HostRole, ProxmoxPendingHost, UnifiHostObservation, UnifiPortForwardObservation
from app.schemas.inventory import HostCreate, HostRead, HostRolesBulkAdd, HostUpdate, PageResponse, UnifiPortForwardRead

router = APIRouter(prefix="/hosts", tags=["hosts"])


def _role_ids_for_hosts(db: Session, host_ids: list[int]) -> dict[int, list[int]]:
    """Return {host_id: [role_id, ...]} sorted by priority asc."""
    if not host_ids:
        return {}
    rows = db.execute(
        select(HostRole.host_id, HostRole.role_id)
        .where(HostRole.host_id.in_(host_ids))
        .order_by(HostRole.host_id, HostRole.priority)
    ).all()
    result: dict[int, list[int]] = {}
    for host_id, role_id in rows:
        result.setdefault(host_id, []).append(role_id)
    return result


def _to_read(host: Host, role_ids: list[int]) -> HostRead:
    data = {c.name: getattr(host, c.name) for c in host.__table__.columns}
    data["role_ids"] = role_ids
    data["effective_ipv4"] = host.ipv4
    return HostRead(**data)


def _unifi_data_for_hosts(
    db: Session,
    host_ids: list[int],
) -> tuple[dict[int, UnifiHostObservation], dict[int, list[UnifiPortForwardObservation]]]:
    if not host_ids:
        return {}, {}
    observations = (
        db.execute(select(UnifiHostObservation).where(UnifiHostObservation.host_id.in_(host_ids))).scalars().all()
    )
    port_forwards = (
        db.execute(
            select(UnifiPortForwardObservation)
            .where(UnifiPortForwardObservation.host_id.in_(host_ids))
            .order_by(UnifiPortForwardObservation.host_id.asc(), UnifiPortForwardObservation.id.asc())
        )
        .scalars()
        .all()
    )
    observation_map = {item.host_id: item for item in observations}
    port_forward_map: dict[int, list[UnifiPortForwardObservation]] = {}
    for item in port_forwards:
        port_forward_map.setdefault(item.host_id, []).append(item)
    return observation_map, port_forward_map


def _to_read_with_unifi(
    host: Host,
    role_ids: list[int],
    observation: UnifiHostObservation | None,
    port_forwards: list[UnifiPortForwardObservation],
) -> HostRead:
    data = {c.name: getattr(host, c.name) for c in host.__table__.columns}
    data["role_ids"] = role_ids
    observed_ip = observation.observed_ipv4 if observation is not None else None
    data["unifi_observed_ip"] = observed_ip
    data["effective_ipv4"] = observed_ip if host.ipv4 == "DHCP" and observed_ip else host.ipv4
    data["unifi_network_name"] = observation.network_name if observation is not None else None
    data["unifi_vlan_tag"] = observation.vlan_tag if observation is not None else None
    data["unifi_last_seen_at"] = observation.last_seen_at if observation is not None else None
    data["unifi_port_forward_count"] = len(port_forwards)
    data["unifi_port_forwards"] = [UnifiPortForwardRead.model_validate(item) for item in port_forwards]
    return HostRead(**data)


def _sync_roles(db: Session, host_id: int, role_ids: list[int]) -> None:
    """Replace all host_roles for host_id with role_ids (index 0 = priority 1)."""
    db.execute(delete(HostRole).where(HostRole.host_id == host_id))
    for i, rid in enumerate(role_ids):
        db.add(HostRole(host_id=host_id, role_id=rid, priority=i + 1))


def _append_roles(db: Session, host_id: int, role_ids: list[int]) -> list[int]:
    """Append new roles to the end of the host role order, preserving existing priority."""
    existing = _role_ids_for_hosts(db, [host_id]).get(host_id, [])
    merged = existing + [rid for rid in role_ids if rid not in existing]
    _sync_roles(db, host_id, merged)
    return merged


@router.get("/", response_model=PageResponse[HostRead])
def list_hosts(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    total = db.scalar(select(func.count()).select_from(Host)) or 0
    hosts = db.execute(select(Host).order_by(Host.id).offset(skip).limit(limit)).scalars().all()
    role_map = _role_ids_for_hosts(db, [h.id for h in hosts])
    observation_map, port_forward_map = _unifi_data_for_hosts(db, [h.id for h in hosts])
    return {
        "items": [
            _to_read_with_unifi(
                h,
                role_map.get(h.id, []),
                observation_map.get(h.id),
                port_forward_map.get(h.id, []),
            )
            for h in hosts
        ],
        "total": total,
    }


@router.post("/bulk-add-roles", response_model=dict)
def bulk_add_roles(
    body: HostRolesBulkAdd,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    host_ids = sorted(set(body.host_ids))
    role_ids = []
    for role_id in body.role_ids:
        if role_id not in role_ids:
            role_ids.append(role_id)
    if not host_ids:
        raise HTTPException(status_code=400, detail="Select at least one host")
    if not role_ids:
        raise HTTPException(status_code=400, detail="Select at least one role")

    hosts = db.execute(select(Host).where(Host.id.in_(host_ids))).scalars().all()
    found_host_ids = {host.id for host in hosts}
    missing = [host_id for host_id in host_ids if host_id not in found_host_ids]
    if missing:
        raise HTTPException(
            status_code=404, detail=f"Host(s) not found: {', '.join(str(host_id) for host_id in missing)}"
        )

    for host_id in host_ids:
        _append_roles(db, host_id, role_ids)

    db.commit()
    return {
        "updated_host_ids": host_ids,
        "added_role_ids": role_ids,
        "updated_count": len(host_ids),
    }


@router.get("/{host_id}", response_model=HostRead)
def get_host(
    host_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    host = get_or_404(db, Host, host_id)
    role_map = _role_ids_for_hosts(db, [host.id])
    observation_map, port_forward_map = _unifi_data_for_hosts(db, [host.id])
    return _to_read_with_unifi(
        host,
        role_map.get(host.id, []),
        observation_map.get(host.id),
        port_forward_map.get(host.id, []),
    )


@router.post("/", response_model=HostRead, status_code=status.HTTP_201_CREATED)
def create_host(
    body: HostCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    data = body.model_dump()
    role_ids = data.pop("role_ids")
    host = Host(**data)
    db.add(host)
    db.flush()
    _sync_roles(db, host.id, role_ids)
    db.commit()
    db.refresh(host)
    return _to_read_with_unifi(host, role_ids, None, [])


@router.patch("/{host_id}", response_model=HostRead)
def update_host(
    host_id: int,
    body: HostUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    host = get_or_404(db, Host, host_id)
    data = body.model_dump(exclude_unset=True)
    role_ids = data.pop("role_ids", None)
    for key, value in data.items():
        setattr(host, key, value)
    if role_ids is not None:
        _sync_roles(db, host.id, role_ids)
    db.commit()
    db.refresh(host)
    role_map = _role_ids_for_hosts(db, [host.id])
    observation_map, port_forward_map = _unifi_data_for_hosts(db, [host.id])
    return _to_read_with_unifi(
        host,
        role_map.get(host.id, []),
        observation_map.get(host.id),
        port_forward_map.get(host.id, []),
    )


@router.delete("/{host_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_host(
    host_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    obj = get_or_404(db, Host, host_id)
    delete_record(db, obj)


@router.post("/{host_id}/recycle", status_code=status.HTTP_200_OK)
def recycle_host(
    host_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    """Delete a host and queue it as pending so the next sync re-discovers it."""
    host = get_or_404(db, Host, host_id)

    existing_pending = db.execute(
        select(ProxmoxPendingHost).where(ProxmoxPendingHost.vmid == host_id)
    ).scalar_one_or_none()
    if existing_pending is not None:
        raise HTTPException(
            status_code=409,
            detail="A pending entry already exists for this VMID",
        )

    pending = ProxmoxPendingHost(
        vmid=host.id,
        name=host.name,
        vm_type="qemu",
        node=host.proxmox_node,
        cpu_cores=1,
        ram_mb=512,
        status="pending",
        created_at=datetime.now(timezone.utc),
        notes=f"Recycled from host {host.id} ({host.name})",
    )

    delete_record(db, host)
    db.add(pending)
    db.commit()
    return {"detail": f"Host {host_id} recycled — will appear in pending on next sync"}
