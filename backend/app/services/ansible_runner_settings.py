from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.ansible import AnsibleRunnerSettings


def get_or_create_ansible_runner_settings(db: Session) -> AnsibleRunnerSettings:
    item = db.execute(select(AnsibleRunnerSettings).order_by(AnsibleRunnerSettings.id.asc())).scalars().first()
    if item is None:
        item = AnsibleRunnerSettings()
        db.add(item)
        db.commit()
        db.refresh(item)
    return item


def update_ansible_runner_settings(
    db: Session,
    *,
    kerberos_enabled: bool | None = None,
    kerberos_krb5_conf: str | None = None,
    kerberos_ccache_name: str | None = None,
) -> AnsibleRunnerSettings:
    item = get_or_create_ansible_runner_settings(db)
    if kerberos_enabled is not None:
        item.kerberos_enabled = kerberos_enabled
    if kerberos_krb5_conf is not None:
        text = kerberos_krb5_conf.strip()
        item.kerberos_krb5_conf = text or None
    if kerberos_ccache_name is not None:
        text = kerberos_ccache_name.strip()
        item.kerberos_ccache_name = text or None
    db.add(item)
    db.commit()
    db.refresh(item)
    return item
