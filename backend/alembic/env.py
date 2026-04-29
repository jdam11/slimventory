from logging.config import fileConfig
import os
import sys

from alembic import context
from sqlalchemy import create_engine, pool

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.config import settings
from app.models.base import Base

# db/schema.sql is the first-release install baseline; Alembic owns public upgrades after revision 001.
import app.models.auth  # noqa: F401 — registers AppUser with Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def include_object(obj, name, type_, reflected, compare_to):
    """Only track tables represented by SQLAlchemy models."""
    if type_ == "table":
        return name in {"app_users", "inventory_api_keys"}
    return True


target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = settings.DATABASE_URL
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(
        settings.DATABASE_URL,
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
