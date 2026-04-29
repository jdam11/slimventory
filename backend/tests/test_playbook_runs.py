from collections.abc import AsyncGenerator
from datetime import datetime, timezone

from sqlalchemy.orm import sessionmaker

from app.models.auth import AppUser
from app.models.git import (
    AnsiblePlaybook,
    GitAuthType,
    GitRepo,
    GitRepoType,
    PlaybookHostSource,
    PlaybookRun,
    PlaybookRunStatus,
)


def _auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_repo_and_playbook(db):
    repo = GitRepo(
        name="ansible-lab",
        url="https://example.invalid/ansible-lab.git",
        branch="main",
        repo_type=GitRepoType.ansible,
        auth_type=GitAuthType.none,
    )
    db.add(repo)
    db.commit()
    db.refresh(repo)

    playbook = AnsiblePlaybook(repo_id=repo.id, path="playbooks/restart-exporter.yml")
    db.add(playbook)
    db.commit()
    db.refresh(playbook)
    return playbook


def _create_run(
    db,
    *,
    playbook_id: int,
    run_by_id: int,
    status: PlaybookRunStatus,
    output: str = "",
    sidecar_job_id: str | None = None,
):
    run = PlaybookRun(
        playbook_id=playbook_id,
        run_by_id=run_by_id,
        host_source=PlaybookHostSource.repo,
        target_host_ids=None,
        inventory_filter_type=None,
        inventory_filter_value=None,
        extra_vars=None,
        status=status,
        output=output,
        sidecar_job_id=sidecar_job_id,
        started_at=datetime.now(timezone.utc) if status != PlaybookRunStatus.pending else None,
        finished_at=(
            datetime.now(timezone.utc)
            if status in (PlaybookRunStatus.success, PlaybookRunStatus.failed, PlaybookRunStatus.cancelled)
            else None
        ),
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def test_live_playbook_stream_updates_output_and_status(
    client,
    db,
    engine,
    admin_user: AppUser,
    admin_token,
    monkeypatch,
):
    playbook = _create_repo_and_playbook(db)
    run = _create_run(
        db,
        playbook_id=playbook.id,
        run_by_id=admin_user.id,
        status=PlaybookRunStatus.running,
        sidecar_job_id="job-1",
    )

    import sys

    playbook_runs_router = sys.modules["app.routers.playbook_runs"]

    async def fake_stream_output(sidecar_job_id: str) -> AsyncGenerator[dict, None]:
        assert sidecar_job_id == "job-1"
        yield {"type": "chunk", "text": "TASK [restart exporter]\n"}
        yield {"type": "chunk", "text": "ok: [node1]\n"}
        yield {"type": "done", "exit_code": 0}

    monkeypatch.setattr(playbook_runs_router.runner_svc, "stream_output", fake_stream_output)
    monkeypatch.setattr(playbook_runs_router, "SessionLocal", sessionmaker(bind=engine))

    resp = client.get(f"/api/playbook-runs/{run.id}/stream", headers=_auth_header(admin_token))
    assert resp.status_code == 200
    assert "TASK [restart exporter]" in resp.text
    assert '"type": "done"' in resp.text

    with sessionmaker(bind=engine)() as sess:
        refreshed = sess.get(PlaybookRun, run.id)
        assert refreshed is not None
        assert refreshed.output == "TASK [restart exporter]\nok: [node1]\n"
        assert refreshed.status == PlaybookRunStatus.success
        assert refreshed.exit_code == 0
        assert refreshed.finished_at is not None


def test_completed_playbook_stream_replays_stored_output(client, db, admin_user: AppUser, admin_token):
    playbook = _create_repo_and_playbook(db)
    run = _create_run(
        db,
        playbook_id=playbook.id,
        run_by_id=admin_user.id,
        status=PlaybookRunStatus.success,
        output="PLAY RECAP\nnode1 : ok=3 changed=1 failed=0\n",
    )

    resp = client.get(f"/api/playbook-runs/{run.id}/stream", headers=_auth_header(admin_token))
    assert resp.status_code == 200
    assert "PLAY RECAP" in resp.text
    assert '"type": "done"' in resp.text
