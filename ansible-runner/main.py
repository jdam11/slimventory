"""ansible-runner sidecar service.

Provides a minimal REST API for triggering and monitoring ansible-playbook
executions.  The backend container calls this service over the internal Docker
network — it must never be exposed to the host network.

Endpoints
---------
POST /run                 – Start an ansible-playbook process
GET  /run/{job_id}        – Check job status
GET  /run/{job_id}/output – Stream accumulated stdout/stderr (offset-based)
DELETE /run/{job_id}      – Cancel / clean up a job
GET  /health              – Liveness probe
"""
import json
import logging
import os
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

JOB_RETENTION_SECONDS = 300
KNOWN_HOSTS_DIR = "/known_hosts"
ANSIBLE_KNOWN_HOSTS_FILE = f"{KNOWN_HOSTS_DIR}/ansible_known_hosts"
REPOS_BASE = os.path.realpath("/repos")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ansible-runner")

app = FastAPI(title="ansible-runner", docs_url="/docs")



@dataclass
class Job:
    process: subprocess.Popen
    output_path: str
    output_file: Any  # open file object for the subprocess stdout
    inv_path: Optional[str] = None  # temp inventory file, if any
    kerberos_config_path: Optional[str] = None
    vault_password_file: Optional[str] = None
    status: str = "running"  # running | done
    exit_code: Optional[int] = None
    finished_at: Optional[float] = None


_jobs: Dict[str, Job] = {}
_jobs_lock = threading.Lock()



class RunRequest(BaseModel):
    repo_path: str
    playbook_path: str
    # "file" = use the repo's own inventory; "string" = use the provided text
    inventory_type: str = "file"
    # When inventory_type="file": path relative to repo_path (e.g. "inventory")
    # When inventory_type="string": INI/YAML content written to a temp file
    inventory: Optional[str] = None
    extra_vars: Optional[Dict[str, Any]] = None
    # Additional environment variables forwarded to ansible-playbook
    env_vars: Optional[Dict[str, str]] = None
    kerberos_config: Optional[str] = None
    kerberos_ccache_name: Optional[str] = None
    vault_password: Optional[str] = None



def _wait_for_job(job_id: str, job: Job) -> None:
    """Block until the subprocess exits, then update job state."""
    job.process.wait()
    try:
        job.output_file.flush()
        job.output_file.close()
    except Exception:
        pass
    with _jobs_lock:
        job.exit_code = job.process.returncode
        job.status = "done"
        job.finished_at = time.time()
    log.info("job=%s exit_code=%s", job_id, job.exit_code)
    threading.Thread(target=_cleanup_job_later, args=(job_id,), daemon=True).start()


def _cleanup_job(job: Job) -> None:
    """Remove any temporary files associated with the job."""
    for path in [job.output_path, job.inv_path, job.kerberos_config_path, job.vault_password_file]:
        if path and os.path.exists(path):
            try:
                os.unlink(path)
            except OSError:
                pass


def _cleanup_job_later(job_id: str) -> None:
    time.sleep(JOB_RETENTION_SECONDS)
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None or job.status != "done":
            return
        _jobs.pop(job_id, None)
    _cleanup_job(job)


def _ensure_known_hosts_storage() -> None:
    os.makedirs(KNOWN_HOSTS_DIR, exist_ok=True)
    os.chmod(KNOWN_HOSTS_DIR, 0o700)  # nosemgrep: python.lang.security.audit.insecure-file-permissions.insecure-file-permissions
    if not os.path.exists(ANSIBLE_KNOWN_HOSTS_FILE):
        with open(ANSIBLE_KNOWN_HOSTS_FILE, "a", encoding="utf-8"):
            pass
    os.chmod(ANSIBLE_KNOWN_HOSTS_FILE, 0o600)


def _validate_paths(repo_path: str, playbook_path: str) -> tuple[str, str]:
    """Validate paths and return (real_repo, real_playbook) resolved absolute paths.

    Raises HTTPException if either path escapes the allowed repos tree.
    Callers must use the returned paths for all subsequent filesystem operations
    to avoid TOCTOU issues with the original user-supplied strings.
    """
    real_repo = os.path.realpath(repo_path)
    if not real_repo.startswith(REPOS_BASE + os.sep) and real_repo != REPOS_BASE:
        raise HTTPException(status_code=400, detail="repo_path is outside the allowed repos directory")
    if os.path.isabs(playbook_path):
        raise HTTPException(status_code=400, detail="playbook_path must be a relative path")
    real_playbook = os.path.realpath(os.path.join(real_repo, playbook_path))
    if not real_playbook.startswith(real_repo + os.sep):
        raise HTTPException(status_code=400, detail="playbook_path escapes the repo directory")
    return real_repo, real_playbook


