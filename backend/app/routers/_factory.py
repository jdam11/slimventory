"""
Generic CRUD router factory for simple lookup tables.
Generates: GET list, GET one, POST (admin), PATCH (admin), DELETE (admin).
"""

from typing import Type

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.crud import create_record, delete_record, get_or_404, list_records, update_record
from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.schemas.inventory import PageResponse


def make_crud_router(
    prefix: str,
    tag: str,
    Model: Type,
    CreateSchema: Type,
    UpdateSchema: Type,
    ReadSchema: Type,
) -> APIRouter:
    router = APIRouter(prefix=f"/{prefix}", tags=[tag])

    @router.get("/", response_model=PageResponse[ReadSchema])  # type: ignore[valid-type]
    def list_all(
        skip: int = Query(default=0, ge=0),
        limit: int = Query(default=100, ge=1, le=1000),
        db: Session = Depends(get_db),
        _: AppUser = Depends(require_authenticated),
    ):
        items, total = list_records(db, Model, skip, limit)
        return {"items": items, "total": total}

    @router.get("/{record_id}", response_model=ReadSchema)
    def get_one(
        record_id: int,
        db: Session = Depends(get_db),
        _: AppUser = Depends(require_authenticated),
    ):
        return get_or_404(db, Model, record_id)

    @router.post("/", response_model=ReadSchema, status_code=status.HTTP_201_CREATED)
    def create(
        body: CreateSchema,  # type: ignore[valid-type]
        db: Session = Depends(get_db),
        _: AppUser = Depends(require_admin),
    ):
        return create_record(db, Model, body.model_dump())

    @router.patch("/{record_id}", response_model=ReadSchema)
    def update(
        record_id: int,
        body: UpdateSchema,  # type: ignore[valid-type]
        db: Session = Depends(get_db),
        _: AppUser = Depends(require_admin),
    ):
        obj = get_or_404(db, Model, record_id)
        return update_record(db, obj, body.model_dump(exclude_unset=True))

    @router.delete("/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete(
        record_id: int,
        db: Session = Depends(get_db),
        _: AppUser = Depends(require_admin),
    ):
        obj = get_or_404(db, Model, record_id)
        delete_record(db, obj)

    return router
