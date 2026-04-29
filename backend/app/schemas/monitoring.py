from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class MonitoringSelectedHostRead(BaseModel):
    id: int
    name: str
    ipv4: str | None = None


class MonitoringBackendStatusRead(BaseModel):
    configured: bool
    reachable: bool
    ready: Optional[bool] = None
    url: Optional[str] = None
    version: Optional[str] = None
    error: Optional[str] = None


class MonitoringJobSummaryRead(BaseModel):
    job: str
    total_targets: int
    healthy_targets: int
    unhealthy_targets: int


class MonitoringTargetSummaryRead(BaseModel):
    total_targets: int
    healthy_targets: int
    unhealthy_targets: int
    jobs: list[MonitoringJobSummaryRead] = Field(default_factory=list)


class MonitoringHostStatusRead(BaseModel):
    name: str
    instance: str
    up: bool
    health_score: int = 100
    cpu_usage_percent: Optional[float] = None
    memory_usage_percent: Optional[float] = None
    root_disk_usage_percent: Optional[float] = None


class MonitoringLogVolumeRead(BaseModel):
    service_name: str
    lines_last_hour: int
    error_lines_last_hour: int = 0


class MonitoringLogEntryRead(BaseModel):
    timestamp: str
    service_name: Optional[str] = None
    job: Optional[str] = None
    instance: Optional[str] = None
    level: Optional[str] = None
    line: str


class MonitoringOverviewRead(BaseModel):
    prometheus: MonitoringBackendStatusRead
    loki: MonitoringBackendStatusRead
    selected_host: MonitoringSelectedHostRead | None = None
    targets: MonitoringTargetSummaryRead
    hosts: list[MonitoringHostStatusRead] = Field(default_factory=list)
    log_volume: list[MonitoringLogVolumeRead] = Field(default_factory=list)
    recent_logs: list[MonitoringLogEntryRead] = Field(default_factory=list)


class MonitoringSeriesPointRead(BaseModel):
    timestamp: str
    value: float


class MonitoringSeriesRead(BaseModel):
    key: str
    label: str
    unit: str | None = None
    points: list[MonitoringSeriesPointRead] = Field(default_factory=list)


class MonitoringHistoryRead(BaseModel):
    prometheus: MonitoringBackendStatusRead
    selected_host: MonitoringSelectedHostRead | None = None
    range_hours: int
    step_seconds: int
    generated_at: str
    series: list[MonitoringSeriesRead] = Field(default_factory=list)


class MonitoringSuggestedRunbookRead(BaseModel):
    job_template_id: int
    name: str
    category: str | None = None
    risk_level: str | None = None
    recommended_when: str | None = None
    ai_enabled: bool = False
    ai_agents: list[str] = Field(default_factory=list)
    can_run: bool = False


class MonitoringAlertRead(BaseModel):
    id: str
    alert_type: str
    severity: str
    title: str
    description: str
    host_name: str | None = None
    service_name: str | None = None
    metric_value: float | None = None
    threshold: float | None = None
    suggested_runbooks: list[MonitoringSuggestedRunbookRead] = Field(default_factory=list)


class MonitoringAlertsRead(BaseModel):
    items: list[MonitoringAlertRead] = Field(default_factory=list)


class MonitoringLogsRead(BaseModel):
    items: list[MonitoringLogEntryRead] = Field(default_factory=list)
