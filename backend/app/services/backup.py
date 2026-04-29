"""
Database backup and restore service.

All backups are encrypted at rest using Fernet with an HKDF-derived key
isolated from the field encryption key. The mysqldump output is piped
directly through encryption — plaintext never touches disk.
"""

from __future__ import annotations

import base64
import logging
import os
import struct
import subprocess
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Generator, Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy.orm import Session

from ..config import settings
from ..models.backup import AppBackupConfig, AppBackupHistory

logger = logging.getLogger(__name__)

_backup_lock = threading.Lock()
_scheduler_refresh_callback: Optional[Callable[[], None]] = None

CHUNK_SIZE = 64 * 1024  # 64 KB




def _derive_backup_key() -> bytes:
    """Derive a Fernet key for backup encryption, isolated from field encryption."""
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=b"slim-backup-encryption",
    )
    raw = hkdf.derive(settings.SECRET_KEY.encode("utf-8"))
    return base64.urlsafe_b64encode(raw)


def _get_fernet() -> Fernet:
    return Fernet(_derive_backup_key())


def _encrypt_stream(input_stream, output_path: str) -> None:
    """Read from input_stream in chunks, encrypt each, write length-prefixed to file."""
    f = _get_fernet()
    with open(output_path, "wb") as out:
        while True:
            chunk = input_stream.read(CHUNK_SIZE)
            if not chunk:
                break
            encrypted = f.encrypt(chunk)
            out.write(struct.pack(">I", len(encrypted)))
            out.write(encrypted)


def _decrypt_stream(input_path: str, output_stream) -> None:
    """Read length-prefixed encrypted chunks from file, decrypt, write to output."""
    f = _get_fernet()
    with open(input_path, "rb") as inp:
        while True:
            header = inp.read(4)
            if not header:
                break
            if len(header) < 4:
                raise ValueError("Corrupted backup file: incomplete chunk header")
            (length,) = struct.unpack(">I", header)
            encrypted = inp.read(length)
            if len(encrypted) < length:
                raise ValueError("Corrupted backup file: incomplete chunk data")
            output_stream.write(f.decrypt(encrypted))


def _decrypt_stream_iter(input_path: str) -> Generator[bytes, None, None]:
    """Yield decrypted chunks from an encrypted backup file."""
    f = _get_fernet()
    with open(input_path, "rb") as inp:
        while True:
            header = inp.read(4)
            if not header:
                break
            if len(header) < 4:
                raise ValueError("Corrupted backup file: incomplete chunk header")
            (length,) = struct.unpack(">I", header)
            encrypted = inp.read(length)
            if len(encrypted) < length:
                raise ValueError("Corrupted backup file: incomplete chunk data")
            yield f.decrypt(encrypted)




def _write_defaults_file() -> str:
    """Write a temporary MySQL defaults file and return its path."""
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".cnf", prefix="slim_backup_", delete=False)
    tmp.write("[client]\n")
    tmp.write(f"user={settings.DB_USER}\n")
    tmp.write(f"password={settings.DB_PASSWORD}\n")
    tmp.write(f"host={settings.DB_HOST}\n")
    tmp.write(f"port={settings.DB_PORT}\n")
    tmp.close()
    os.chmod(tmp.name, 0o600)
    return tmp.name




def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def run_backup(db: Session, trigger_source: str, created_by: Optional[str] = None) -> AppBackupHistory:
    """Execute a database backup. Must be called with _backup_lock held."""
    backup_dir = Path(settings.BACKUP_DIR)
    backup_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = f"slim_backup_{ts}.enc"
    filepath = str(backup_dir / filename)

    history = AppBackupHistory(
        filename=filename,
        status="running",
        trigger_source=trigger_source,
        started_at=_now(),
        created_by=created_by,
    )
    db.add(history)
    db.commit()
    db.refresh(history)

    defaults_file = _write_defaults_file()
    try:
        cmd = [
            "mysqldump",
            f"--defaults-extra-file={defaults_file}",
            "--single-transaction",
            "--routines",
            "--triggers",
            settings.DB_NAME,
        ]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        _encrypt_stream(proc.stdout, filepath)
        proc.wait()

        if proc.returncode != 0:
            stderr_output = proc.stderr.read().decode("utf-8", errors="replace") if proc.stderr else ""
            raise RuntimeError(f"mysqldump failed (exit {proc.returncode}): {stderr_output[:500]}")

        size_bytes = os.path.getsize(filepath)
        history.status = "completed"
        history.size_bytes = size_bytes
        history.completed_at = _now()
        db.commit()
        db.refresh(history)

        _enforce_retention(db)

        logger.info("Backup completed: %s (%d bytes)", filename, size_bytes)
        return history

    except Exception as exc:
        history.status = "failed"
        history.error_message = str(exc)[:1000]
        history.completed_at = _now()
        db.commit()
        db.refresh(history)
        # Clean up partial file
        if os.path.exists(filepath):
            os.remove(filepath)
        logger.error("Backup failed: %s", exc)
        raise
    finally:
        os.unlink(defaults_file)


