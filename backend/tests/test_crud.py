"""Tests for CRUD endpoints — role-based access and basic happy paths."""


# ── Environments ──────────────────────────────────────────────────────────────

def test_readonly_can_list_environments(client, readonly_token):
    r = client.get("/api/environments/", headers={"Authorization": f"Bearer {readonly_token}"})
    assert r.status_code == 200
    assert "items" in r.json()


def test_readonly_cannot_create_environment(client, readonly_token):
    r = client.post(
        "/api/environments/",
        json={"name": "shouldfail"},
        headers={"Authorization": f"Bearer {readonly_token}"},
    )
    assert r.status_code == 403


def test_admin_can_create_update_delete_environment(client, admin_token):
    # Create
    r = client.post(
        "/api/environments/",
        json={"name": "test-env"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 201
    env = r.json()
    assert env["name"] == "test-env"
    eid = env["id"]

    # Read back
    r2 = client.get(f"/api/environments/{eid}", headers={"Authorization": f"Bearer {admin_token}"})
    assert r2.status_code == 200

    # Update
    r3 = client.patch(
        f"/api/environments/{eid}",
        json={"name": "test-env-updated"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r3.status_code == 200
    assert r3.json()["name"] == "test-env-updated"

    # Delete
    r4 = client.delete(
        f"/api/environments/{eid}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r4.status_code == 204


def test_get_nonexistent_returns_404(client, admin_token):
    r = client.get("/api/environments/99999", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 404


# ── Host types ────────────────────────────────────────────────────────────────

def test_admin_crud_host_type(client, admin_token):
    r = client.post(
        "/api/host-types/",
        json={"name": "test-type"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 201
    tid = r.json()["id"]

    client.delete(f"/api/host-types/{tid}", headers={"Authorization": f"Bearer {admin_token}"})


# ── VLANs ─────────────────────────────────────────────────────────────────────

def test_admin_crud_vlan(client, admin_token):
    r = client.post(
        "/api/vlans/",
        json={"vlan_id": 999, "subnet": "10.99.0.0/24", "description": "test vlan"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 201
    vid = r.json()["id"]

    r2 = client.patch(
        f"/api/vlans/{vid}",
        json={"description": "updated"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r2.status_code == 200

    client.delete(f"/api/vlans/{vid}", headers={"Authorization": f"Bearer {admin_token}"})


# ── Unauthenticated access blocked ────────────────────────────────────────────

def test_unauthenticated_blocked(client):
    for path in ["/api/environments/", "/api/hosts/", "/api/vlans/"]:
        r = client.get(path)
        assert r.status_code == 401, f"Expected 401 for {path}, got {r.status_code}"
