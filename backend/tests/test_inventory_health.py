from datetime import datetime, timedelta

from app.models.inventory import (
    App,
    Environment,
    Host,
    HostApp,
    HostRole,
    HostType,
    Role,
    Vlan,
)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _categories(body) -> set[str]:
    return {f["category"] for f in body["findings"]}


def test_clean_inventory_has_no_findings(client, db, admin_token):
    env = Environment(name="lab")
    htype = HostType(name="vm")
    vlan = Vlan(vlan_id=10, subnet="10.0.0.0/24")
    db.add_all([env, htype, vlan])
    db.commit()

    host = Host(id=401, environment_id=env.id, host_type_id=htype.id, name="h", vlan_id=vlan.id, ipv4="10.0.0.5")
    role = Role(name="web")
    app = App(name="nginx")
    db.add_all([host, role, app])
    db.commit()
    db.add_all([HostRole(host_id=host.id, role_id=role.id, priority=1), HostApp(host_id=host.id, app_id=app.id)])
    db.commit()

    r = client.get("/api/inventory-health/", headers=_auth(admin_token))
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 0
    assert body["findings"] == []


def test_flags_no_role_no_deployment_unused_role_and_empty_vlan(client, db, admin_token):
    env = Environment(name="lab")
    htype = HostType(name="vm")
    vlan = Vlan(vlan_id=10, subnet="10.0.0.0/24")
    empty_vlan = Vlan(vlan_id=20, subnet="10.0.20.0/24")
    db.add_all([env, htype, vlan, empty_vlan])
    db.commit()

    host = Host(id=402, environment_id=env.id, host_type_id=htype.id, name="lonely", vlan_id=vlan.id, ipv4="10.0.0.5")
    Role(name="unused")
    db.add_all([host, Role(name="unused"), App(name="undeployed")])
    db.commit()

    r = client.get("/api/inventory-health/", headers=_auth(admin_token))
    body = r.json()
    cats = _categories(body)
    assert "host_no_role" in cats
    assert "app_no_deployment" in cats
    assert "role_unused" in cats
    assert "vlan_no_hosts" in cats
    assert body["counts"]["warn"] >= 1  # host_no_role is a warning


def test_flags_duplicate_ip(client, db, admin_token):
    env = Environment(name="lab")
    htype = HostType(name="vm")
    vlan = Vlan(vlan_id=10, subnet="10.0.0.0/24")
    db.add_all([env, htype, vlan])
    db.commit()
    db.add_all(
        [
            Host(id=403, environment_id=env.id, host_type_id=htype.id, name="x", vlan_id=vlan.id, ipv4="10.0.0.9"),
            Host(id=404, environment_id=env.id, host_type_id=htype.id, name="y", vlan_id=vlan.id, ipv4="10.0.0.9"),
        ]
    )
    db.commit()

    body = client.get("/api/inventory-health/", headers=_auth(admin_token)).json()
    dup = [f for f in body["findings"] if f["category"] == "duplicate_ip"]
    assert len(dup) == 1
    assert dup[0]["entity_id"] == "10.0.0.9"


def test_flags_stale_proxmox_sync(client, db, admin_token):
    env = Environment(name="lab")
    htype = HostType(name="vm")
    vlan = Vlan(vlan_id=10, subnet="10.0.0.0/24")
    db.add_all([env, htype, vlan])
    db.commit()
    host = Host(
        id=405,
        environment_id=env.id,
        host_type_id=htype.id,
        name="stale",
        vlan_id=vlan.id,
        ipv4="10.0.0.5",
        last_synced_at=datetime.utcnow() - timedelta(days=30),
    )
    db.add_all([host, HostRole(host_id=405, role_id=1, priority=1)])
    db.add(Role(name="r"))
    db.commit()

    body = client.get("/api/inventory-health/", headers=_auth(admin_token)).json()
    assert "host_stale_proxmox" in _categories(body)


def test_readonly_can_read(client, db, readonly_token):
    assert client.get("/api/inventory-health/", headers=_auth(readonly_token)).status_code == 200


def test_unauthenticated_cannot_read(client, db):
    assert client.get("/api/inventory-health/").status_code == 401
