from datetime import datetime, timezone

from app.models.inventory import (
    Environment,
    Host,
    HostType,
    ProxmoxPendingHost,
    ProxmoxSyncRun,
    Role,
    Vlan,
)


def _auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_admin_can_create_proxmox_credential_and_secret_is_masked(client, admin_token):
    payload = {
        "name": "lab-pve",
        "base_url": "https://pve.local:8006",
        "auth_type": "token",
        "token_id": "root@pam!api",
        "token_secret": "super-secret",
        "verify_tls": False,
        "is_active": True,
    }

    resp = client.post("/api/proxmox/credentials", json=payload, headers=_auth_header(admin_token))
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "lab-pve"
    assert data["has_secret"] is True
    assert "token_secret" not in data
    assert "password" not in data


def test_readonly_cannot_manage_schedule(client, readonly_token):
    resp = client.patch(
        "/api/proxmox/schedule",
        json={"enabled": True, "cron_expression": "0 * * * *", "timezone": "UTC"},
        headers=_auth_header(readonly_token),
    )
    assert resp.status_code == 403


def test_any_authenticated_user_can_trigger_sync(client, readonly_token, monkeypatch):
    fake_run = ProxmoxSyncRun(
        id=1,
        status="success",
        trigger_source="manual",
        message="ok",
        stats_json='{"hosts_created":1}',
        started_at=datetime.now(timezone.utc),
        completed_at=datetime.now(timezone.utc),
    )

    def fake_sync(_db, trigger_source="manual"):
        return fake_run

    import sys
    monkeypatch.setattr(sys.modules["app.routers.proxmox"], "run_proxmox_sync", fake_sync)

    resp = client.post(
        "/api/proxmox/sync",
        json={"trigger_source": "manual"},
        headers=_auth_header(readonly_token),
    )
    assert resp.status_code == 202
    assert resp.json()["status"] == "success"


def test_schedule_rejects_invalid_cron(client, admin_token):
    resp = client.patch(
        "/api/proxmox/schedule",
        json={"enabled": True, "cron_expression": "bad cron", "timezone": "UTC"},
        headers=_auth_header(admin_token),
    )
    assert resp.status_code == 400


