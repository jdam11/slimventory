from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.ai import AiAgent, AiAgentTool, AiTool
from app.models.auth import AppUser
from app.models.inventory import Host
from app.models.job_templates import JobTemplate
from app.schemas.monitoring import (
    MonitoringAlertRead,
    MonitoringAlertsRead,
    MonitoringBackendStatusRead,
    MonitoringHistoryRead,
    MonitoringHostStatusRead,
    MonitoringJobSummaryRead,
    MonitoringLogEntryRead,
    MonitoringLogsRead,
    MonitoringLogVolumeRead,
    MonitoringOverviewRead,
    MonitoringSelectedHostRead,
    MonitoringTargetSummaryRead,
)
from app.schemas.monitoring_settings import (
    MonitoringSecretMappingCreate,
    MonitoringSecretMappingRead,
    MonitoringSecretMappingUpdate,
    MonitoringSettingsRead,
    MonitoringSettingsUpdate,
)
from app.services.monitoring import (
    MonitoringInventoryHost,
    add_health_scores,
    build_monitoring_alerts,
    get_loki_error_volume,
    get_loki_log_volume,
    get_loki_status,
    get_prometheus_history,
    get_prometheus_status,
    get_prometheus_target_summary,
    get_recent_logs,
)
from app.services.monitoring_settings import (
    MonitoringSettingsError,
    create_secret_mapping,
    delete_secret_mapping,
    get_monitoring_settings_read,
    get_secret_mapping,
    list_secret_mappings,
    to_secret_mapping_read,
    update_monitoring_settings,
    update_secret_mapping,
)

router = APIRouter(prefix="/monitoring", tags=["monitoring"])


def _inventory_hosts(db: Session) -> list[MonitoringInventoryHost]:
    rows = db.execute(select(Host).order_by(Host.name.asc())).scalars().all()
    return [MonitoringInventoryHost(id=row.id, name=row.name, ipv4=row.ipv4) for row in rows]


def _suggest_runbooks(
    db: Session,
    *,
    current_user: AppUser,
    alert_type: str,
    service_name: str | None = None,
) -> list[dict]:
    templates = (
        db.execute(
            select(JobTemplate)
            .where(
                JobTemplate.runbook_enabled.is_(True),
                JobTemplate.alert_match_type == alert_type,
            )
            .order_by(JobTemplate.name.asc())
        )
        .scalars()
        .all()
    )
    items: list[dict] = []
    for template in templates:
        if template.alert_match_value and service_name and template.alert_match_value.lower() != service_name.lower():
            continue
        if template.alert_match_value and not service_name:
            continue
        ai_tool = db.execute(
            select(AiTool).where(
                AiTool.job_template_id == template.id,
                AiTool.is_enabled.is_(True),
            )
        ).scalar_one_or_none()
        ai_agents = (
            db.execute(
                select(AiAgent.name)
                .join(AiAgentTool, AiAgentTool.agent_id == AiAgent.id)
                .where(
                    AiAgentTool.tool_id == ai_tool.id,
                    AiAgent.is_enabled.is_(True),
                )
                .order_by(AiAgent.name.asc())
            )
            .scalars()
            .all()
            if ai_tool is not None
            else []
        )
        items.append(
            {
                "job_template_id": template.id,
                "name": template.name,
                "category": template.runbook_category,
                "risk_level": template.risk_level,
                "recommended_when": template.recommended_when,
                "ai_enabled": ai_tool is not None,
                "ai_agents": list(ai_agents),
                "can_run": current_user.role.value == "admin" and template.playbook_id is not None,
            }
        )
    return items


