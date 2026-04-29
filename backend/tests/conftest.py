"""
Pytest configuration for backend tests.

Uses an in-memory SQLite database — no MySQL required.
Required env vars are set before the app is imported.
"""
import os

# Set required env vars BEFORE importing app modules so pydantic-settings parses cleanly
os.environ.setdefault("DB_PASSWORD", "test")
os.environ.setdefault("SECRET_KEY", "test-secret-key-very-long-for-testing-purposes-only")
os.environ.setdefault("ADMIN_PASSWORD", "admintest1")
os.environ.setdefault("READONLY_PASSWORD", "readonlytest1")
os.environ.setdefault("TESTING", "true")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from unittest.mock import patch

from app.database import get_db
from app.main import app as fastapi_app
from app.models import ai as _ai_models  # noqa: F401
from app.models.base import Base
from app.models import auth as _auth_models  # noqa: F401
from app.models import git as _git_models  # noqa: F401
from app.models import monitoring as _monitoring_models  # noqa: F401
from app.models import inventory as _inventory_models  # noqa: F401
from app.models import job_templates as _job_template_models  # noqa: F401
from app.models.auth import AppUser, UserRole
from app.security import hash_password

SQLITE_URL = "sqlite+pysqlite:///:memory:"


@pytest.fixture
def engine():
    eng = create_engine(
        SQLITE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    yield eng
    Base.metadata.drop_all(eng)
    eng.dispose()


@pytest.fixture
def db(engine):
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.rollback()
    session.close()


@pytest.fixture
def client(db):
    def override_get_db():
        yield db

    fastapi_app.dependency_overrides[get_db] = override_get_db
    with patch("app.main.refresh_proxmox_schedule"):
        with TestClient(fastapi_app) as c:
            yield c
    fastapi_app.dependency_overrides.clear()


@pytest.fixture
def admin_user(db) -> AppUser:
    user = AppUser(
        username="testadmin",
        hashed_password=hash_password("adminpass"),
        role=UserRole.admin,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    yield user
    db.delete(user)
    db.commit()


@pytest.fixture
def readonly_user(db) -> AppUser:
    user = AppUser(
        username="testviewer",
        hashed_password=hash_password("viewerpass"),
        role=UserRole.readonly,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    yield user
    db.delete(user)
    db.commit()


@pytest.fixture
def admin_token(client, admin_user) -> str:
    r = client.post("/api/auth/login", json={"username": "testadmin", "password": "adminpass"})
    assert r.status_code == 200
    return r.json()["access_token"]


@pytest.fixture
def readonly_token(client, readonly_user) -> str:
    r = client.post("/api/auth/login", json={"username": "testviewer", "password": "viewerpass"})
    assert r.status_code == 200
    return r.json()["access_token"]
