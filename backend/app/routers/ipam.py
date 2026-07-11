from __future__ import annotations

from collections import defaultdict
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_authenticated
from app.models.auth import AppUser
from app.models.inventory import Host, UnifiHostObservation, Vlan
from app.schemas.ipam import (
    IpamConflict,
    IpamDrift,
    IpamSummaryResponse,
    IpamUnparsedHost,
    IpamUsedIp,
    IpamVlanDetail,
    IpamVlanSummary,
)
from app.services import ipam as ipam_svc

router = APIRouter(prefix="/ipam", tags=["ipam"])


def _hosts_by_vlan(db: Session) -> Dict[int, List[Host]]:
    grouped: Dict[int, List[Host]] = defaultdict(list)
    for host in db.execute(select(Host)).scalars().all():
        grouped[host.vlan_id].append(host)
    return grouped


def _summary(vlan: Vlan, hosts: List[Host]) -> IpamVlanSummary:
    net = ipam_svc.parse_network(vlan.subnet)
    base = dict(
        vlan_pk=vlan.id,
        vlan_id=vlan.vlan_id,
        subnet=vlan.subnet,
        description=vlan.description,
        host_count=len(hosts),
    )
    if net is None:
        return IpamVlanSummary(
            scoped=False,
            total_usable=0,
            allocated_count=0,
            free_count=0,
            utilization_pct=0.0,
            conflict_count=0,
            **base,
        )

    in_subnet, _out, _unparsed = ipam_svc.partition_hosts(net, hosts)
    allocated = {addr for _h, addr in in_subnet}
    total_usable = len(ipam_svc.usable_addresses(net))
    allocated_count = len(allocated)
    conflicts = ipam_svc.group_duplicate_ips([h for h, _a in in_subnet])
    utilization = round(allocated_count / total_usable * 100, 1) if total_usable else 0.0
    return IpamVlanSummary(
        scoped=True,
        total_usable=total_usable,
        allocated_count=allocated_count,
        free_count=max(total_usable - allocated_count, 0),
        utilization_pct=utilization,
        conflict_count=len(conflicts),
        **base,
    )


@router.get("/", response_model=IpamSummaryResponse)
def list_ipam(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
) -> IpamSummaryResponse:
    vlans = db.execute(select(Vlan).order_by(Vlan.vlan_id.asc())).scalars().all()
    grouped = _hosts_by_vlan(db)
    items = [_summary(vlan, grouped.get(vlan.id, [])) for vlan in vlans]
    return IpamSummaryResponse(items=items, total=len(items))


@router.get("/{vlan_pk}", response_model=IpamVlanDetail)
def get_ipam_detail(
    vlan_pk: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
) -> IpamVlanDetail:
    vlan = db.get(Vlan, vlan_pk)
    if vlan is None:
        raise HTTPException(status_code=404, detail=f"VLAN {vlan_pk} not found")

    hosts = _hosts_by_vlan(db).get(vlan.id, [])
    summary = _summary(vlan, hosts)
    net = ipam_svc.parse_network(vlan.subnet)

    used: List[IpamUsedIp] = []
    conflicts: List[IpamConflict] = []
    out_of_subnet: List[IpamUsedIp] = []
    unparsed: List[IpamUnparsedHost] = []
    drift: List[IpamDrift] = []
    next_free = None

    if net is not None:
        in_subnet, out_hosts, unparsed_hosts = ipam_svc.partition_hosts(net, hosts)
        used = sorted(
            (IpamUsedIp(ip=str(addr), host_id=h.id, host_name=h.name) for h, addr in in_subnet),
            key=lambda u: tuple(int(o) for o in u.ip.split(".")),
        )
        out_of_subnet = [IpamUsedIp(ip=h.ipv4, host_id=h.id, host_name=h.name) for h in out_hosts]
        unparsed = [IpamUnparsedHost(host_id=h.id, host_name=h.name, value=h.ipv4) for h in unparsed_hosts]
        conflicts = [
            IpamConflict(
                ip=ip,
                hosts=[IpamUsedIp(ip=ip, host_id=h.id, host_name=h.name) for h in members],
            )
            for ip, members in sorted(ipam_svc.group_duplicate_ips([h for h, _a in in_subnet]).items())
        ]
        next_free = ipam_svc.next_free_ip(net, (addr for _h, addr in in_subnet))

    observations = {
        obs.host_id: obs
        for obs in db.execute(
            select(UnifiHostObservation).where(
                UnifiHostObservation.host_id.in_([h.id for h in hosts] or [0])
            )
        ).scalars().all()
    }
    for host in hosts:
        obs = observations.get(host.id)
        if obs and obs.observed_ipv4 and obs.observed_ipv4 != host.ipv4:
            drift.append(
                IpamDrift(
                    host_id=host.id,
                    host_name=host.name,
                    inventory_ip=host.ipv4,
                    observed_ip=obs.observed_ipv4,
                )
            )

    return IpamVlanDetail(
        **summary.model_dump(),
        used=used,
        conflicts=conflicts,
        out_of_subnet=out_of_subnet,
        unparsed=unparsed,
        drift=drift,
        next_free_ip=next_free,
    )
