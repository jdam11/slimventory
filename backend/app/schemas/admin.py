from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict

from app.models.auth import InventoryApiKeyPermission


class LogLevelRead(BaseModel):
    log_level: str


class LogLevelUpdate(BaseModel):
    log_level: str


class InventoryApiKeyCreate(BaseModel):
    name: str
    description: Optional[str] = None
    permissions: List[InventoryApiKeyPermission]
    is_active: bool = True


class InventoryApiKeyUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    permissions: Optional[List[InventoryApiKeyPermission]] = None
    is_active: Optional[bool] = None


class InventoryApiKeyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: Optional[str] = None
    key_prefix: str
    permissions: List[InventoryApiKeyPermission]
    is_active: bool
    last_used_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    created_by_user_id: Optional[int] = None


class InventoryApiKeySecretRead(BaseModel):
    api_key: str
    key: InventoryApiKeyRead


class AnsibleRunnerSettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kerberos_enabled: bool
    kerberos_krb5_conf: Optional[str] = None
    kerberos_ccache_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class AnsibleRunnerSettingsUpdate(BaseModel):
    kerberos_enabled: Optional[bool] = None
    kerberos_krb5_conf: Optional[str] = None
    kerberos_ccache_name: Optional[str] = None


class SshKnownHostCacheRead(BaseModel):
    path: str
    exists: bool
    size_bytes: int
    line_count: int
    modified_at: Optional[datetime] = None


class SshKnownHostsSummaryRead(BaseModel):
    ansible: SshKnownHostCacheRead
    git: SshKnownHostCacheRead


class ClearedKnownHostsRead(BaseModel):
    target: str
    aliases: List[str]
    cache: SshKnownHostCacheRead
