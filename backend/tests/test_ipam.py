from datetime import datetime

from app.models.inventory import (
    Environment,
    Host,
    HostType,
    UnifiHostObservation,
    Vlan,
)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _seed(db) -> dict[str, int]:
    env = Environment(name="lab")
    htype = HostType(name="vm")
    vlan = Vlan(vlan_id=10, subnet="10.10.10.0/24", description="lab")
    unscoped = Vlan(vlan_id=20, subnet=None, description="dhcp-only")
    db.add_all([env, htype, vlan, unscoped])
    db.commit()
    db.refresh(env)
    db.refresh(htype)
    db.refresh(vlan)
    db.refresh(unscoped)

    hosts = [
        Host(id=301, environment_id=env.id, host_type_id=htype.id, name="a", vlan_id=vlan.id, ipv4="10.10.10.5"),
        Host(id=302, environment_id=env.id, host_type_id=htype.id, name="b", vlan_id=vlan.id, ipv4="10.10.10.6"),
        # duplicate of host b -> conflict
        Host(id=303, environment_id=env.id, host_type_id=htype.id, name="c", vlan_id=vlan.id, ipv4="10.10.10.6"),
        # out of subnet
        Host(id=304, environment_id=env.id, host_type_id=htype.id, name="d", vlan_id=vlan.id, ipv4="192.168.1.9"),
        # unparsed / dhcp placeholder
        Host(id=305, environment_id=env.id, host_type_id=htype.id, name="e", vlan_id=vlan.id, ipv4="dhcp"),
    ]
    db.add_all(hosts)
    db.commit()

    obs = UnifiHostObservation(
        host_id=301, observed_ipv4="10.10.10.99", last_seen_at=datetime.utcnow(), updated_at=datetime.utcnow()
    )
    db.add(obs)
    db.commit()
    return {"vlan_pk": vlan.id, "unscoped_pk": unscoped.id}


def test_summary_lists_each_vlan(client, db, admin_token):
    _seed(db)
    r = client.get("/api/ipam/", headers=_auth(admin_token))
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2
    scoped = next(v for v in body["items"] if v["vlan_id"] == 10)
    assert scoped["scoped"] is True
    assert scoped["total_usable"] == 254
    # 10.10.10.5 and 10.10.10.6 are unique in-subnet addresses
    assert scoped["allocated_count"] == 2
    assert scoped["free_count"] == 252
    assert scoped["conflict_count"] == 1
    assert scoped["host_count"] == 5

    unscoped = next(v for v in body["items"] if v["vlan_id"] == 20)
    assert unscoped["scoped"] is False
    assert unscoped["total_usable"] == 0


def test_detail_reports_conflicts_out_of_subnet_and_next_free(client, db, admin_token):
    seed = _seed(db)
    r = client.get(f"/api/ipam/{seed['vlan_pk']}", headers=_auth(admin_token))
    assert r.status_code == 200
    body = r.json()

    # both conflicting hosts occupy .6, so it appears twice in the used list
    assert [u["ip"] for u in body["used"]] == ["10.10.10.5", "10.10.10.6", "10.10.10.6"]
    assert len(body["conflicts"]) == 1
    assert body["conflicts"][0]["ip"] == "10.10.10.6"
    assert {h["host_id"] for h in body["conflicts"][0]["hosts"]} == {302, 303}
    assert {h["host_id"] for h in body["out_of_subnet"]} == {304}
    assert {h["host_id"] for h in body["unparsed"]} == {305}
    # first free usable address
    assert body["next_free_ip"] == "10.10.10.1"
    # UniFi observed IP differs from inventory IP for host 301
    assert {d["host_id"] for d in body["drift"]} == {301}


def test_detail_missing_vlan_returns_404(client, db, admin_token):
    _seed(db)
    r = client.get("/api/ipam/99999", headers=_auth(admin_token))
    assert r.status_code == 404


def test_unauthenticated_cannot_read_ipam(client, db):
    _seed(db)
    assert client.get("/api/ipam/").status_code == 401
