from datetime import datetime, timezone

from app.models.inventory import Environment, Host, HostType, UnifiSettings, Vlan
from app.services.field_encryption import encrypt_field_value
from app.services import unifi as unifi_service


def _auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_host(db, *, host_id: int, name: str, ipv4: str, mac: str) -> Host:
    environment = db.query(Environment).filter_by(name="lab").one_or_none()
    if environment is None:
        environment = Environment(name="lab")
        host_type = HostType(name="vm")
        vlan = Vlan(vlan_id=10, subnet="10.10.10.0/24", description="lab")
        db.add_all([environment, host_type, vlan])
        db.commit()
        db.refresh(environment)
        db.refresh(host_type)
        db.refresh(vlan)
    else:
        host_type = db.query(HostType).filter_by(name="vm").one()
        vlan = db.query(Vlan).filter_by(vlan_id=10).one()

    host = Host(
        id=host_id,
        environment_id=environment.id,
        host_type_id=host_type.id,
        name=name,
        vlan_id=vlan.id,
        ipv4=ipv4,
        mac=mac,
    )
    db.add(host)
    db.commit()
    db.refresh(host)
    return host


def _configure_unifi(db) -> None:
    row = db.query(UnifiSettings).one_or_none()
    if row is None:
        row = UnifiSettings(
            enabled=True,
            base_url="https://unifi.local",
            username="admin",
            encrypted_password=encrypt_field_value("super-secret"),
            site="default",
            verify_tls=False,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(row)
    else:
        row.enabled = True
        row.base_url = "https://unifi.local"
        row.username = "admin"
        row.encrypted_password = encrypt_field_value("super-secret")
        row.site = "default"
        row.verify_tls = False
        row.updated_at = datetime.now(timezone.utc)
    db.commit()


def test_admin_can_update_unifi_settings_and_password_is_masked(client, admin_token):
    resp = client.patch(
        "/api/unifi/settings",
        json={
            "enabled": True,
            "base_url": "https://unifi.local",
            "username": "admin",
            "password": "super-secret",
            "site": "default",
            "verify_tls": False,
        },
        headers=_auth_header(admin_token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is True
    assert body["has_password"] is True
    assert "password" not in body


def test_readonly_cannot_update_unifi_settings(client, readonly_token):
    resp = client.patch(
        "/api/unifi/settings",
        json={"enabled": False},
        headers=_auth_header(readonly_token),
    )
    assert resp.status_code == 403


def test_unifi_sync_updates_dhcp_effective_ip_and_port_forwards(client, db, admin_token, monkeypatch):
    dhcp_host = _create_host(db, host_id=101, name="node-dhcp", ipv4="DHCP", mac="AA:BB:CC:DD:EE:01")
    static_host = _create_host(db, host_id=102, name="node-static", ipv4="10.10.10.102", mac="AA:BB:CC:DD:EE:02")
    _configure_unifi(db)

    monkeypatch.setattr(
        unifi_service.UnifiClient,
        "list_networks",
        lambda self, site: [{"_id": "net-10", "name": "Servers", "vlan": 10, "ip_subnet": "10.10.10.0/24"}],
    )
    monkeypatch.setattr(
        unifi_service.UnifiClient,
        "list_clients",
        lambda self, site: [
            {"mac": dhcp_host.mac, "ip": "10.10.10.55", "network": "Servers", "last_seen": 1_717_171_717},
            {"mac": static_host.mac, "ip": "10.10.10.200", "network": "Servers", "last_seen": 1_717_171_718},
        ],
    )
    monkeypatch.setattr(
        unifi_service.UnifiClient,
        "list_port_forwards",
        lambda self, site: [
            {
                "name": "HTTPS",
                "proto": "tcp",
                "src_port": "443",
                "dst_port": "443",
                "fwd": "10.10.10.55",
                "enabled": True,
            },
            {
                "name": "SSH",
                "proto": "tcp",
                "src_port": "2222",
                "dst_port": "22",
                "fwd": "10.10.10.102",
                "enabled": True,
            },
        ],
    )

    resp = client.post("/api/unifi/sync", json={"trigger_source": "manual"}, headers=_auth_header(admin_token))
    assert resp.status_code == 202
    assert resp.json()["status"] == "success"

    dhcp_resp = client.get(f"/api/hosts/{dhcp_host.id}", headers=_auth_header(admin_token))
    assert dhcp_resp.status_code == 200
    dhcp_body = dhcp_resp.json()
    assert dhcp_body["name"] == "node-dhcp"
    assert dhcp_body["ipv4"] == "DHCP"
    assert dhcp_body["unifi_observed_ip"] == "10.10.10.55"
    assert dhcp_body["effective_ipv4"] == "10.10.10.55"
    assert dhcp_body["unifi_network_name"] == "Servers"
    assert dhcp_body["unifi_vlan_tag"] == 10
    assert dhcp_body["unifi_port_forward_count"] == 1
    assert dhcp_body["unifi_port_forwards"][0]["rule_name"] == "HTTPS"

    static_resp = client.get(f"/api/hosts/{static_host.id}", headers=_auth_header(admin_token))
    static_body = static_resp.json()
    assert static_body["unifi_observed_ip"] == "10.10.10.200"
    assert static_body["effective_ipv4"] == "10.10.10.102"
    assert static_body["unifi_port_forward_count"] == 1
    assert static_body["unifi_port_forwards"][0]["rule_name"] == "SSH"


def test_unifi_vlan_preview_and_import(client, db, admin_token, monkeypatch):
    _configure_unifi(db)
    monkeypatch.setattr(
        unifi_service.UnifiClient,
        "list_networks",
        lambda self, site: [
            {"_id": "net-10", "name": "Servers", "vlan": 10, "ip_subnet": "10.10.10.0/24", "purpose": "corporate"},
            {"_id": "net-20", "name": "IoT", "vlan": 20, "ip_subnet": "10.10.20.0/24", "purpose": "corporate"},
        ],
    )

    preview_resp = client.get("/api/unifi/vlans/preview", headers=_auth_header(admin_token))
    assert preview_resp.status_code == 200
    preview = preview_resp.json()
    assert len(preview) == 2
    assert preview[0]["vlan_tag"] == 10

    import_resp = client.post(
        "/api/unifi/vlans/import",
        json={"network_ids": ["net-20"]},
        headers=_auth_header(admin_token),
    )
    assert import_resp.status_code == 200
    body = import_resp.json()
    assert body["requested"] == 1
    assert body["created"] == 1
    assert body["updated"] == 0

    vlan = db.query(Vlan).filter_by(vlan_id=20).one()
    assert vlan.subnet == "10.10.20.0/24"
    assert vlan.description == "IoT (corporate)"
