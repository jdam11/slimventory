from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Callable, Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.git import AnsiblePlaybook, PlaybookHostSource
from app.models.job_templates import JobTemplate, JobTemplateSchedule
from app.services.playbook_execution import create_playbook_run, execute_run_sync, get_default_scheduler_user_id

log = logging.getLogger(__name__)

_scheduler_refresh_callback: Optional[Callable[[], None]] = None
_scheduler: Optional[BackgroundScheduler] = None


def _job_id(template_id: int) -> str:
    return f"job-template:{template_id}"


def set_job_template_scheduler(scheduler: BackgroundScheduler) -> None:
    global _scheduler
    _scheduler = scheduler


def set_job_template_scheduler_refresh(callback: Callable[[], None]) -> None:
    global _scheduler_refresh_callback
    _scheduler_refresh_callback = callback


def refresh_job_template_schedules() -> None:
    if _scheduler_refresh_callback:
        _scheduler_refresh_callback()


def _run_template_job(template_id: int) -> None:
    with SessionLocal() as db:
        template = db.get(JobTemplate, template_id)
        if template is None or template.playbook_id is None:
            return
        playbook = db.get(AnsiblePlaybook, template.playbook_id)
        schedule = (
            db.query(JobTemplateSchedule).filter(JobTemplateSchedule.job_template_id == template_id).one_or_none()
        )
        if playbook is None or schedule is None:
            return

        run = create_playbook_run(
            db,
            playbook_id=template.playbook_id,
            run_by_id=get_default_scheduler_user_id(db),
            host_source=PlaybookHostSource.inventory,
            target_host_ids=None,
            inventory_filter_type=template.inventory_filter_type,
            inventory_filter_value=template.inventory_filter_value,
            extra_vars=template.extra_vars,
            job_template_id=template.id,
        )
        schedule.last_run_at = datetime.now(timezone.utc)
        db.commit()

    execute_run_sync(run.id, playbook.repo_id, playbook.path)


def load_all_schedules(db: Session) -> None:
    if _scheduler is None:
        return

    for job in list(_scheduler.get_jobs()):
        if job.id.startswith("job-template:"):
            _scheduler.remove_job(job.id)

    schedules = db.query(JobTemplateSchedule).all()
    for schedule in schedules:
        if not schedule.is_enabled:
            continue
        try:
            trigger = CronTrigger.from_crontab(schedule.cron_expr, timezone="UTC")
            job = _scheduler.add_job(
                _run_template_job,
                trigger=trigger,
                id=_job_id(schedule.job_template_id),
                replace_existing=True,
                args=[schedule.job_template_id],
            )
            schedule.next_run_at = job.next_run_time
        except Exception as exc:
            log.warning("Failed to load job template schedule %s: %s", schedule.job_template_id, exc)
    db.commit()
