from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.audit import (
    log_login_failed,
    log_login_success,
    log_logout,
    log_password_change,
    log_password_change_failed,
    log_user_created,
    log_user_deleted,
    log_user_updated,
)
from app.config import settings
from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.rate_limit import limiter
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    TokenResponse,
    UserCreate,
    UserRead,
    UserUpdate,
)
from app.security import (
    create_access_token,
    hash_password,
    needs_update,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

_COOKIE = "access_token"
_COOKIE_MAX_AGE = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60


def _make_tokens(user: AppUser) -> dict:
    token = create_access_token(user.username, user.role.value)
    return {"access_token": token, "token_type": "bearer", "role": user.role.value, "username": user.username}


def _authenticate(request: Request, db: Session, username: str, password: str) -> AppUser:
    user = db.query(AppUser).filter(AppUser.username == username).first()
    if not user or not verify_password(password, user.hashed_password):
        log_login_failed(request, username)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        log_login_failed(request, username, reason="account_disabled")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")
    # Transparently upgrade deprecated password hashes (e.g. pbkdf2 → bcrypt)
    if needs_update(user.hashed_password):
        user.hashed_password = hash_password(password)
        db.commit()
    return user




@router.post("/token", response_model=TokenResponse, include_in_schema=False)
@limiter.limit("5/minute")
def token_form(
    request: Request,
    form: OAuth2PasswordRequestForm = Depends(),
    response: Response = ...,
    db: Session = Depends(get_db),
):
    user = _authenticate(request, db, form.username, form.password)
    log_login_success(request, user.username)
    data = _make_tokens(user)
    response.set_cookie(
        _COOKIE,
        data["access_token"],
        max_age=_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=settings.SECURE_COOKIES,
    )
    return data




@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(request: Request, body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = _authenticate(request, db, body.username, body.password)
    log_login_success(request, user.username)
    data = _make_tokens(user)
    response.set_cookie(
        _COOKIE,
        data["access_token"],
        max_age=_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=settings.SECURE_COOKIES,
    )
    return data


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    user: AppUser = Depends(require_authenticated),
):
    log_logout(request, user.username)
    response.delete_cookie(_COOKIE)


@router.get("/me", response_model=UserRead)
def me(user: AppUser = Depends(require_authenticated)):
    return user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    request: Request,
    body: ChangePasswordRequest,
    user: AppUser = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    if not verify_password(body.old_password, user.hashed_password):
        log_password_change_failed(request, user.username)
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.hashed_password = hash_password(body.new_password)
    db.commit()
    log_password_change(request, user.username)




@router.get("/users", response_model=List[UserRead])
def list_users(db: Session = Depends(get_db), _: AppUser = Depends(require_admin)):
    return db.query(AppUser).all()


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    request: Request,
    body: UserCreate,
    db: Session = Depends(get_db),
    admin: AppUser = Depends(require_admin),
):
    if db.query(AppUser).filter(AppUser.username == body.username).first():
        raise HTTPException(status_code=409, detail="Username already exists")
    user = AppUser(
        username=body.username,
        email=body.email,
        hashed_password=hash_password(body.password),
        role=body.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    log_user_created(request, admin.username, user.username, user.role.value)
    return user


@router.patch("/users/{user_id}", response_model=UserRead)
def update_user(
    request: Request,
    user_id: int,
    body: UserUpdate,
    db: Session = Depends(get_db),
    admin: AppUser = Depends(require_admin),
):
    user = db.get(AppUser, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(user, k, v)
    db.commit()
    db.refresh(user)
    log_user_updated(request, admin.username, user_id)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    current: AppUser = Depends(require_admin),
):
    if user_id == current.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user = db.get(AppUser, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    target_username = user.username
    db.delete(user)
    db.commit()
    log_user_deleted(request, current.username, target_username)
