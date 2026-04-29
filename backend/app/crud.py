from typing import Any, Dict, List, Tuple, Type, TypeVar

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

ModelT = TypeVar("ModelT")


def list_records(db: Session, model: Type[ModelT], skip: int = 0, limit: int = 100) -> Tuple[List[Any], int]:
    total = db.scalar(select(func.count()).select_from(model)) or 0
    items = db.execute(select(model).offset(skip).limit(limit)).scalars().all()
    return list(items), total


def get_or_404(db: Session, model: Type[ModelT], record_id: Any) -> Any:
    obj = db.get(model, record_id)
    if obj is None:
        raise HTTPException(
            status_code=404,
            detail=f"{getattr(model, '__tablename__', model.__name__)} not found",
        )
    return obj


def create_record(db: Session, model: Type[ModelT], data: Dict[str, Any]) -> Any:
    obj = model(**data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


def update_record(db: Session, obj: Any, data: Dict[str, Any]) -> Any:
    for key, value in data.items():
        setattr(obj, key, value)
    db.commit()
    db.refresh(obj)
    return obj


def delete_record(db: Session, obj: Any) -> None:
    db.delete(obj)
    db.commit()
