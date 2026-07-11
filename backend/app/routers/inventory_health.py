from __future__ import annotations

from datetime import datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_authenticated
from app.models.auth import AppUser
from app.models.inventory import (
    App,
    Host,
    HostApp,
    HostRole,
    K3sClusterApp,
    Role,
    UnifiHostObservation,
    Vlan,
)
from app.schemas.inventory_health import HealthCounts, HealthFinding, HealthReport
from app.services import ipam as ipam_svc

router = APIRouter(prefix="/inventory-health", tags=["inventory-health"])

STALE_AFTER = timedelta(days=7)


@router.get("/", response_model=HealthReport)
def get_health(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
) -> HealthReport:
    findings: List[HealthFinding] = []
    now = datetime.utcnow()

    hosts = db.execute(select(Host)).scalars().all()
    hosts_with_role = {hr.host_id for hr in db.execute(select(HostRole)).scalars().all()}
    observations = {
        obs.host_id: obs for obs in db.execute(select(UnifiHostObservation)).scalars().all()
    }

    for host in hosts:
        if host.id not in hosts_with_role:
            findings.append(
                HealthFinding(
                    category="host_no_role",
                    severity="warn",
                    message=f"Host '{host.name}' has no roles assigned",
                    entity="host",
                    entity_id=str(host.id),
                    link="/inventory/role-matrix",
                )
            )
        if host.last_synced_at is not None and now - host.last_synced_at > STALE_AFTER:
            findings.append(
                HealthFinding(
                    category="host_stale_proxmox",
                    severity="info",
                    message=f"Host '{host.name}' last Proxmox sync was {host.last_synced_at:%Y-%m-%d}",
                    entity="host",
                    entity_id=str(host.id),
                    link="/inventory/hosts",
                )
            )
        obs = observations.get(host.id)
        if obs and obs.last_seen_at is not None and now - obs.last_seen_at > STALE_AFTER:
            findings.append(
                HealthFinding(
                    category="host_stale_unifi",
                    severity="info",
                    message=f"Host '{host.name}' not seen by UniFi since {obs.last_seen_at:%Y-%m-%d}",
                    entity="host",
                    entity_id=str(host.id),
                    link="/networking/unifi",
                )
            )

    for ip, members in sorted(ipam_svc.group_duplicate_ips(hosts).items()):
        names = ", ".join(f"{h.name} (#{h.id})" for h in members)
        findings.append(
            HealthFinding(
                category="duplicate_ip",
                severity="warn",
                message=f"IP {ip} is assigned to multiple hosts: {names}",
                entity="ip",
                entity_id=ip,
                link="/networking/ipam",
            )
        )

    deployed_app_ids = {ha.app_id for ha in db.execute(select(HostApp)).scalars().all()}
    deployed_app_ids |= {ca.app_id for ca in db.execute(select(K3sClusterApp)).scalars().all()}
    for app in db.execute(select(App)).scalars().all():
        if app.id not in deployed_app_ids:
            findings.append(
                HealthFinding(
                    category="app_no_deployment",
                    severity="info",
                    message=f"App '{app.name}' is not deployed to any host or cluster",
                    entity="app",
                    entity_id=str(app.id),
                    link="/apps/host-apps",
                )
            )

    hosts_per_vlan = {h.vlan_id for h in hosts}
    for vlan in db.execute(select(Vlan)).scalars().all():
        if vlan.id not in hosts_per_vlan:
            findings.append(
                HealthFinding(
                    category="vlan_no_hosts",
                    severity="info",
                    message=f"VLAN {vlan.vlan_id} has no hosts",
                    entity="vlan",
                    entity_id=str(vlan.id),
                    link="/networking/vlans",
                )
            )

    used_role_ids = {hr.role_id for hr in db.execute(select(HostRole)).scalars().all()}
    for role in db.execute(select(Role)).scalars().all():
        if role.id not in used_role_ids:
            findings.append(
                HealthFinding(
                    category="role_unused",
                    severity="info",
                    message=f"Role '{role.name}' is not assigned to any host",
                    entity="role",
                    entity_id=str(role.id),
                    link="/inventory/role-matrix",
                )
            )

    counts = HealthCounts(
        info=sum(1 for f in findings if f.severity == "info"),
        warn=sum(1 for f in findings if f.severity == "warn"),
    )
    return HealthReport(counts=counts, total=len(findings), findings=findings)
