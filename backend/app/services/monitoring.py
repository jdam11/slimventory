from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.services.monitoring_settings import (
    BackendConnection,
    MonitoringSettingsError,
    get_monitoring_settings_snapshot,
    request_backend_json,
    request_backend_status,
)

logger = logging.getLogger(__name__)

CPU_USAGE_QUERY = (
    '100 * (1 - avg by (instance, nodename) '
    '(rate(node_cpu_seconds_total{job="node_exporter_os",mode="idle"}[5m])))'
)
MEMORY_USAGE_QUERY = (
    '100 * (1 - (node_memory_MemAvailable_bytes{job="node_exporter_os"} '
    '/ node_memory_MemTotal_bytes{job="node_exporter_os"}))'
)
ROOT_DISK_USAGE_QUERY = (
    '100 * (1 - (node_filesystem_avail_bytes{job="node_exporter_os",mountpoint="/",fstype!=""} '
    '/ node_filesystem_size_bytes{job="node_exporter_os",mountpoint="/",fstype!=""}))'
)

HIGH_CPU_THRESHOLD = 85.0
HIGH_MEMORY_THRESHOLD = 90.0
HIGH_DISK_THRESHOLD = 90.0
SERVICE_ERROR_LINES_THRESHOLD = 25
SERVICE_VOLUME_LINES_THRESHOLD = 500


@dataclass
class MonitoringBackendStatus:
    configured: bool
    reachable: bool
    ready: Optional[bool]
    url: Optional[str]
    version: Optional[str]
    error: Optional[str]


@dataclass
class MonitoringInventoryHost:
    id: int
    name: str
    ipv4: Optional[str]


class MonitoringError(RuntimeError):
    pass


def _settings() -> tuple[BackendConnection, BackendConnection]:
    snapshot = get_monitoring_settings_snapshot()
    return snapshot.prometheus, snapshot.loki


def _prometheus_query(query: str) -> list[dict[str, Any]]:
    connection, _ = _settings()
    if not connection.enabled or not connection.url:
        return []
    try:
        payload = request_backend_json(connection, "/api/v1/query", {"query": query})
    except MonitoringSettingsError as exc:
        raise MonitoringError(str(exc)) from exc
    if payload.get("status") != "success":
        raise MonitoringError(f"Prometheus query failed: {payload}")
    data = payload.get("data", {})
    return data.get("result", []) if isinstance(data, dict) else []


def _prometheus_query_range(query: str, *, hours: int, step_seconds: int) -> list[dict[str, Any]]:
    connection, _ = _settings()
    if not connection.enabled or not connection.url:
        return []
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=max(1, hours))
    params = {
        "query": query,
        "start": f"{start.timestamp():.3f}",
        "end": f"{end.timestamp():.3f}",
        "step": str(max(60, min(step_seconds, 3600))),
    }
    try:
        payload = request_backend_json(connection, "/api/v1/query_range", params)
    except MonitoringSettingsError as exc:
        raise MonitoringError(str(exc)) from exc
    if payload.get("status") != "success":
        raise MonitoringError(f"Prometheus range query failed: {payload}")
    data = payload.get("data", {})
    return data.get("result", []) if isinstance(data, dict) else []


def _loki_query(query: str) -> list[dict[str, Any]]:
    _, connection = _settings()
    if not connection.enabled or not connection.url:
        return []
    try:
        payload = request_backend_json(connection, "/loki/api/v1/query", {"query": query})
    except MonitoringSettingsError as exc:
        raise MonitoringError(str(exc)) from exc
    if payload.get("status") != "success":
        raise MonitoringError(f"Loki query failed: {payload}")
    data = payload.get("data", {})
    return data.get("result", []) if isinstance(data, dict) else []


