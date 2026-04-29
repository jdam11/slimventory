from app.models.inventory import App, HostApp, HostStatus
from app.services.proxmox import _parse_vm_tags, _sync_host_apps_from_tags, _get_or_create_host_status


def test_parse_vm_tags_extracts_status_and_apps() -> None:
    status, apps = _parse_vm_tags("status:running;app:nginx;app:redis")
    assert status == "running"
    assert apps == ["nginx", "redis"]


def test_parse_vm_tags_supports_underscore_prefixes() -> None:
    status, apps = _parse_vm_tags("status_maintenance;app_grafana;app_prometheus")
    assert status == "maintenance"
    assert apps == ["grafana", "prometheus"]


def test_sync_host_apps_from_tags_reconciles_assignments(db) -> None:
    app_old = App(name="old-app", description=None)
    app_keep = App(name="keep-app", description=None)
    db.add_all([app_old, app_keep])
    db.flush()

    db.add_all([
        HostApp(host_id=123, app_id=app_old.id),
        HostApp(host_id=123, app_id=app_keep.id),
    ])
    db.commit()

    _sync_host_apps_from_tags(db, 123, ["keep-app", "new-app"])
    db.commit()

    app_names = [
        app.name
        for app in db.query(App)
        .join(HostApp, HostApp.app_id == App.id)
        .filter(HostApp.host_id == 123)
        .order_by(App.name.asc())
        .all()
    ]
    assert app_names == ["keep-app", "new-app"]


def test_get_or_create_host_status_is_idempotent(db) -> None:
    first_id = _get_or_create_host_status(db, "running")
    second_id = _get_or_create_host_status(db, "running")
    db.commit()

    assert first_id == second_id
    assert db.query(HostStatus).filter(HostStatus.name == "running").count() == 1
