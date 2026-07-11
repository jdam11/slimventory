from unittest.mock import MagicMock, patch

import pytest

from app.models.notifications import NotificationChannel
from app.services import notifications
from app.services.field_encryption import encrypt_field_value


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_create_channel_does_not_leak_secret(client, db, admin_token):
    body = {
        "name": "ntfy-main",
        "type": "ntfy",
        "url": "https://ntfy.example/topic",
        "events": ["backup_failed"],
        "enabled": True,
        "secret": "supersecret-token",
    }
    r = client.post("/api/notification-channels/", json=body, headers=_auth(admin_token))
    assert r.status_code == 201
    data = r.json()
    assert data["has_secret"] is True
    assert "secret" not in data
    assert "secret_encrypted" not in data

    listed = client.get("/api/notification-channels/", headers=_auth(admin_token)).json()
    serialized = listed["items"][0]
    assert "supersecret-token" not in str(serialized)
    assert "secret_encrypted" not in serialized


def test_crud_is_admin_only(client, db, readonly_token):
    r = client.get("/api/notification-channels/", headers=_auth(readonly_token))
    assert r.status_code == 403
    r = client.post("/api/notification-channels/", json={}, headers=_auth(readonly_token))
    assert r.status_code == 403


def test_list_requires_auth(client, db):
    assert client.get("/api/notification-channels/").status_code == 401


def test_update_clears_and_sets_secret(client, db, admin_token):
    created = client.post(
        "/api/notification-channels/",
        json={"name": "c1", "type": "slack", "url": "https://hooks", "events": []},
        headers=_auth(admin_token),
    ).json()
    assert created["has_secret"] is False

    updated = client.patch(
        f"/api/notification-channels/{created['id']}",
        json={"secret": "abc"},
        headers=_auth(admin_token),
    ).json()
    assert updated["has_secret"] is True


def test_dispatch_only_subscribed_and_enabled(db):
    subscribed = NotificationChannel(
        name="sub", type="discord", url="https://d/1", events=["backup_failed"], enabled=True
    )
    unsubscribed = NotificationChannel(
        name="unsub", type="discord", url="https://d/2", events=["playbook_run_failed"], enabled=True
    )
    disabled = NotificationChannel(
        name="off", type="discord", url="https://d/3", events=["backup_failed"], enabled=False
    )
    db.add_all([subscribed, unsubscribed, disabled])
    db.commit()

    with patch.object(notifications.httpx, "post") as mock_post:
        mock_post.return_value = MagicMock(status_code=200, raise_for_status=lambda: None)
        notifications.dispatch(db, "backup_failed", "t", "b", {})

    assert mock_post.call_count == 1
    assert mock_post.call_args.args[0] == "https://d/1"


def test_dispatch_swallows_webhook_failure(db):
    ch = NotificationChannel(
        name="boom", type="generic_webhook", url="https://x", events=["backup_failed"], enabled=True
    )
    db.add(ch)
    db.commit()

    with patch.object(notifications.httpx, "post", side_effect=RuntimeError("boom")):
        notifications.dispatch(db, "backup_failed", "t", "b", {})  # must not raise


def test_build_request_includes_decrypted_secret(db):
    ch = NotificationChannel(
        name="g",
        type="generic_webhook",
        url="https://x",
        events=[],
        enabled=True,
        secret_encrypted=encrypt_field_value("tok123"),
    )
    json_body, data, headers = notifications._build_request(ch, "title", "body", "evt", {})
    assert headers["Authorization"] == "Bearer tok123"
    assert json_body["event"] == "evt"


@pytest.mark.parametrize("ctype", ["ntfy", "gotify", "discord", "slack", "generic_webhook"])
def test_build_request_all_types(db, ctype):
    ch = NotificationChannel(name=ctype, type=ctype, url="https://x", events=[], enabled=True)
    json_body, data, headers = notifications._build_request(ch, "title", "body", "evt", {})
    # ntfy posts a raw body; the rest send JSON
    if ctype == "ntfy":
        assert data == b"body"
    else:
        assert json_body is not None