def test_bulk_promote_pending_hosts_partial_success(client, db, admin_token):
    env = Environment(name="lab")
    host_type = HostType(name="vm")
    vlan = Vlan(vlan_id=10, subnet="10.0.10.0/24", description="lab")
    role = Role(name="app", description=None)
    db.add_all([env, host_type, vlan, role])
    db.commit()
    db.refresh(env)
    db.refresh(host_type)
    db.refresh(vlan)
    db.refresh(role)

    ok_pending = ProxmoxPendingHost(
        vmid=101,
        name="vm-101",
        vm_type="qemu",
        cpu_cores=2,
        ram_mb=2048,
        environment_id=env.id,
        host_type_id=host_type.id,
        vlan_id=vlan.id,
        role_id=role.id,
        ipv4="10.0.10.101",
        status="pending",
        created_at=datetime.now(timezone.utc),
    )
    bad_pending = ProxmoxPendingHost(
        vmid=102,
        name="vm-102",
        vm_type="qemu",
        cpu_cores=2,
        ram_mb=2048,
        environment_id=env.id,
        host_type_id=host_type.id,
        vlan_id=vlan.id,
        role_id=role.id,
        ipv4=None,
        status="pending",
        created_at=datetime.now(timezone.utc),
    )
    db.add_all([ok_pending, bad_pending])
    db.commit()
    db.refresh(ok_pending)
    db.refresh(bad_pending)

    resp = client.post(
        "/api/proxmox/pending/bulk-promote",
        json={"ids": [ok_pending.id, bad_pending.id]},
        headers=_auth_header(admin_token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["requested"] == 2
    assert body["succeeded"] == 1
    assert ok_pending.id in body["succeeded_ids"]
    assert len(body["errors"]) == 1
    assert body["errors"][0]["id"] == bad_pending.id

    promoted = db.get(Host, 101)
    assert promoted is not None


def test_bulk_dismiss_pending_hosts_partial_success(client, db, admin_token):
    pending = ProxmoxPendingHost(
        vmid=201,
        name="vm-201",
        vm_type="qemu",
        cpu_cores=1,
        ram_mb=1024,
        status="pending",
        created_at=datetime.now(timezone.utc),
    )
    db.add(pending)
    db.commit()
    db.refresh(pending)

    resp = client.post(
        "/api/proxmox/pending/bulk-dismiss",
        json={"ids": [pending.id, 999999]},
        headers=_auth_header(admin_token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["requested"] == 2
    assert body["succeeded"] == 1
    assert pending.id in body["succeeded_ids"]
    assert len(body["errors"]) == 1
    assert body["errors"][0]["id"] == 999999

    db.refresh(pending)
    assert pending.status == "dismissed"


def test_import_credentials_creates_inactive_credentials(client, admin_token):
    payload = {
        "items": [
            {"name": "pve1", "base_url": "https://pve1.example.local:8006"},
            {"name": "pve2", "base_url": "https://pve2.example.local:8006", "verify_tls": False},
        ]
    }
    resp = client.post(
        "/api/proxmox/credentials/import",
        json=payload,
        headers=_auth_header(admin_token),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["requested"] == 2
    assert body["created"] == 2
    assert body["skipped"] == 0
    assert body["errors"] == []

    # Verify credentials were created as inactive
    list_resp = client.get("/api/proxmox/credentials", headers=_auth_header(admin_token))
    items = list_resp.json()["items"]
    imported = {c["name"]: c for c in items if c["name"] in ("pve1", "pve2")}
    assert len(imported) == 2
    assert imported["pve1"]["is_active"] is False
    assert imported["pve1"]["has_secret"] is False
    assert imported["pve2"]["verify_tls"] is False


def test_import_credentials_skips_duplicates(client, admin_token):
    # Create one credential first
    payload = {"items": [{"name": "pve-dup", "base_url": "https://pve.example.local:8006"}]}
    resp = client.post(
        "/api/proxmox/credentials/import",
        json=payload,
        headers=_auth_header(admin_token),
    )
    assert resp.status_code == 201
    assert resp.json()["created"] == 1

    # Import again with same name + a new one
    payload = {
        "items": [
            {"name": "pve-dup", "base_url": "https://pve.example.local:8006"},
            {"name": "pve-new", "base_url": "https://pve-new.example.local:8006"},
        ]
    }
    resp = client.post(
        "/api/proxmox/credentials/import",
        json=payload,
        headers=_auth_header(admin_token),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["created"] == 1
    assert body["skipped"] == 1


def test_import_credentials_readonly_forbidden(client, readonly_token):
    payload = {"items": [{"name": "pve1", "base_url": "https://pve1.example.local:8006"}]}
    resp = client.post(
        "/api/proxmox/credentials/import",
        json=payload,
        headers=_auth_header(readonly_token),
    )
    assert resp.status_code == 403


def test_import_credentials_rejects_empty_items(client, admin_token):
    resp = client.post(
        "/api/proxmox/credentials/import",
        json={"items": []},
        headers=_auth_header(admin_token),
    )
    assert resp.status_code == 422


def test_create_inactive_credential_without_auth(client, admin_token):
    """Inactive credentials can be created without auth fields."""
    payload = {
        "name": "pve-no-auth",
        "base_url": "https://pve.local:8006",
        "auth_type": "token",
        "verify_tls": False,
        "is_active": False,
    }
    resp = client.post(
        "/api/proxmox/credentials",
        json=payload,
        headers=_auth_header(admin_token),
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["is_active"] is False
    assert data["has_secret"] is False


def test_cannot_activate_credential_without_auth(client, admin_token):
    """Activating a credential without auth fields should fail."""
    # Create inactive first
    payload = {
        "name": "pve-activate-test",
        "base_url": "https://pve.local:8006",
        "auth_type": "token",
        "verify_tls": False,
        "is_active": False,
    }
    resp = client.post(
        "/api/proxmox/credentials",
        json=payload,
        headers=_auth_header(admin_token),
    )
    assert resp.status_code == 201
    cred_id = resp.json()["id"]

    # Try to activate without providing auth
    resp = client.patch(
        f"/api/proxmox/credentials/{cred_id}",
        json={"is_active": True},
        headers=_auth_header(admin_token),
    )
    assert resp.status_code == 400
