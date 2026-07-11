def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_write_request_creates_audit_row(client, db, admin_token):
    r = client.post("/api/environments", json={"name": "prod"}, headers=_auth(admin_token))
    assert r.status_code in (200, 201)

    page = client.get("/api/audit", headers=_auth(admin_token)).json()
    rows = [i for i in page["items"] if i["entity"] == "environments"]
    assert len(rows) == 1
    entry = rows[0]
    assert entry["action"] == "create"
    assert entry["method"] == "POST"
    assert entry["username"] == "testadmin"
    assert entry["status_code"] in (200, 201)


def test_failed_request_is_not_recorded(client, db, admin_token):
    r = client.post("/api/environments", json={}, headers=_auth(admin_token))
    assert r.status_code == 422

    page = client.get("/api/audit", headers=_auth(admin_token)).json()
    assert [i for i in page["items"] if i["entity"] == "environments"] == []


def test_filters_by_action(client, db, admin_token):
    created = client.post("/api/environments", json={"name": "stage"}, headers=_auth(admin_token)).json()
    client.patch(f"/api/environments/{created['id']}", json={"name": "staging"}, headers=_auth(admin_token))

    page = client.get("/api/audit", params={"action": "update"}, headers=_auth(admin_token)).json()
    assert page["total"] == 1
    assert page["items"][0]["action"] == "update"
    assert page["items"][0]["entity"] == "environments"
    assert page["items"][0]["entity_id"] == str(created["id"])


def test_audit_is_admin_only(client, db, readonly_token):
    r = client.get("/api/audit", headers=_auth(readonly_token))
    assert r.status_code == 403


def test_audit_requires_auth(client, db):
    r = client.get("/api/audit")
    assert r.status_code == 401
