"""
Idempotent seed script — creates bootstrap admin and readonly users and default
git repos if absent.
Run via: uv run python seed.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from app.config import settings
from app.database import SessionLocal
from app.models.auth import AppUser, UserRole
from app.models.git import GitAuthType, GitRepo, GitRepoType
from app.security import hash_password


def seed() -> None:
    db = SessionLocal()
    try:
        # ── Bootstrap users ────────────────────────────────────────────────────
        bootstrap = [
            (settings.ADMIN_USERNAME, settings.ADMIN_PASSWORD, UserRole.admin),
            (settings.READONLY_USERNAME, settings.READONLY_PASSWORD, UserRole.readonly),
        ]
        created = skipped = 0
        for username, password, role in bootstrap:
            existing = db.query(AppUser).filter(AppUser.username == username).first()
            if not existing:
                db.add(AppUser(username=username, hashed_password=hash_password(password), role=role))
                created += 1
            else:
                skipped += 1
        print(f"Bootstrap users: {created} created, {skipped} already existed")

        # ── Default app repository ─────────────────────────────────────────────
        if settings.DEFAULT_APP_REPO_URL:
            existing_repo = (
                db.query(GitRepo)
                .filter(GitRepo.url == settings.DEFAULT_APP_REPO_URL)
                .first()
            )
            if not existing_repo:
                repo = GitRepo(
                    name=settings.DEFAULT_APP_REPO_NAME,
                    url=settings.DEFAULT_APP_REPO_URL,
                    branch="main",
                    repo_type=GitRepoType.app,
                    auth_type=GitAuthType.none,
                )
                db.add(repo)
                print(f"Created default app repo: {settings.DEFAULT_APP_REPO_NAME} ({settings.DEFAULT_APP_REPO_URL})")
            else:
                print(f"Default app repo already exists: {existing_repo.name} — skipped")

        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    seed()
