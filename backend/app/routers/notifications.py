from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.crud import delete_record, get_or_404
from app.database import get_db
from app.deps import require_admin
from app.models.auth import AppUser
from app.models.notifications import NotificationChannel
from app.schemas.inventory import PageResponse
from app.schemas.notifications import (
    NotificationChannelCreate,
    NotificationChannelRead,
    NotificationChannelUpdate,
    NotificationTestResult,
)
from app.services.field_encryption import encrypt_field_value
from app.services.notifications import EVENT_KEYS, send_test

router = APIRouter(prefix="/notification-channels", tags=["notifications"])


def _to_read(channel: NotificationChannel) -> NotificationChannelRead:
    return NotificationChannelRead(
        id=channel.id,
        name=channel.name,
        type=channel.type,
        url=channel.url,
        events=channel.events or [],
        enabled=channel.enabled,
        has_secret=bool(channel.secret_encrypted),
        created_at=channel.created_at,
    )


@router.get("/event-keys", response_model=list[str])
def list_event_keys(_: AppUser = Depends(require_admin)):
    return EVENT_KEYS


@router.get("/", response_model=PageResponse[NotificationChannelRead])
def list_channels(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    items = db.query(NotificationChannel).order_by(NotificationChannel.name.asc()).offset(skip).limit(limit).all()
    total = db.query(NotificationChannel).count()
    return {"items": [_to_read(item) for item in items], "total": total}


@router.get("/{channel_id}", response_model=NotificationChannelRead)
def get_channel(
    channel_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    return _to_read(get_or_404(db, NotificationChannel, channel_id))


@router.post("/", response_model=NotificationChannelRead, status_code=status.HTTP_201_CREATED)
def create_channel(
    body: NotificationChannelCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    channel = NotificationChannel(
        name=body.name,
        type=body.type,
        url=body.url,
        events=body.events,
        enabled=body.enabled,
        secret_encrypted=encrypt_field_value(body.secret) if body.secret else None,
    )
    db.add(channel)
    db.commit()
    db.refresh(channel)
    return _to_read(channel)


@router.patch("/{channel_id}", response_model=NotificationChannelRead)
def update_channel(
    channel_id: int,
    body: NotificationChannelUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    channel = get_or_404(db, NotificationChannel, channel_id)
    data = body.model_dump(exclude_unset=True)
    for field in ("name", "type", "url", "events", "enabled"):
        if field in data:
            setattr(channel, field, data[field])
    if "secret" in data:
        channel.secret_encrypted = encrypt_field_value(data["secret"]) if data["secret"] else None
    db.commit()
    db.refresh(channel)
    return _to_read(channel)


@router.delete("/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_channel(
    channel_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    delete_record(db, get_or_404(db, NotificationChannel, channel_id))


@router.post("/{channel_id}/test", response_model=NotificationTestResult)
def test_channel(
    channel_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    channel = get_or_404(db, NotificationChannel, channel_id)
    ok, detail = send_test(channel)
    return NotificationTestResult(ok=ok, detail=detail)
