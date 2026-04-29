from app.models.inventory import Environment, Host, HostType, Role, Vlan


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _seed(db) -> dict[str, list[int]]:
    env = Environment(name="lab")
    htype = HostType(name="vm")
    vlan = Vlan(vlan_id=10, subnet="10.10.10.0/24", description="lab")
    db.add_all([env, htype, vlan])
    db.commit()
    db.refresh(env)
    db.refresh(htype)
    db.refresh(vlan)

    host_a = Host(id=201, environment_id=env.id, host_type_id=htype.id, name="host-a", vlan_id=vlan.id, ipv4="10.10.10.201")
    host_b = Host(id=202, environment_id=env.id, host_type_id=htype.id, name="host-b", vlan_id=vlan.id, ipv4="10.10.10.202")
    role_web = Role(name="web")
    role_db = Role(name="db")
    db.add_all([host_a, host_b, role_web, role_db])
    db.commit()
    db.refresh(role_web)
    db.refresh(role_db)

    return {
        "host_ids": [host_a.id, host_b.id],
        "role_ids": [role_web.id, role_db.id],
    }


def test_matrix_returns_hosts_roles_and_empty_assignments(client, db, admin_token):
    seed = _seed(db)

    r = client.get("/api/role-matrix/", headers=_auth(admin_token))
    assert r.status_code == 200
    body = r.json()
    assert len(body["hosts"]) == 2
    assert len(body["roles"]) == 2
    assert body["assignments"] == []
    assert {h["id"] for h in body["hosts"]} == set(seed["host_ids"])
    assert {r["id"] for r in body["roles"]} == set(seed["role_ids"])


def test_toggle_adds_then_removes_assignment(client, db, admin_token):
    seed = _seed(db)
    host_id = seed["host_ids"][0]
    role_id = seed["role_ids"][0]

    r1 = client.post(
        "/api/role-matrix/toggle",
        json={"host_id": host_id, "role_id": role_id},
        headers=_auth(admin_token),
    )
    assert r1.status_code == 200
    assert r1.json() == {
        "host_id": host_id,
        "role_id": role_id,
        "action": "added",
        "priority": 1,
    }

    r_get = client.get("/api/role-matrix/", headers=_auth(admin_token))
    assignments = r_get.json()["assignments"]
    assert assignments == [{"host_id": host_id, "role_id": role_id, "priority": 1}]

    r2 = client.post(
        "/api/role-matrix/toggle",
        json={"host_id": host_id, "role_id": role_id},
        headers=_auth(admin_token),
    )
    assert r2.status_code == 200
    assert r2.json()["action"] == "removed"

    r_get2 = client.get("/api/role-matrix/", headers=_auth(admin_token))
    assert r_get2.json()["assignments"] == []


def test_toggle_auto_increments_priority(client, db, admin_token):
    seed = _seed(db)
    host_id = seed["host_ids"][0]
    role_web, role_db = seed["role_ids"]

    r1 = client.post(
        "/api/role-matrix/toggle",
        json={"host_id": host_id, "role_id": role_web},
        headers=_auth(admin_token),
    )
    assert r1.json()["priority"] == 1

    r2 = client.post(
        "/api/role-matrix/toggle",
        json={"host_id": host_id, "role_id": role_db},
        headers=_auth(admin_token),
    )
    assert r2.json()["priority"] == 2


def test_toggle_respects_explicit_priority(client, db, admin_token):
    seed = _seed(db)
    host_id = seed["host_ids"][0]
    role_id = seed["role_ids"][0]

    r = client.post(
        "/api/role-matrix/toggle",
        json={"host_id": host_id, "role_id": role_id, "priority": 50},
        headers=_auth(admin_token),
    )
    assert r.status_code == 200
    assert r.json()["priority"] == 50


def test_readonly_can_read_matrix_but_not_toggle(client, db, admin_token, readonly_token):
    _seed(db)

    r_read = client.get("/api/role-matrix/", headers=_auth(readonly_token))
    assert r_read.status_code == 200

    r_write = client.post(
        "/api/role-matrix/toggle",
        json={"host_id": 201, "role_id": 1},
        headers=_auth(readonly_token),
    )
    assert r_write.status_code == 403


def test_toggle_missing_host_or_role_returns_404(client, db, admin_token):
    seed = _seed(db)

    r_host = client.post(
        "/api/role-matrix/toggle",
        json={"host_id": 99999, "role_id": seed["role_ids"][0]},
        headers=_auth(admin_token),
    )
    assert r_host.status_code == 404

    r_role = client.post(
        "/api/role-matrix/toggle",
        json={"host_id": seed["host_ids"][0], "role_id": 99999},
        headers=_auth(admin_token),
    )
    assert r_role.status_code == 404


def test_unauthenticated_cannot_read_matrix(client, db):
    _seed(db)

    r = client.get("/api/role-matrix/")
    assert r.status_code == 401