def _write_temp_secret_file(prefix: str, suffix: str, content: str) -> str:
    fd, path = tempfile.mkstemp(prefix=prefix, suffix=suffix)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
            if not content.endswith("\n"):
                handle.write("\n")
        os.chmod(path, 0o600)
    except Exception:
        os.unlink(path)
        raise
    return path



@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/run", status_code=202)
def start_run(body: RunRequest):
    real_repo, real_playbook = _validate_paths(body.repo_path, body.playbook_path)
    if not os.path.isdir(real_repo):
        raise HTTPException(status_code=400, detail="repo_path does not exist or is not a directory")
    _ensure_known_hosts_storage()
    job_id = str(uuid4())
    output_path = f"/tmp/run_{job_id}.txt"
    inv_path: Optional[str] = None
    kerberos_config_path: Optional[str] = None
    vault_password_file: Optional[str] = None

    cmd: List[str] = ["ansible-playbook", real_playbook]

    if body.inventory_type == "string" and body.inventory:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yml", prefix=f"inv_{job_id}_", delete=False
        ) as inv_f:
            inv_f.write(body.inventory)
            inv_path = inv_f.name
        cmd += ["-i", inv_path]
    elif body.inventory_type == "file" and body.inventory:
        if os.path.isabs(body.inventory):
            raise HTTPException(status_code=400, detail="inventory must be a relative path")
        real_inv = os.path.realpath(os.path.join(real_repo, body.inventory))
        if not real_inv.startswith(real_repo + os.sep):
            raise HTTPException(status_code=400, detail="inventory escapes the repo directory")
        cmd += ["-i", real_inv]

    if body.extra_vars:
        cmd += ["-e", json.dumps(body.extra_vars)]

    if body.vault_password:
        vault_password_file = _write_temp_secret_file(f"vault_{job_id}_", ".txt", body.vault_password)
        cmd += ["--vault-password-file", vault_password_file]

    env = os.environ.copy()
    env.setdefault("ANSIBLE_HOST_KEY_CHECKING", "True")
    env.setdefault(
        "ANSIBLE_SSH_ARGS",
        f"-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile={ANSIBLE_KNOWN_HOSTS_FILE} -o HashKnownHosts=yes",
    )
    if body.env_vars:
        env.update(body.env_vars)
    if body.kerberos_config:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".conf", prefix=f"krb5_{job_id}_", delete=False
        ) as krb5_f:
            krb5_f.write(body.kerberos_config)
            kerberos_config_path = krb5_f.name
        os.chmod(kerberos_config_path, 0o600)
        env["KRB5_CONFIG"] = kerberos_config_path
    if body.kerberos_ccache_name:
        env["KRB5CCNAME"] = body.kerberos_ccache_name

    log.info("job=%s cmd=%s cwd=%s", job_id, cmd, real_repo)

    out_f = open(output_path, "ab")
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=real_repo,
            stdout=out_f,
            stderr=subprocess.STDOUT,
            env=env,
        )
    except FileNotFoundError:
        out_f.close()
        _cleanup_job(
            Job(
                process=None,  # type: ignore[arg-type]
                output_path=output_path,
                output_file=None,
                inv_path=inv_path,
                kerberos_config_path=kerberos_config_path,
                vault_password_file=vault_password_file,
                status="done",
            )
        )
        raise HTTPException(status_code=500, detail="ansible-playbook not found in PATH")

    job = Job(
        process=proc,
        output_path=output_path,
        output_file=out_f,
        inv_path=inv_path,
        kerberos_config_path=kerberos_config_path,
        vault_password_file=vault_password_file,
    )

    with _jobs_lock:
        _jobs[job_id] = job

    thread = threading.Thread(target=_wait_for_job, args=(job_id, job), daemon=True)
    thread.start()

    return {"job_id": job_id}


@app.get("/run/{job_id}")
def get_run(job_id: str):
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"status": job.status, "exit_code": job.exit_code}


@app.get("/run/{job_id}/output")
def get_output(job_id: str, offset: int = 0):
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    try:
        with open(job.output_path, "rb") as f:
            f.seek(max(0, offset))
            raw = f.read()
        text = raw.decode("utf-8", errors="replace")
    except FileNotFoundError:
        text = ""

    return {
        "output": text,
        "done": job.status == "done",
        "exit_code": job.exit_code,
    }


@app.delete("/run/{job_id}", status_code=204)
def cancel_run(job_id: str):
    with _jobs_lock:
        job = _jobs.pop(job_id, None)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status == "running":
        try:
            job.process.terminate()
        except OSError:
            pass
        job.status = "done"
        job.exit_code = -1

    threading.Thread(target=_cleanup_job, args=(job,), daemon=True).start()
