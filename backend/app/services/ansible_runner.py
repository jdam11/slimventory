"""Ansible runner sidecar client.

Communicates with the ansible-runner sidecar container over the internal
Docker network to trigger playbook executions and stream their output.
"""

import asyncio
import logging
from typing import Any, AsyncGenerator, Dict, Optional

import httpx

from app.config import settings

log = logging.getLogger(__name__)

_POLL_INTERVAL = 0.5  # seconds between output polls


async def trigger_run(
    repo_path: str,
    playbook_path: str,
    inventory_type: str,
    inventory: Optional[str],
    extra_vars: Optional[Dict[str, Any]],
    env_vars: Optional[Dict[str, str]] = None,
    kerberos_config: Optional[str] = None,
    kerberos_ccache_name: Optional[str] = None,
    vault_password: Optional[str] = None,
) -> str:
    """Send a run request to the sidecar and return the sidecar job_id."""
    payload = {
        "repo_path": repo_path,
        "playbook_path": playbook_path,
        "inventory_type": inventory_type,
        "inventory": inventory,
        "extra_vars": extra_vars,
        "env_vars": env_vars,
        "kerberos_config": kerberos_config,
        "kerberos_ccache_name": kerberos_ccache_name,
        "vault_password": vault_password,
    }
    async with httpx.AsyncClient(base_url=settings.ANSIBLE_RUNNER_URL, timeout=30.0) as client:
        resp = await client.post("/run", json=payload)
        resp.raise_for_status()
        return resp.json()["job_id"]


async def cancel_run(sidecar_job_id: str) -> None:
    """Cancel a running job on the sidecar."""
    try:
        async with httpx.AsyncClient(base_url=settings.ANSIBLE_RUNNER_URL, timeout=10.0) as client:
            await client.delete(f"/run/{sidecar_job_id}")
    except Exception as exc:
        log.warning("Failed to cancel sidecar job %s: %s", sidecar_job_id, exc)


async def sidecar_job_exists(sidecar_job_id: str) -> Optional[bool]:
    """Return True when the sidecar job exists, False on 404, None on probe failure."""
    try:
        async with httpx.AsyncClient(base_url=settings.ANSIBLE_RUNNER_URL, timeout=10.0) as client:
            resp = await client.get(f"/run/{sidecar_job_id}/output", params={"offset": 0}, timeout=10.0)
            if resp.status_code == 404:
                return False
            resp.raise_for_status()
            return True
    except Exception as exc:
        log.warning("Failed to probe sidecar job %s: %s", sidecar_job_id, exc)
        return None


def sidecar_job_exists_sync(sidecar_job_id: str) -> Optional[bool]:
    """Synchronous variant used by non-async request handlers."""
    try:
        with httpx.Client(base_url=settings.ANSIBLE_RUNNER_URL, timeout=10.0) as client:
            resp = client.get(f"/run/{sidecar_job_id}/output", params={"offset": 0}, timeout=10.0)
            if resp.status_code == 404:
                return False
            resp.raise_for_status()
            return True
    except Exception as exc:
        log.warning("Failed to probe sidecar job %s synchronously: %s", sidecar_job_id, exc)
        return None


async def stream_output(sidecar_job_id: str) -> AsyncGenerator[Dict[str, Any], None]:
    """Async generator that yields output events from the sidecar.

    Yields dicts:
        {"type": "chunk", "text": "..."}
        {"type": "done", "exit_code": int | None}
        {"type": "error", "message": "..."}
    """
    offset = 0
    async with httpx.AsyncClient(base_url=settings.ANSIBLE_RUNNER_URL, timeout=30.0) as client:
        while True:
            try:
                resp = await client.get(
                    f"/run/{sidecar_job_id}/output",
                    params={"offset": offset},
                    timeout=15.0,
                )
                resp.raise_for_status()
                data = resp.json()

                chunk: str = data.get("output", "")
                done: bool = data.get("done", False)
                exit_code = data.get("exit_code")

                if chunk:
                    offset += len(chunk.encode("utf-8"))
                    yield {"type": "chunk", "text": chunk}

                if done:
                    yield {"type": "done", "exit_code": exit_code}
                    return

                if not chunk:
                    await asyncio.sleep(_POLL_INTERVAL)

            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    yield {
                        "type": "orphaned",
                        "message": f"Runner job {sidecar_job_id} was not found on the ansible-runner sidecar",
                    }
                    return
                yield {"type": "error", "message": f"Sidecar HTTP error: {exc.response.status_code}"}
                await asyncio.sleep(2.0)
            except Exception:
                log.exception("Unexpected error polling sidecar job %s", sidecar_job_id)
                yield {"type": "error", "message": "An unexpected error occurred"}
                await asyncio.sleep(2.0)