def _loki_query_range(query: str, *, limit: int) -> list[dict[str, Any]]:
    _, connection = _settings()
    if not connection.enabled or not connection.url:
        return []
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=6)
    params = {
        "query": query,
        "limit": max(1, min(limit, 200)),
        "direction": "backward",
        "start": str(int(start.timestamp() * 1_000_000_000)),
        "end": str(int(end.timestamp() * 1_000_000_000)),
    }
    try:
        payload = request_backend_json(connection, "/loki/api/v1/query_range", params)
    except MonitoringSettingsError as exc:
        raise MonitoringError(str(exc)) from exc
    if payload.get("status") != "success":
        raise MonitoringError(f"Loki range query failed: {payload}")
    data = payload.get("data", {})
    return data.get("result", []) if isinstance(data, dict) else []


def _sample_value(item: dict[str, Any]) -> Optional[float]:
    value = item.get("value")
    if not isinstance(value, list) or len(value) < 2:
        return None
    try:
        return float(value[1])
    except (TypeError, ValueError):
        return None


def _sample_name(metric: dict[str, Any]) -> str:
    return metric.get("nodename") or metric.get("instance") or metric.get("job") or "unknown"


def _normalize_instance(value: Optional[str]) -> str:
    if not value:
        return ""
    normalized = value.strip().lower()
    if ":" in normalized:
        normalized = normalized.split(":", 1)[0]
    return normalized


def _host_candidates(host: MonitoringInventoryHost) -> set[str]:
    candidates = {_normalize_instance(host.name)}
    if host.ipv4:
        candidates.add(_normalize_instance(host.ipv4))
    return {candidate for candidate in candidates if candidate}


def _metric_label_values(metric: dict[str, Any]) -> set[str]:
    return {
        _normalize_instance(metric.get("instance")),
        _normalize_instance(metric.get("nodename")),
        _normalize_instance(metric.get("hostname")),
    }


def _inventory_candidates(hosts: list[MonitoringInventoryHost] | None) -> set[str]:
    candidates: set[str] = set()
    for host in hosts or []:
        candidates.update(_host_candidates(host))
    return candidates


def _metric_matches_inventory(metric: dict[str, Any], inventory_hosts: list[MonitoringInventoryHost] | None) -> bool:
    if inventory_hosts is None:
        return True
    candidates = _inventory_candidates(inventory_hosts)
    if not candidates:
        return False
    values = _metric_label_values(metric)
    return any(value in candidates for value in values if value)


def _metric_matches_host(metric: dict[str, Any], host: MonitoringInventoryHost | None) -> bool:
    if host is None:
        return True
    candidates = _host_candidates(host)
    values = _metric_label_values(metric)
    return any(value in candidates for value in values if value)


def _history_step_seconds(hours: int) -> int:
    if hours <= 12:
        return 300
    if hours <= 48:
        return 900
    return 1800


