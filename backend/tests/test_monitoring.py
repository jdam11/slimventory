from app.models.inventory import Environment, Host, HostRole, HostType, Role, Vlan
from app.services import monitoring as monitoring_service
from app.services.monitoring import MonitoringBackendStatus, MonitoringInventoryHost


def _auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_host(db) -> Host:
    environment = Environment(name="lab")
    host_type = HostType(name="vm")
    vlan = Vlan(vlan_id=10, subnet="10.10.10.0/24")
    role = Role(name="monitoring")
    db.add_all([environment, host_type, vlan, role])
    db.commit()
    db.refresh(environment)
    db.refresh(host_type)
    db.refresh(vlan)
    db.refresh(role)

    host = Host(
        id=101,
        environment_id=environment.id,
        host_type_id=host_type.id,
        name="node1",
        vlan_id=vlan.id,
        ipv4="10.10.10.11",
    )
    db.add(host)
    db.flush()
    db.add(HostRole(host_id=host.id, role_id=role.id, priority=100))
    db.commit()
    db.refresh(host)
    return host


def test_monitoring_history_returns_host_series(client, db, admin_token, monkeypatch):
    host = _create_host(db)

    import sys

    monitoring_router = sys.modules["app.routers.monitoring"]

    def fake_prometheus_status():
        return MonitoringBackendStatus(
            configured=True,
            reachable=True,
            ready=True,
            url="http://prometheus.local",
            version="2.54.0",
            error=None,
        )

    def fake_prometheus_history(*, selected_host=None, hours=24, inventory_hosts=None):
        assert selected_host is not None
        assert selected_host.id == host.id
        assert hours == 12
        return {
            "range_hours": 12,
            "step_seconds": 300,
            "generated_at": "2026-04-05T12:00:00+00:00",
            "series": [
                {
                    "key": "cpu_usage_percent",
                    "label": "Host CPU",
                    "unit": "percent",
                    "points": [
                        {"timestamp": "2026-04-05T10:00:00+00:00", "value": 22.5},
                        {"timestamp": "2026-04-05T11:00:00+00:00", "value": 37.0},
                    ],
                }
            ],
        }

    monkeypatch.setattr(monitoring_router, "get_prometheus_status", fake_prometheus_status)
    monkeypatch.setattr(monitoring_router, "get_prometheus_history", fake_prometheus_history)

    resp = client.get(
        "/api/monitoring/history",
        params={"host_id": host.id, "hours": 12},
        headers=_auth_header(admin_token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["prometheus"]["reachable"] is True
    assert body["selected_host"]["id"] == host.id
    assert body["range_hours"] == 12
    assert body["step_seconds"] == 300
    assert body["series"][0]["key"] == "cpu_usage_percent"
    assert body["series"][0]["points"][-1]["value"] == 37.0


def test_prometheus_summary_filters_to_inventory_hosts(monkeypatch):
    inventory_hosts = [
        MonitoringInventoryHost(id=101, name="node1", ipv4="10.10.10.11"),
    ]

    def fake_prometheus_query(query: str):
        if query == "up":
            return [
                {"metric": {"instance": "10.10.10.11:9100", "nodename": "node1", "job": "node_exporter_os"}, "value": [0, "1"]},
                {"metric": {"instance": "192.168.50.50:9100", "nodename": "rogue-host", "job": "node_exporter_os"}, "value": [0, "1"]},
            ]
        if "node_cpu_seconds_total" in query:
            return [
                {"metric": {"instance": "10.10.10.11:9100", "nodename": "node1"}, "value": [0, "34.2"]},
                {"metric": {"instance": "192.168.50.50:9100", "nodename": "rogue-host"}, "value": [0, "77.7"]},
            ]
        if "node_memory_MemAvailable_bytes" in query:
            return [
                {"metric": {"instance": "10.10.10.11:9100", "nodename": "node1"}, "value": [0, "52.0"]},
                {"metric": {"instance": "192.168.50.50:9100", "nodename": "rogue-host"}, "value": [0, "88.8"]},
            ]
        if "node_filesystem_avail_bytes" in query:
            return [
                {"metric": {"instance": "10.10.10.11:9100", "nodename": "node1"}, "value": [0, "61.5"]},
                {"metric": {"instance": "192.168.50.50:9100", "nodename": "rogue-host"}, "value": [0, "93.3"]},
            ]
        raise AssertionError(f"Unexpected query: {query}")

    monkeypatch.setattr(monitoring_service, "_prometheus_query", fake_prometheus_query)

    summary, hosts = monitoring_service.get_prometheus_target_summary(inventory_hosts=inventory_hosts)

    assert summary["total_targets"] == 1
    assert summary["healthy_targets"] == 1
    assert summary["unhealthy_targets"] == 0
    assert len(summary["jobs"]) == 1
    assert summary["jobs"][0]["job"] == "node_exporter_os"
    assert len(hosts) == 1
    assert hosts[0]["name"] == "node1"
    assert hosts[0]["cpu_usage_percent"] == 34.2
    assert hosts[0]["memory_usage_percent"] == 52.0
    assert hosts[0]["root_disk_usage_percent"] == 61.5
