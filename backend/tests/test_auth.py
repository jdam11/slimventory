"""Tests for authentication endpoints and role enforcement."""


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_login_success(client, admin_user):
    r = client.post("/api/auth/login", json={"username": "testadmin", "password": "adminpass"})
    assert r.status_code == 200
    body = r.json()
    assert "access_token" in body
    assert body["role"] == "admin"
    assert body["username"] == "testadmin"


def test_login_wrong_password(client, admin_user):
    r = client.post("/api/auth/login", json={"username": "testadmin", "password": "wrongpass"})
    assert r.status_code == 401


def test_login_unknown_user(client):
    r = client.post("/api/auth/login", json={"username": "nobody", "password": "x"})
    assert r.status_code == 401


def test_me_authenticated(client, admin_token):
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    assert r.json()["username"] == "testadmin"


def test_me_unauthenticated(client):
    r = client.get("/api/auth/me")
    assert r.status_code == 401


def test_change_password(client, admin_token):
    r = client.post(
        "/api/auth/change-password",
        json={"old_password": "adminpass", "new_password": "NewAdmin1"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 204

    # Can still login with new password; reset to original for other tests
    r2 = client.post("/api/auth/login", json={"username": "testadmin", "password": "NewAdmin1"})
    assert r2.status_code == 200
    new_token = r2.json()["access_token"]

    # Reset password back
    client.post(
        "/api/auth/change-password",
        json={"old_password": "NewAdmin1", "new_password": "Adminpass1"},
        headers={"Authorization": f"Bearer {new_token}"},
    )


def test_readonly_cannot_manage_users(client, readonly_token):
    r = client.post(
        "/api/auth/users",
        json={"username": "newuser", "password": "Password123", "role": "readonly"},
        headers={"Authorization": f"Bearer {readonly_token}"},
    )
    assert r.status_code == 403


def test_admin_can_create_and_delete_user(client, admin_token, db):
    r = client.post(
        "/api/auth/users",
        json={"username": "tempuser", "password": "Temppass1", "role": "readonly"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 201
    uid = r.json()["id"]

    r2 = client.delete(
        f"/api/auth/users/{uid}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r2.status_code == 204