@router.get("/overview", response_model=MonitoringOverviewRead)
def monitoring_overview(
    host_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    prometheus = get_prometheus_status()
    loki = get_loki_status()
    selected_host: MonitoringInventoryHost | None = None
    inventory_hosts = _inventory_hosts(db)

    if host_id is not None:
        host = db.get(Host, host_id)
        if host is None:
            raise HTTPException(status_code=404, detail="host not found")
        selected_host = MonitoringInventoryHost(id=host.id, name=host.name, ipv4=host.ipv4)

    target_summary = {"total_targets": 0, "healthy_targets": 0, "unhealthy_targets": 0, "jobs": []}
    hosts: list[dict] = []
    log_volume: list[dict] = []
    recent_logs: list[dict] = []

    if prometheus.reachable:
        target_summary, hosts = get_prometheus_target_summary(
            selected_host=selected_host, inventory_hosts=inventory_hosts
        )
        hosts = add_health_scores(hosts)
    if loki.reachable:
        log_volume = get_loki_log_volume(selected_host=selected_host)
        error_volume = {
            item["service_name"]: item["error_lines_last_hour"]
            for item in get_loki_error_volume(selected_host=selected_host)
        }
        for item in log_volume:
            item["error_lines_last_hour"] = int(error_volume.get(item["service_name"], 0))
        recent_logs = get_recent_logs(selected_host=selected_host, limit=12)

    return MonitoringOverviewRead(
        prometheus=MonitoringBackendStatusRead.model_validate(prometheus.__dict__),
        loki=MonitoringBackendStatusRead.model_validate(loki.__dict__),
        selected_host=(
            MonitoringSelectedHostRead(id=selected_host.id, name=selected_host.name, ipv4=selected_host.ipv4)
            if selected_host
            else None
        ),
        targets=MonitoringTargetSummaryRead(
            total_targets=int(target_summary["total_targets"]),
            healthy_targets=int(target_summary["healthy_targets"]),
            unhealthy_targets=int(target_summary["unhealthy_targets"]),
            jobs=[MonitoringJobSummaryRead.model_validate(item) for item in target_summary["jobs"]],
        ),
        hosts=[MonitoringHostStatusRead.model_validate(item) for item in hosts],
        log_volume=[MonitoringLogVolumeRead.model_validate(item) for item in log_volume],
        recent_logs=[MonitoringLogEntryRead.model_validate(item) for item in recent_logs],
    )


@router.get("/history", response_model=MonitoringHistoryRead)
def monitoring_history(
    host_id: int | None = Query(default=None),
    hours: int = Query(default=24, ge=1, le=168),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    prometheus = get_prometheus_status()
    selected_host: MonitoringInventoryHost | None = None
    inventory_hosts = _inventory_hosts(db)

    if host_id is not None:
        host = db.get(Host, host_id)
        if host is None:
            raise HTTPException(status_code=404, detail="host not found")
        selected_host = MonitoringInventoryHost(id=host.id, name=host.name, ipv4=host.ipv4)

    history = {
        "range_hours": hours,
        "step_seconds": 300,
        "generated_at": "",
        "series": [],
    }
    if prometheus.reachable:
        history = get_prometheus_history(selected_host=selected_host, inventory_hosts=inventory_hosts, hours=hours)

    return MonitoringHistoryRead(
        prometheus=MonitoringBackendStatusRead.model_validate(prometheus.__dict__),
        selected_host=(
            MonitoringSelectedHostRead(id=selected_host.id, name=selected_host.name, ipv4=selected_host.ipv4)
            if selected_host
            else None
        ),
        range_hours=int(history["range_hours"]),
        step_seconds=int(history["step_seconds"]),
        generated_at=str(history["generated_at"]),
        series=list(history["series"]),
    )


@router.get("/alerts", response_model=MonitoringAlertsRead)
def monitoring_alerts(
    host_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_authenticated),
):
    selected_host: MonitoringInventoryHost | None = None
    inventory_hosts = _inventory_hosts(db)
    if host_id is not None:
        host = db.get(Host, host_id)
        if host is None:
            raise HTTPException(status_code=404, detail="host not found")
        selected_host = MonitoringInventoryHost(id=host.id, name=host.name, ipv4=host.ipv4)

    target_summary = {"jobs": []}
    hosts: list[dict] = []
    log_volume: list[dict] = []
    error_volume: list[dict] = []

    if get_prometheus_status().reachable:
        target_summary, hosts = get_prometheus_target_summary(
            selected_host=selected_host, inventory_hosts=inventory_hosts
        )
        hosts = add_health_scores(hosts)
    if get_loki_status().reachable:
        log_volume = get_loki_log_volume(selected_host=selected_host)
        error_volume = get_loki_error_volume(selected_host=selected_host)

    alerts = build_monitoring_alerts(
        host_rows=hosts,
        target_summary=target_summary,
        log_volume=log_volume,
        error_volume=error_volume,
        selected_host=selected_host,
    )
    for alert in alerts:
        alert["suggested_runbooks"] = _suggest_runbooks(
            db,
            current_user=current_user,
            alert_type=str(alert["alert_type"]),
            service_name=alert.get("service_name"),
        )
    return MonitoringAlertsRead(items=[MonitoringAlertRead.model_validate(item) for item in alerts])


@router.get("/logs", response_model=MonitoringLogsRead)
def monitoring_logs(
    host_id: int | None = Query(default=None),
    service_name: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    selected_host: MonitoringInventoryHost | None = None
    if host_id is not None:
        host = db.get(Host, host_id)
        if host is None:
            raise HTTPException(status_code=404, detail="host not found")
        selected_host = MonitoringInventoryHost(id=host.id, name=host.name, ipv4=host.ipv4)
    return MonitoringLogsRead(
        items=[
            MonitoringLogEntryRead.model_validate(item)
            for item in get_recent_logs(service_name=service_name, selected_host=selected_host, limit=limit)
        ]
    )


@router.get("/settings", response_model=MonitoringSettingsRead)
def monitoring_settings(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    return get_monitoring_settings_read(db)


@router.patch("/settings", response_model=MonitoringSettingsRead)
def patch_monitoring_settings(
    body: MonitoringSettingsUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    data = body.model_dump(exclude_unset=True)
    try:
        update_monitoring_settings(
            db,
            prometheus=data.get("prometheus"),
            loki=data.get("loki"),
            bitwarden=data.get("bitwarden"),
        )
    except MonitoringSettingsError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return get_monitoring_settings_read(db)


@router.get("/secret-mappings", response_model=list[MonitoringSecretMappingRead])
def monitoring_secret_mappings(
    job_template_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    return [to_secret_mapping_read(item) for item in list_secret_mappings(db, job_template_id=job_template_id)]


@router.post("/secret-mappings", response_model=MonitoringSecretMappingRead, status_code=201)
def create_monitoring_secret_mapping(
    body: MonitoringSecretMappingCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    mapping = create_secret_mapping(db, **body.model_dump())
    return to_secret_mapping_read(mapping)


@router.patch("/secret-mappings/{mapping_id}", response_model=MonitoringSecretMappingRead)
def patch_monitoring_secret_mapping(
    mapping_id: int,
    body: MonitoringSecretMappingUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    mapping = get_secret_mapping(db, mapping_id)
    if mapping is None:
        raise HTTPException(status_code=404, detail="secret mapping not found")
    data = body.model_dump(exclude_unset=True)
    update_secret_mapping(db, mapping, **data)
    return to_secret_mapping_read(mapping)


@router.delete("/secret-mappings/{mapping_id}", status_code=204)
def delete_monitoring_secret_mapping(
    mapping_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    mapping = get_secret_mapping(db, mapping_id)
    if mapping is None:
        raise HTTPException(status_code=404, detail="secret mapping not found")
    delete_secret_mapping(db, mapping)