def run_backup_thread(trigger_source: str, created_by: Optional[str] = None) -> None:
    """Run a backup in a thread-safe manner with its own DB session."""
    from ..database import SessionLocal

    if not _backup_lock.acquire(blocking=False):
        logger.warning("Backup already in progress, skipping")
        return
    try:
        session = SessionLocal()
        try:
            run_backup(session, trigger_source, created_by)
        finally:
            session.close()
    finally:
        _backup_lock.release()




def run_restore(db: Session, backup_id: int) -> None:
    """Restore the database from an encrypted backup."""
    from ..database import engine

    history = db.get(AppBackupHistory, backup_id)
    if not history:
        raise ValueError(f"Backup {backup_id} not found")
    if history.status != "completed":
        raise ValueError(f"Cannot restore from backup with status '{history.status}'")

    filepath = str(Path(settings.BACKUP_DIR) / history.filename)
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"Backup file not found: {history.filename}")

    if not _backup_lock.acquire(blocking=False):
        raise RuntimeError("A backup or restore operation is already in progress")

    # Close the caller's DB session and dispose the entire connection pool
    # before piping SQL into mysql CLI — the restore drops/recreates tables
    # which would kill any active connections.
    db.close()
    engine.dispose()

    defaults_file = _write_defaults_file()
    try:
        cmd = [
            "mysql",
            f"--defaults-extra-file={defaults_file}",
            settings.DB_NAME,
        ]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
        _decrypt_stream(filepath, proc.stdin)
        proc.stdin.close()
        proc.wait()

        if proc.returncode != 0:
            stderr_output = proc.stderr.read().decode("utf-8", errors="replace") if proc.stderr else ""
            raise RuntimeError(f"mysql restore failed (exit {proc.returncode}): {stderr_output[:500]}")

        logger.info("Restore completed from: %s", history.filename)
    finally:
        os.unlink(defaults_file)
        _backup_lock.release()




def _enforce_retention(db: Session) -> None:
    """Delete the oldest backups beyond the retention count."""
    config = _ensure_default_config(db)
    retention = config.retention_count

    all_completed = (
        db.query(AppBackupHistory)
        .filter(AppBackupHistory.status == "completed")
        .order_by(AppBackupHistory.started_at.desc())
        .all()
    )

    if len(all_completed) <= retention:
        return

    to_delete = all_completed[retention:]
    backup_dir = Path(settings.BACKUP_DIR)
    for entry in to_delete:
        filepath = backup_dir / entry.filename
        if filepath.exists():
            filepath.unlink()
        db.delete(entry)
        logger.info("Retention: deleted old backup %s", entry.filename)
    db.commit()




def delete_backup(db: Session, backup_id: int) -> str:
    """Delete a specific backup file and its history record. Returns filename."""
    history = db.get(AppBackupHistory, backup_id)
    if not history:
        raise ValueError(f"Backup {backup_id} not found")

    filename = history.filename
    filepath = Path(settings.BACKUP_DIR) / filename
    if filepath.exists():
        filepath.unlink()
    db.delete(history)
    db.commit()
    logger.info("Deleted backup: %s", filename)
    return filename




def set_backup_scheduler_refresh(callback: Callable[[], None]) -> None:
    global _scheduler_refresh_callback
    _scheduler_refresh_callback = callback


def notify_backup_schedule_changed() -> None:
    if _scheduler_refresh_callback:
        _scheduler_refresh_callback()


def _ensure_default_config(db: Session) -> AppBackupConfig:
    config = db.get(AppBackupConfig, 1)
    if config:
        return config
    config = AppBackupConfig(
        id=1,
        schedule_enabled=False,
        cron_expression="0 2 * * *",
        timezone="UTC",
        retention_count=10,
        updated_at=_now(),
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


def apply_backup_schedule(db: Session, scheduler: BackgroundScheduler) -> None:
    """Read backup schedule config from DB and apply to the APScheduler instance."""
    config = _ensure_default_config(db)
    job_id = settings.BACKUP_SCHEDULER_JOB_ID
    existing = scheduler.get_job(job_id)
    if existing:
        scheduler.remove_job(job_id)
    if not config.schedule_enabled:
        return

    trigger = CronTrigger.from_crontab(config.cron_expression, timezone=config.timezone)

    def scheduled_runner() -> None:
        run_backup_thread(trigger_source="scheduled")

    scheduler.add_job(scheduled_runner, trigger=trigger, id=job_id, replace_existing=True)




def get_backup_config(db: Session) -> AppBackupConfig:
    return _ensure_default_config(db)


def get_backup_filepath(db: Session, backup_id: int) -> tuple[str, str]:
    """Return (filepath, filename) for a backup, or raise ValueError."""
    history = db.get(AppBackupHistory, backup_id)
    if not history:
        raise ValueError(f"Backup {backup_id} not found")
    if history.status != "completed":
        raise ValueError(f"Cannot download backup with status '{history.status}'")
    filepath = str(Path(settings.BACKUP_DIR) / history.filename)
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"Backup file not found: {history.filename}")
    return filepath, history.filename
