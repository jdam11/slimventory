from typing import Optional

from fastapi import Cookie, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.orm import Session

from .audit import log_token_rejected
from .database import get_db
from .models.auth import AppUser, UserRole
from .security import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token", auto_error=False)

CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid or expired credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    request: Request,
    bearer: Optional[str] = Depends(oauth2_scheme),
    access_token: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
) -> AppUser:
    token = bearer or access_token
    if not token:
        log_token_rejected(request, "no_token")
        raise CREDENTIALS_EXCEPTION
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            log_token_rejected(request, "wrong_token_type")
            raise CREDENTIALS_EXCEPTION
        username: Optional[str] = payload.get("sub")
        if not username:
            log_token_rejected(request, "missing_subject")
            raise CREDENTIALS_EXCEPTION
    except JWTError:
        log_token_rejected(request, "invalid_or_expired_jwt")
        raise CREDENTIALS_EXCEPTION

    user = db.query(AppUser).filter(AppUser.username == username).first()
    if not user or not user.is_active:
        log_token_rejected(request, "user_not_found_or_inactive")
        raise CREDENTIALS_EXCEPTION
    return user


def require_admin(user: AppUser = Depends(get_current_user)) -> AppUser:
    if user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )
    return user


# Alias for readability in router signatures
require_authenticated = get_current_user
