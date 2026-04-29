from apscheduler.triggers.cron import CronTrigger
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.crud import delete_record, get_or_404
from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.git import AnsiblePlaybook, PlaybookHostSource, PlaybookRun
from app.models.job_templates import JobTemplate, JobTemplatePreviewCache, JobTemplateSchedule
from app.schemas.git import PlaybookRunRead
from app.schemas.inventory import PageResponse
from app.schemas.job_templates import (
    JobTemplateCreate,
    JobTemplatePreviewRead,
    JobTemplateRead,
    JobTemplateScheduleCreate,
    JobTemplateScheduleRead,
    JobTemplateUpdate,
)
from app.services.job_template_preview import get_or_refresh_job_template_preview
from app.services.playbook_execution import create_playbook_run, launch_playbook_run
from app.services.scheduler import refresh_job_template_schedules

router = APIRouter(prefix="/job-templates", tags=["job-templates"])


@router.get("/", response_model=PageResponse[JobTemplateRead])
def list_job_templates(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    total = db.scalar(select(func.count()).select_from(JobTemplate)) or 0
    items = db.execute(select(JobTemplate).order_by(JobTemplate.name.asc()).offset(skip).limit(limit)).scalars().all()
    return {"items": list(items), "total": total}


@router.get("/{template_id}", response_model=JobTemplateRead)
def get_job_template(
    template_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    return get_or_404(db, JobTemplate, template_id)


@router.post("/", response_model=JobTemplateRead, status_code=status.HTTP_201_CREATED)
def create_job_template(
    body: JobTemplateCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    template = JobTemplate(**body.model_dump())
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


@router.patch("/{template_id}", response_model=JobTemplateRead)
def update_job_template(
    template_id: int,
    body: JobTemplateUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    template = get_or_404(db, JobTemplate, template_id)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(template, key, value)
    db.commit()
    db.refresh(template)
    return template


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job_template(
    template_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    cache = (
        db.query(JobTemplatePreviewCache).filter(JobTemplatePreviewCache.job_template_id == template_id).one_or_none()
    )
    if cache is not None:
        db.delete(cache)
        db.commit()
    delete_record(db, get_or_404(db, JobTemplate, template_id))
    refresh_job_template_schedules()


@router.post("/{template_id}/run", response_model=PlaybookRunRead, status_code=status.HTTP_202_ACCEPTED)
async def run_job_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_admin),
):
    template = get_or_404(db, JobTemplate, template_id)
    if template.playbook_id is None:
        raise HTTPException(status_code=409, detail="Template has no playbook configured")
    playbook = db.get(AnsiblePlaybook, template.playbook_id)
    if playbook is None:
        raise HTTPException(status_code=404, detail="Playbook not found")

    run = create_playbook_run(
        db,
        playbook_id=template.playbook_id,
        run_by_id=current_user.id,
        host_source=PlaybookHostSource.inventory,
        target_host_ids=None,
        inventory_filter_type=template.inventory_filter_type,
        inventory_filter_value=template.inventory_filter_value,
        extra_vars=template.extra_vars,
        job_template_id=template.id,
    )
    launch_playbook_run(run, playbook.repo_id, playbook.path)
    return run


@router.get("/{template_id}/runs", response_model=PageResponse[PlaybookRunRead])
def list_job_template_runs(
    template_id: int,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    q = select(PlaybookRun).where(PlaybookRun.job_template_id == template_id).order_by(PlaybookRun.created_at.desc())
    total = (
        db.scalar(select(func.count()).select_from(PlaybookRun).where(PlaybookRun.job_template_id == template_id)) or 0
    )
    items = db.execute(q.offset(skip).limit(limit)).scalars().all()
    return {"items": list(items), "total": total}


@router.get("/{template_id}/preview", response_model=JobTemplatePreviewRead)
def get_job_template_preview(
    template_id: int,
    refresh: bool = Query(default=False),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    try:
        return get_or_refresh_job_template_preview(db, template_id, force=refresh)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{template_id}/preview/refresh", response_model=JobTemplatePreviewRead)
def refresh_job_template_preview(
    template_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    try:
        return get_or_refresh_job_template_preview(db, template_id, force=True)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/{template_id}/schedule", response_model=JobTemplateScheduleRead | None)
def get_job_template_schedule(
    template_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    schedule = db.query(JobTemplateSchedule).filter(JobTemplateSchedule.job_template_id == template_id).one_or_none()
    return schedule


@router.put("/{template_id}/schedule", response_model=JobTemplateScheduleRead)
def upsert_job_template_schedule(
    template_id: int,
    body: JobTemplateScheduleCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    get_or_404(db, JobTemplate, template_id)
    try:
        CronTrigger.from_crontab(body.cron_expr, timezone="UTC")
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid cron expression: {exc}") from exc

    schedule = db.query(JobTemplateSchedule).filter(JobTemplateSchedule.job_template_id == template_id).one_or_none()
    if schedule is None:
        schedule = JobTemplateSchedule(job_template_id=template_id)
        db.add(schedule)
    schedule.cron_expr = body.cron_expr
    schedule.is_enabled = 1 if body.is_enabled else 0
    db.commit()
    db.refresh(schedule)
    refresh_job_template_schedules()
    db.refresh(schedule)
    return schedule


@router.delete("/{template_id}/schedule", status_code=status.HTTP_204_NO_CONTENT)
def delete_job_template_schedule(
    template_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    schedule = db.query(JobTemplateSchedule).filter(JobTemplateSchedule.job_template_id == template_id).one_or_none()
    if schedule is None:
        raise HTTPException(status_code=404, detail="job_template_schedules not found")
    db.delete(schedule)
    db.commit()
    refresh_job_template_schedules()
