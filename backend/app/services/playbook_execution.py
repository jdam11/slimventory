from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.auth import AppUser, UserRole
from app.models.git import GitRepo, PlaybookHostSource, PlaybookRun, PlaybookRunStatus
from app.models.job_templates import InventoryFilterType, VaultCredential
from app.services import ansible_runner as runner_svc
from app.services.ansible_runner_settings import get_or_create_ansible_runner_settings
from app.services.field_encryption import decrypt_field_value
from app.services.git_service import get_repo_path, sync_repo
from app.services.inventory_builder import build_inventory_ini, normalize_inventory_filters_for_template
from app.services.monitoring_settings import MonitoringSettingsError, resolve_runtime_secret_handoff

log = logging.getLogger(__name__)


def create_playbook_run(
    db: Session,
    *,
    playbook_id: int,
    run_by_id: int,
    host_source: PlaybookHostSource,
    target_host_ids: Optional[list[int]],
    inventory_filter_type: Optional[InventoryFilterType],
    inventory_filter_value: Any,
    extra_vars: Optional[dict[str, Any]],
    job_template_id: Optional[int] = None,
) -> PlaybookRun:
    run = PlaybookRun(
        playbook_id=playbook_id,
        run_by_id=run_by_id,
        host_source=host_source,
        target_host_ids=target_host_ids,
        inventory_filter_type=inventory_filter_type,
        inventory_filter_value=inventory_filter_value,
        extra_vars=extra_vars,
        job_template_id=job_template_id,
        status=PlaybookRunStatus.pending,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def launch_playbook_run(run: PlaybookRun, repo_id: int, playbook_path: str) -> None:
    asyncio.create_task(execute_run(run.id, repo_id, playbook_path))


async def execute_run(run_id: int, repo_id: int, playbook_path: str) -> None:
    try:
        with SessionLocal() as db:
            run = db.get(PlaybookRun, run_id)
            if run is None:
                return
            repo = db.get(GitRepo, repo_id)
            if repo is None:
                run.status = PlaybookRunStatus.failed
                run.output = "Repository not found."
                run.finished_at = datetime.now(timezone.utc)
                db.commit()
                return

            host_source = run.host_source
            target_host_ids = run.target_host_ids
            inventory_filter_type = run.inventory_filter_type
            inventory_filter_value = run.inventory_filter_value
            extra_vars = run.extra_vars
            template_inventory_filters = None
            runner_env_vars: dict[str, str] = {}
            kerberos_config = None
            kerberos_ccache_name = None
            vault_password = None
            template_vault_password = None
            if run.job_template_id:
                from app.models.job_templates import JobTemplate

                template = db.get(JobTemplate, run.job_template_id)
                if template and template.vault_credential_id:
                    credential = db.get(VaultCredential, template.vault_credential_id)
                    template_vault_password = decrypt_field_value(credential.vault_password) if credential else None
                    if template_vault_password:
                        vault_password = template_vault_password
                if template:
                    template_inventory_filters = normalize_inventory_filters_for_template(
                        template.inventory_filter_type,
                        template.inventory_filter_value,
                        template.inventory_filters,
                    )
            try:
                runtime_handoff = resolve_runtime_secret_handoff(db, job_template_id=run.job_template_id)
            except MonitoringSettingsError as exc:
                run.status = PlaybookRunStatus.failed
                run.output = f"Failed to resolve runtime secrets: {exc}"
                run.finished_at = datetime.now(timezone.utc)
                db.commit()
                return
            if runtime_handoff.extra_vars:
                extra_vars = {**(extra_vars or {}), **runtime_handoff.extra_vars}
            if runtime_handoff.vault_password:
                if template_vault_password and template_vault_password != runtime_handoff.vault_password:
                    run.status = PlaybookRunStatus.failed
                    run.output = (
                        "Both vault credential and Bitwarden/Vaultwarden secret mappings "
                        "produced different vault passwords."
                    )
                    run.finished_at = datetime.now(timezone.utc)
                    db.commit()
                    return
                if not vault_password:
                    vault_password = runtime_handoff.vault_password

            runner_settings = get_or_create_ansible_runner_settings(db)
            if runner_settings.kerberos_enabled:
                kerberos_config = runner_settings.kerberos_krb5_conf
                kerberos_ccache_name = runner_settings.kerberos_ccache_name
                if kerberos_ccache_name:
                    runner_env_vars["KRB5CCNAME"] = kerberos_ccache_name

            if run.job_template_id:
                sync_repo(db, repo_id)

        repo_path = str(get_repo_path(repo_id))

        if host_source == PlaybookHostSource.repo:
            inventory_type = "file"
            inventory = None
        else:
            effective_filter_type = inventory_filter_type or (
                InventoryFilterType.hosts if target_host_ids else InventoryFilterType.all
            )
            effective_filter_value = inventory_filter_value if inventory_filter_type else target_host_ids
            with SessionLocal() as db:
                inventory = build_inventory_ini(
                    db,
                    effective_filter_type,
                    effective_filter_value,
                    template_inventory_filters,
                )
            inventory_type = "string"

        with SessionLocal() as db:
            run = db.get(PlaybookRun, run_id)
            if run is None:
                return
            run.status = PlaybookRunStatus.running
            run.started_at = datetime.now(timezone.utc)
            db.commit()

        sidecar_job_id = await runner_svc.trigger_run(
            repo_path=repo_path,
            playbook_path=playbook_path,
            inventory_type=inventory_type,
            inventory=inventory,
            extra_vars=extra_vars,
            env_vars=runner_env_vars or None,
            kerberos_config=kerberos_config,
            kerberos_ccache_name=kerberos_ccache_name,
            vault_password=vault_password,
        )
    except Exception as exc:
        log.exception("Failed to prepare or trigger playbook run %d", run_id)
        with SessionLocal() as db:
            run = db.get(PlaybookRun, run_id)
            if run:
                run.status = PlaybookRunStatus.failed
                existing_output = f"{run.output}\n" if run.output else ""
                run.output = f"{existing_output}Failed to start: {exc}"
                run.finished_at = datetime.now(timezone.utc)
                db.commit()
        return

    with SessionLocal() as db:
        run = db.get(PlaybookRun, run_id)
        if run:
            run.sidecar_job_id = sidecar_job_id
            db.commit()

    log.info("run_id=%d sidecar_job_id=%s started", run_id, sidecar_job_id)

    async for event in runner_svc.stream_output(sidecar_job_id):
        if event["type"] == "chunk":
            with SessionLocal() as db:
                run = db.get(PlaybookRun, run_id)
                if run:
                    run.output = (run.output or "") + event["text"]
                    db.commit()

        elif event["type"] == "done":
            exit_code = event.get("exit_code")
            final_status = PlaybookRunStatus.success if exit_code == 0 else PlaybookRunStatus.failed
            with SessionLocal() as db:
                run = db.get(PlaybookRun, run_id)
                if run:
                    run.status = final_status
                    run.exit_code = exit_code
                    run.finished_at = datetime.now(timezone.utc)
                    db.commit()
            log.info("run_id=%d finished status=%s exit_code=%s", run_id, final_status, exit_code)
            return

        elif event["type"] == "error":
            log.warning("run_id=%d sidecar error: %s", run_id, event.get("message"))


def execute_run_sync(run_id: int, repo_id: int, playbook_path: str) -> None:
    asyncio.run(execute_run(run_id, repo_id, playbook_path))


def get_default_scheduler_user_id(db: Session) -> int:
    user = db.execute(
        select(AppUser).where(AppUser.role == UserRole.admin).order_by(AppUser.id.asc())
    ).scalar_one_or_none()
    if user is None:
        raise RuntimeError("No admin user exists to own scheduled playbook runs")
    return user.id
