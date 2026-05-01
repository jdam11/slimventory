"""Playbook runs router.

Endpoints:
  POST   /playbook-runs/             – trigger a new run (admin)
  GET    /playbook-runs/             – list runs (authenticated)
  GET    /playbook-runs/{id}         – get one run (authenticated)
  GET    /playbook-runs/{id}/stream  – SSE live output stream (authenticated)
  DELETE /playbook-runs/{id}         – cancel a running job (admin)
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.crud import get_or_404
from app.database import SessionLocal, get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.git import AnsiblePlaybook, PlaybookRun, PlaybookRunStatus
from app.schemas.git import PlaybookRunCreate, PlaybookRunRead
from app.schemas.inventory import PageResponse
from app.services import ansible_runner as runner_svc
from app.services.playbook_execution import create_playbook_run, launch_playbook_run

log = logging.getLogger(__name__)

router = APIRouter(prefix="/playbook-runs", tags=["playbook-runs"])

_RUN_START_TIMEOUT_SECONDS = 15


def _recovery_note(message: str) -> str:
    return f"\n\n[slimventory] Automatically marked failed during recovery: {message}\n"


def _mark_run_failed(sess: Session, run: PlaybookRun, message: str) -> None:
    run.status = PlaybookRunStatus.failed
    run.finished_at = run.finished_at or datetime.now(timezone.utc)
    run.output = (run.output or "") + _recovery_note(message)


def _recover_run_if_orphaned(sess: Session, run: PlaybookRun) -> bool:
    if run.status not in (PlaybookRunStatus.pending, PlaybookRunStatus.running):
        return False

    now = datetime.now(timezone.utc)
    created_at = run.created_at
    if created_at is not None and created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)

    if not run.sidecar_job_id:
        if created_at and (now - created_at).total_seconds() >= _RUN_START_TIMEOUT_SECONDS:
            _mark_run_failed(sess, run, "run did not start in time and never received a sidecar job id")
            return True
        return False

    exists = runner_svc.sidecar_job_exists_sync(run.sidecar_job_id)
    if exists is False:
        _mark_run_failed(
            sess,
            run,
            f"ansible-runner job {run.sidecar_job_id} no longer exists on the sidecar",
        )
        return True
    return False


def _recover_runs_if_needed(sess: Session, runs: list[PlaybookRun]) -> None:
    changed = False
    for run in runs:
        changed = _recover_run_if_orphaned(sess, run) or changed
    if changed:
        sess.commit()
        for run in runs:
            sess.refresh(run)


@router.post("/", response_model=PlaybookRunRead, status_code=status.HTTP_202_ACCEPTED)
async def create_run(
    body: PlaybookRunCreate,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_admin),
):
    playbook = db.get(AnsiblePlaybook, body.playbook_id)
    if playbook is None:
        raise HTTPException(status_code=404, detail="Playbook not found")

    run = create_playbook_run(
        db,
        playbook_id=body.playbook_id,
        run_by_id=current_user.id,
        host_source=body.host_source,
        target_host_ids=body.target_host_ids,
        inventory_filter_type=body.inventory_filter_type,
        inventory_filter_value=body.inventory_filter_value,
        extra_vars=body.extra_vars,
    )

    launch_playbook_run(run, playbook.repo_id, playbook.path)

    return run


@router.get("/", response_model=PageResponse[PlaybookRunRead])
def list_runs(
    playbook_id: int = Query(default=None),
    run_status: str = Query(default=None, alias="status"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    q = select(PlaybookRun)
    if playbook_id is not None:
        q = q.where(PlaybookRun.playbook_id == playbook_id)
    if run_status is not None:
        q = q.where(PlaybookRun.status == run_status)
    q = q.order_by(PlaybookRun.created_at.desc())

    count_q = select(func.count()).select_from(PlaybookRun)
    if playbook_id is not None:
        count_q = count_q.where(PlaybookRun.playbook_id == playbook_id)
    if run_status is not None:
        count_q = count_q.where(PlaybookRun.status == run_status)

    total = db.scalar(count_q) or 0
    items = db.execute(q.offset(skip).limit(limit)).scalars().all()
    _recover_runs_if_needed(db, items)
    return {"items": list(items), "total": total}


@router.get("/{run_id}", response_model=PlaybookRunRead)
def get_run(
    run_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    run = get_or_404(db, PlaybookRun, run_id)
    _recover_runs_if_needed(db, [run])
    return run


@router.get("/{run_id}/stream")
async def stream_run_output(
    run_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    """Server-Sent Events endpoint for live playbook output.

    Each SSE event is a JSON object:
      {"type": "chunk",  "text": "..."}
      {"type": "done",   "exit_code": 0}
      {"type": "error",  "message": "..."}
    """
    run = get_or_404(db, PlaybookRun, run_id)
    completed_statuses = (
        PlaybookRunStatus.success,
        PlaybookRunStatus.failed,
        PlaybookRunStatus.cancelled,
    )
    initial_status = run.status
    stored_output = run.output or ""
    sidecar_job_id = run.sidecar_job_id
    stored_exit_code = run.exit_code
    # Release the sync DB session — streaming may take a long time
    db.close()

    async def generate():
        try:
            # Already finished — replay stored output
            if initial_status in completed_statuses:
                if stored_output:
                    yield f"data: {json.dumps({'type': 'chunk', 'text': stored_output})}\n\n"
                yield f"data: {json.dumps({'type': 'done', 'exit_code': stored_exit_code})}\n\n"
                return

            # Still pending / running — wait for a sidecar job id (poll DB briefly)
            effective_sidecar_id = sidecar_job_id
            if not effective_sidecar_id:
                for _ in range(20):  # wait up to 10s for the task to start
                    await asyncio.sleep(0.5)
                    with SessionLocal() as sess:
                        r = sess.get(PlaybookRun, run_id)
                        if r and r.sidecar_job_id:
                            effective_sidecar_id = r.sidecar_job_id
                            break
                        if r and r.status in completed_statuses:
                            output = r.output or ""
                            if output:
                                yield f"data: {json.dumps({'type': 'chunk', 'text': output})}\n\n"
                            yield f"data: {json.dumps({'type': 'done', 'exit_code': r.exit_code})}\n\n"
                            return

            if not effective_sidecar_id:
                with SessionLocal() as sess:
                    r = sess.get(PlaybookRun, run_id)
                    if r and r.status in (PlaybookRunStatus.pending, PlaybookRunStatus.running):
                        _mark_run_failed(sess, r, "run did not start in time and never received a sidecar job id")
                        sess.commit()
                yield f"data: {json.dumps({'type': 'error', 'message': 'Run did not start in time'})}\n\n"
                return

            # Stream from sidecar
            async for event in runner_svc.stream_output(effective_sidecar_id):
                yield f"data: {json.dumps(event)}\n\n"

                if event["type"] == "chunk":
                    with SessionLocal() as sess:
                        r = sess.get(PlaybookRun, run_id)
                        if r:
                            r.output = (r.output or "") + event["text"]
                            sess.commit()

                elif event["type"] == "done":
                    exit_code = event.get("exit_code")
                    final_status = PlaybookRunStatus.success if exit_code == 0 else PlaybookRunStatus.failed
                    with SessionLocal() as sess:
                        r = sess.get(PlaybookRun, run_id)
                        if r:
                            r.status = final_status
                            r.exit_code = exit_code
                            r.finished_at = datetime.now(timezone.utc)
                            sess.commit()
                    return

                elif event["type"] == "orphaned":
                    with SessionLocal() as sess:
                        r = sess.get(PlaybookRun, run_id)
                        if r and r.status in (PlaybookRunStatus.pending, PlaybookRunStatus.running):
                            _mark_run_failed(sess, r, event["message"])
                            sess.commit()
                    yield f"data: {json.dumps({'type': 'done', 'exit_code': None})}\n\n"
                    return
        except Exception:
            log.exception("Unexpected error streaming playbook run %d", run_id)
            yield f"data: {json.dumps({'type': 'error', 'message': 'An unexpected error occurred'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_run(
    run_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    run = get_or_404(db, PlaybookRun, run_id)
    if run.status not in (PlaybookRunStatus.pending, PlaybookRunStatus.running):
        raise HTTPException(status_code=409, detail="Run is not in a cancellable state")

    if run.sidecar_job_id:
        await runner_svc.cancel_run(run.sidecar_job_id)

    run.status = PlaybookRunStatus.cancelled
    run.finished_at = datetime.now(timezone.utc)
    db.commit()