def _matrix_points(item: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for sample in item.get("values", []):
        if not isinstance(sample, list) or len(sample) < 2:
            continue
        try:
            timestamp = datetime.fromtimestamp(float(sample[0]), tz=timezone.utc).isoformat()
            value = float(sample[1])
        except (TypeError, ValueError, OSError):
            continue
        rows.append({"timestamp": timestamp, "value": value})
    return rows


def _aggregate_history_series(
    results: list[dict[str, Any]],
    *,
    selected_host: MonitoringInventoryHost | None = None,
    inventory_hosts: list[MonitoringInventoryHost] | None = None,
) -> list[dict[str, Any]]:
    buckets: dict[str, list[float]] = {}
    for item in results:
        metric = item.get("metric", {})
        if selected_host is not None:
            if not _metric_matches_host(metric, selected_host):
                continue
        elif not _metric_matches_inventory(metric, inventory_hosts):
            continue
        for point in _matrix_points(item):
            buckets.setdefault(point["timestamp"], []).append(float(point["value"]))
    rows: list[dict[str, Any]] = []
    for timestamp in sorted(buckets):
        values = buckets[timestamp]
        if not values:
            continue
        rows.append(
            {
                "timestamp": timestamp,
                "value": sum(values) / len(values),
            }
        )
    return rows


def _log_stream_matches_host(labels: dict[str, Any], host: MonitoringInventoryHost | None) -> bool:
    if host is None:
        return True
    candidates = _host_candidates(host)
    values = {
        _normalize_instance(labels.get("instance")),
        _normalize_instance(labels.get("hostname")),
        _normalize_instance(labels.get("host")),
    }
    return any(value in candidates for value in values if value)


def get_prometheus_status() -> MonitoringBackendStatus:
    connection, _ = _settings()
    if not connection.enabled or not connection.url:
        return MonitoringBackendStatus(
            configured=False,
            reachable=False,
            ready=None,
            url=None,
            version=None,
            error="Prometheus URL is not configured",
        )
    try:
        payload = request_backend_json(connection, "/api/v1/status/buildinfo")
        version = payload.get("data", {}).get("version")
        ready = request_backend_status(connection, "/-/ready")
        return MonitoringBackendStatus(
            configured=True,
            reachable=True,
            ready=ready,
            url=connection.url,
            version=version,
            error=None,
        )
    except (MonitoringError, MonitoringSettingsError) as exc:
        return MonitoringBackendStatus(
            configured=True,
            reachable=False,
            ready=False,
            url=connection.url,
            version=None,
            error=str(exc),
        )


def get_loki_status() -> MonitoringBackendStatus:
    _, connection = _settings()
    if not connection.enabled or not connection.url:
        return MonitoringBackendStatus(
            configured=False,
            reachable=False,
            ready=None,
            url=None,
            version=None,
            error="Loki URL is not configured",
        )
    try:
        payload = request_backend_json(connection, "/loki/api/v1/status/buildinfo")
        version = payload.get("version")
        ready = request_backend_status(connection, "/ready")
        return MonitoringBackendStatus(
            configured=True,
            reachable=True,
            ready=ready,
            url=connection.url,
            version=version,
            error=None if ready else "Loki is reachable but reports not-ready",
        )
    except (MonitoringError, MonitoringSettingsError) as exc:
        return MonitoringBackendStatus(
            configured=True,
            reachable=False,
            ready=False,
            url=connection.url,
            version=None,
            error=str(exc),
        )


def get_prometheus_target_summary(
    selected_host: MonitoringInventoryHost | None = None,
    inventory_hosts: list[MonitoringInventoryHost] | None = None,
) -> tuple[dict[str, int | list[dict[str, Any]]], list[dict[str, Any]]]:
    results = _prometheus_query("up")
    total_targets = 0
    healthy_targets = 0
    jobs: dict[str, dict[str, int | str]] = {}
    hosts: dict[str, dict[str, Any]] = {}

    for item in results:
        metric = item.get("metric", {})
        if selected_host is not None:
            if not _metric_matches_host(metric, selected_host):
                continue
        elif not _metric_matches_inventory(metric, inventory_hosts):
            continue
        job = metric.get("job") or "unknown"
        up_value = (_sample_value(item) or 0.0) >= 1.0
        total_targets += 1
        if up_value:
            healthy_targets += 1
        job_summary = jobs.setdefault(
            job,
            {"job": job, "total_targets": 0, "healthy_targets": 0, "unhealthy_targets": 0},
        )
        job_summary["total_targets"] += 1
        if up_value:
            job_summary["healthy_targets"] += 1
        else:
            job_summary["unhealthy_targets"] += 1

        if job == "node_exporter_os":
            key = _sample_name(metric)
            hosts.setdefault(
                key,
                {
                    "name": key,
                    "instance": metric.get("instance") or key,
                    "up": up_value,
                    "cpu_usage_percent": None,
                    "memory_usage_percent": None,
                    "root_disk_usage_percent": None,
                },
            )["up"] = up_value

    for query, field_name in (
        (CPU_USAGE_QUERY, "cpu_usage_percent"),
        (MEMORY_USAGE_QUERY, "memory_usage_percent"),
        (ROOT_DISK_USAGE_QUERY, "root_disk_usage_percent"),
    ):
        try:
            metric_rows = _prometheus_query(query)
        except MonitoringError:
            logger.exception("Failed monitoring query for %s", field_name)
            continue
        for item in metric_rows:
            metric = item.get("metric", {})
            if selected_host is not None:
                if not _metric_matches_host(metric, selected_host):
                    continue
            elif not _metric_matches_inventory(metric, inventory_hosts):
                continue
            key = _sample_name(metric)
            host = hosts.setdefault(
                key,
                {
                    "name": key,
                    "instance": metric.get("instance") or key,
                    "up": True,
                    "cpu_usage_percent": None,
                    "memory_usage_percent": None,
                    "root_disk_usage_percent": None,
                },
            )
            host[field_name] = _sample_value(item)

    summary = {
        "total_targets": total_targets,
        "healthy_targets": healthy_targets,
        "unhealthy_targets": total_targets - healthy_targets,
        "jobs": sorted(jobs.values(), key=lambda item: str(item["job"])),
    }
    host_rows = sorted(hosts.values(), key=lambda item: str(item["name"]).lower())
    return summary, host_rows


def get_prometheus_history(
    *,
    selected_host: MonitoringInventoryHost | None = None,
    inventory_hosts: list[MonitoringInventoryHost] | None = None,
    hours: int = 24,
) -> dict[str, Any]:
    range_hours = max(1, min(hours, 168))
    step_seconds = _history_step_seconds(range_hours)
    query_specs: list[dict[str, Any]]
    if selected_host is None:
        query_specs = [
            {
                "key": "target_availability",
                "label": "Inventory Availability",
                "unit": "percent",
                "query": "100 * avg by (instance, job, nodename) (up)",
            },
            {
                "key": "cpu_usage_percent",
                "label": "Average CPU",
                "unit": "percent",
                "query": CPU_USAGE_QUERY,
            },
            {
                "key": "memory_usage_percent",
                "label": "Average Memory",
                "unit": "percent",
                "query": MEMORY_USAGE_QUERY,
            },
            {
                "key": "root_disk_usage_percent",
                "label": "Average Root Disk",
                "unit": "percent",
                "query": ROOT_DISK_USAGE_QUERY,
            },
        ]
    else:
        query_specs = [
            {
                "key": "target_availability",
                "label": "Host Availability",
                "unit": "percent",
                "query": "100 * avg by (instance, job, nodename) (up)",
            },
            {
                "key": "cpu_usage_percent",
                "label": "Host CPU",
                "unit": "percent",
                "query": CPU_USAGE_QUERY,
            },
            {
                "key": "memory_usage_percent",
                "label": "Host Memory",
                "unit": "percent",
                "query": MEMORY_USAGE_QUERY,
            },
            {
                "key": "root_disk_usage_percent",
                "label": "Root Disk",
                "unit": "percent",
                "query": ROOT_DISK_USAGE_QUERY,
            },
        ]

    series: list[dict[str, Any]] = []
    for spec in query_specs:
        try:
            results = _prometheus_query_range(
                spec["query"],
                hours=range_hours,
                step_seconds=step_seconds,
            )
        except MonitoringError:
            logger.exception("Failed Prometheus history query for %s", spec["key"])
            results = []
        points = _aggregate_history_series(
            results,
            selected_host=selected_host,
            inventory_hosts=inventory_hosts,
        )
        series.append(
            {
                "key": spec["key"],
                "label": spec["label"],
                "unit": spec["unit"],
                "points": points,
            }
        )

    return {
        "range_hours": range_hours,
        "step_seconds": step_seconds,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "series": series,
    }


def get_loki_log_volume(selected_host: MonitoringInventoryHost | None = None) -> list[dict[str, Any]]:
    results = _loki_query('sum by (service_name) (count_over_time({service_name=~".+"}[1h]))')
    if selected_host is not None:
        selector = _build_loki_selector(selected_host=selected_host)
        results = _loki_query(f"sum by (service_name) (count_over_time({selector}[1h]))")
    rows: list[dict[str, Any]] = []
    for item in results:
        metric = item.get("metric", {})
        rows.append(
            {
                "service_name": metric.get("service_name") or "unknown",
                "lines_last_hour": int(_sample_value(item) or 0),
            }
        )
    return sorted(rows, key=lambda item: (-item["lines_last_hour"], item["service_name"]))


def get_loki_error_volume(selected_host: MonitoringInventoryHost | None = None) -> list[dict[str, Any]]:
    selector = _build_loki_selector(selected_host=selected_host)
    query = f'sum by (service_name) (count_over_time({selector} | detected_level=~"error|fatal|critical" [1h]))'
    results = _loki_query(query)
    rows: list[dict[str, Any]] = []
    for item in results:
        metric = item.get("metric", {})
        rows.append(
            {
                "service_name": metric.get("service_name") or "unknown",
                "error_lines_last_hour": int(_sample_value(item) or 0),
            }
        )
    return sorted(rows, key=lambda item: (-item["error_lines_last_hour"], item["service_name"]))


def _build_loki_selector(
    *,
    service_name: Optional[str] = None,
    selected_host: MonitoringInventoryHost | None = None,
) -> str:
    matchers = ['service_name=~".+"']
    if service_name:
        escaped_service = service_name.replace("\\", "\\\\").replace('"', '\\"')
        matchers.append(f'service_name="{escaped_service}"')
    if selected_host is not None:
        candidates = sorted(_host_candidates(selected_host))
        if candidates:
            pattern = "|".join(candidate.replace("\\", "\\\\").replace(".", "\\.") for candidate in candidates)
            matchers.append(f'instance=~"{pattern}(:[0-9]+)?"')
    return "{" + ",".join(matchers) + "}"


def get_recent_logs(
    *,
    service_name: Optional[str] = None,
    selected_host: MonitoringInventoryHost | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    selector = _build_loki_selector(service_name=service_name, selected_host=selected_host)
    streams = _loki_query_range(selector, limit=limit)
    rows: list[dict[str, Any]] = []
    for stream in streams:
        labels = stream.get("stream", {})
        if not _log_stream_matches_host(labels, selected_host):
            continue
        for ts_ns, line in stream.get("values", []):
            try:
                ts = datetime.fromtimestamp(int(ts_ns) / 1_000_000_000, tz=timezone.utc).isoformat()
            except (TypeError, ValueError, OSError):
                ts = datetime.now(timezone.utc).isoformat()
            rows.append(
                {
                    "timestamp": ts,
                    "service_name": labels.get("service_name"),
                    "job": labels.get("job"),
                    "instance": labels.get("instance"),
                    "level": labels.get("detected_level"),
                    "line": line,
                }
            )
    rows.sort(key=lambda item: item["timestamp"], reverse=True)
    return rows[: max(1, min(limit, 200))]


def compute_host_health_score(host: dict[str, Any]) -> int:
    score = 100.0
    if not host.get("up", True):
        score -= 60

    cpu = host.get("cpu_usage_percent")
    memory = host.get("memory_usage_percent")
    disk = host.get("root_disk_usage_percent")

    if cpu is not None and cpu > HIGH_CPU_THRESHOLD:
        score -= min(20, (cpu - HIGH_CPU_THRESHOLD) * 0.8)
    if memory is not None and memory > HIGH_MEMORY_THRESHOLD:
        score -= min(20, (memory - HIGH_MEMORY_THRESHOLD) * 1.5)
    if disk is not None and disk > HIGH_DISK_THRESHOLD:
        score -= min(25, (disk - HIGH_DISK_THRESHOLD) * 2.0)

    return max(0, min(100, int(round(score))))


def add_health_scores(host_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for row in host_rows:
        row["health_score"] = compute_host_health_score(row)
    return host_rows


def build_monitoring_alerts(
    *,
    host_rows: list[dict[str, Any]],
    target_summary: dict[str, Any],
    log_volume: list[dict[str, Any]],
    error_volume: list[dict[str, Any]],
    selected_host: MonitoringInventoryHost | None = None,
) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []

    for host in host_rows:
        if not host.get("up", True):
            alerts.append(
                {
                    "id": f"host_down:{host['instance']}",
                    "alert_type": "host_down",
                    "severity": "critical",
                    "title": f"{host['name']} is down",
                    "description": "Prometheus reports the host target as down.",
                    "host_name": host["name"],
                    "service_name": None,
                    "metric_value": 0.0,
                    "threshold": 1.0,
                }
            )
        for field_name, threshold, alert_type, label, severity in (
            ("cpu_usage_percent", HIGH_CPU_THRESHOLD, "high_cpu", "CPU usage", "high"),
            ("memory_usage_percent", HIGH_MEMORY_THRESHOLD, "high_memory", "Memory usage", "high"),
            ("root_disk_usage_percent", HIGH_DISK_THRESHOLD, "high_disk", "Root disk usage", "critical"),
        ):
            value = host.get(field_name)
            if value is None or value <= threshold:
                continue
            alerts.append(
                {
                    "id": f"{alert_type}:{host['instance']}",
                    "alert_type": alert_type,
                    "severity": severity,
                    "title": f"{host['name']} {label.lower()} is elevated",
                    "description": f"{label} is {value:.1f}% on {host['name']}.",
                    "host_name": host["name"],
                    "service_name": None,
                    "metric_value": float(value),
                    "threshold": float(threshold),
                }
            )

    for job in target_summary.get("jobs", []):
        if int(job.get("unhealthy_targets", 0)) <= 0:
            continue
        alerts.append(
            {
                "id": f"job_unhealthy:{job['job']}",
                "alert_type": "job_unhealthy",
                "severity": "high",
                "title": f"Prometheus job {job['job']} has unhealthy targets",
                "description": f"{job['unhealthy_targets']} of {job['total_targets']} targets are unhealthy.",
                "host_name": selected_host.name if selected_host else None,
                "service_name": str(job["job"]),
                "metric_value": float(job["unhealthy_targets"]),
                "threshold": 0.0,
            }
        )

    for item in error_volume:
        error_lines = int(item.get("error_lines_last_hour", 0))
        if error_lines < SERVICE_ERROR_LINES_THRESHOLD:
            continue
        alerts.append(
            {
                "id": f"service_errors:{item['service_name']}",
                "alert_type": "service_errors",
                "severity": "high",
                "title": f"{item['service_name']} is error-heavy",
                "description": f"{error_lines} error-level log lines in the last hour.",
                "host_name": selected_host.name if selected_host else None,
                "service_name": item["service_name"],
                "metric_value": float(error_lines),
                "threshold": float(SERVICE_ERROR_LINES_THRESHOLD),
            }
        )

    for item in log_volume:
        lines = int(item.get("lines_last_hour", 0))
        if lines < SERVICE_VOLUME_LINES_THRESHOLD:
            continue
        alerts.append(
            {
                "id": f"service_volume:{item['service_name']}",
                "alert_type": "service_volume",
                "severity": "medium",
                "title": f"{item['service_name']} is noisy",
                "description": f"{lines} log lines in the last hour.",
                "host_name": selected_host.name if selected_host else None,
                "service_name": item["service_name"],
                "metric_value": float(lines),
                "threshold": float(SERVICE_VOLUME_LINES_THRESHOLD),
            }
        )

    severity_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    alerts.sort(key=lambda item: (severity_rank.get(str(item["severity"]), 99), str(item["title"]).lower()))
    return alerts
