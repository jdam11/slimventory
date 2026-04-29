from sqlalchemy import BigInteger, Boolean, Column, DateTime, Integer, String, Text

from .base import Base


class AppBackupConfig(Base):
    __tablename__ = "app_backup_config"

    id = Column(Integer, primary_key=True)
    schedule_enabled = Column(Boolean, nullable=False, default=False)
    cron_expression = Column(String(128), nullable=False, default="0 2 * * *")
    timezone = Column(String(64), nullable=False, default="UTC")
    retention_count = Column(Integer, nullable=False, default=10)
    updated_at = Column(DateTime, nullable=False)


class AppBackupHistory(Base):
    __tablename__ = "app_backup_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    filename = Column(String(255), unique=True, nullable=False)
    size_bytes = Column(BigInteger, nullable=False, default=0)
    status = Column(String(32), nullable=False)
    trigger_source = Column(String(32), nullable=False)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=False)
    completed_at = Column(DateTime, nullable=True)
    created_by = Column(String(64), nullable=True)
