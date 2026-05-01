import logging
import time

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy.exc import IntegrityError

from .config import settings
from .database import SessionLocal

# Configure root logger before anything else uses it
logging.basicConfig(
    level=settings.LOG_LEVEL,
    format="%(asctime)s %(levelname)-8s %(name)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
if settings.LOG_LEVEL != "DEBUG":
    for _noisy in ("uvicorn", "uvicorn.access", "apscheduler", "sqlalchemy"):
        logging.getLogger(_noisy).setLevel(logging.WARNING)

from .audit import _client_ip, log_rate_limited
from .routers import (
    admin,
    ai,
    ansible_defaults,
    ansible_playbooks,
    app_fields,
    apps,
    auth,
    backup,
    datastores,
    domains,
    environments,
    git_credentials,
    git_repos,
    global_default_roles,
    host_ansible_vars,
    host_app_fields,
    host_apps,
    host_host_type_fields,
    host_resources,
    host_role_fields,
    host_status_fields,
    host_statuses,
    host_storage,
    host_type_fields,
    host_type_roles,
    host_types,
    hosts,
    inventory,
    job_templates,
    k3s_cluster_apps,
    k3s_clusters,
    monitoring,
    playbook_runs,
    proxmox,
    role_fields,
    role_matrix,
    roles,
    status_fields,
    unifi,
    vault_credentials,
    vlans,
)

access_logger = logging.getLogger("access")
from .rate_limit import limiter
from .services.backup import apply_backup_schedule, set_backup_scheduler_refresh
from .services.known_hosts import ensure_known_hosts_storage
from .services.proxmox import apply_schedule, set_scheduler_refresh
from .services.scheduler import (
    load_all_schedules,
    set_job_template_scheduler,
    set_job_template_scheduler_refresh,
)

_enable_docs = settings.LOG_LEVEL == "DEBUG" or settings.TESTING

app = FastAPI(
    title="Homelab Inventory",
    version="1.0.0",
    docs_url="/api/docs" if _enable_docs else None,
    openapi_url="/api/openapi.json" if _enable_docs else None,
    redoc_url="/api/redoc" if _enable_docs else None,
)

app.state.limiter = limiter


async def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
    log_rate_limited(request)
    return JSONResponse(
        status_code=429,
        content={"detail": f"Rate limit exceeded: {exc.detail}"},
    )


app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Inventory-Token"],
)


@app.middleware("http")
async def access_log(request: Request, call_next):
    start = time.monotonic()
    response = await call_next(request)
    duration_ms = (time.monotonic() - start) * 1000
    access_logger.info(
        "%s %s %d %.1fms ip=%s",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
        _client_ip(request),
    )
    return response


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
    response.headers["Cache-Control"] = "no-store"
    if settings.SECURE_COOKIES:
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response


@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError) -> JSONResponse:
    msg = str(exc.orig) if exc.orig else str(exc)
    if "Duplicate entry" in msg or "UNIQUE constraint" in msg:
        return JSONResponse(
            status_code=409,
            content={"detail": "Duplicate entry: a record with this value already exists"},
        )
    if "foreign key constraint" in msg.lower() or "FOREIGN KEY" in msg:
        return JSONResponse(
            status_code=409,
            content={"detail": "Constraint violation: referenced record does not exist or is still in use"},
        )
    return JSONResponse(status_code=409, content={"detail": "Database constraint violation"})


API = "/api"

app.include_router(admin, prefix=API)
app.include_router(ai, prefix=API)
app.include_router(backup, prefix=API)
app.include_router(auth, prefix=API)
app.include_router(environments, prefix=API)
app.include_router(host_statuses, prefix=API)
app.include_router(host_types, prefix=API)
app.include_router(vlans, prefix=API)
app.include_router(roles, prefix=API)
app.include_router(role_matrix, prefix=API)
app.include_router(apps, prefix=API)
app.include_router(app_fields, prefix=API)
app.include_router(datastores, prefix=API)
app.include_router(domains, prefix=API)
app.include_router(k3s_clusters, prefix=API)
app.include_router(k3s_cluster_apps, prefix=API)
app.include_router(hosts, prefix=API)
app.include_router(host_resources, prefix=API)
app.include_router(host_storage, prefix=API)
app.include_router(host_apps, prefix=API)
app.include_router(host_app_fields, prefix=API)
app.include_router(role_fields, prefix=API)
app.include_router(host_role_fields, prefix=API)
app.include_router(global_default_roles, prefix=API)
app.include_router(host_type_roles, prefix=API)
app.include_router(host_type_fields, prefix=API)
app.include_router(host_host_type_fields, prefix=API)
app.include_router(status_fields, prefix=API)
app.include_router(host_status_fields, prefix=API)
app.include_router(ansible_defaults, prefix=API)
app.include_router(host_ansible_vars, prefix=API)
app.include_router(inventory, prefix=API)
app.include_router(proxmox, prefix=API)
app.include_router(unifi, prefix=API)
app.include_router(monitoring, prefix=API)
app.include_router(git_credentials, prefix=API)
app.include_router(git_repos, prefix=API)
app.include_router(ansible_playbooks, prefix=API)
app.include_router(playbook_runs, prefix=API)
app.include_router(vault_credentials, prefix=API)
app.include_router(job_templates, prefix=API)


scheduler = BackgroundScheduler(timezone="UTC")


def refresh_proxmox_schedule() -> None:
    db = SessionLocal()
    try:
        apply_schedule(db, scheduler)
    finally:
        db.close()


def refresh_backup_schedule() -> None:
    db = SessionLocal()
    try:
        apply_backup_schedule(db, scheduler)
    finally:
        db.close()


def refresh_template_schedule() -> None:
    db = SessionLocal()
    try:
        load_all_schedules(db)
    finally:
        db.close()


@app.on_event("startup")
def startup_event() -> None:
    ensure_known_hosts_storage()
    if not scheduler.running:
        scheduler.start()
    set_scheduler_refresh(refresh_proxmox_schedule)
    set_backup_scheduler_refresh(refresh_backup_schedule)
    set_job_template_scheduler(scheduler)
    set_job_template_scheduler_refresh(refresh_template_schedule)
    try:
        refresh_proxmox_schedule()
    except Exception:  # noqa: BLE001
        pass  # DB may not be reachable in test/cold-start environments
    try:
        refresh_backup_schedule()
    except Exception:  # noqa: BLE001
        pass
    try:
        refresh_template_schedule()
    except Exception:  # noqa: BLE001
        pass


@app.on_event("shutdown")
def shutdown_event() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)


@app.get("/api/health", tags=["system"])
def health() -> dict:
    return {"status": "ok"}
