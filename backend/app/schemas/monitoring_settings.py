from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from app.models.monitoring import MonitoringAuthType, SecretInjectionMode


def _validate_http_url(value: Optional[str], *, field_name: str) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    if cleaned and not cleaned.startswith(("http://", "https://")):
        raise ValueError(f"{field_name} must start with http:// or https://")
    return cleaned.rstrip("/") if cleaned else None


class MonitoringBackendSettingsRead(BaseModel):
    enabled: bool
    url: Optional[str] = None
    timeout_seconds: int
    verify_tls: bool
    auth_type: MonitoringAuthType
    username: Optional[str] = None
    has_password: bool = False
    has_bearer_token: bool = False


class MonitoringBackendSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    url: Optional[str] = None
    timeout_seconds: Optional[int] = None
    verify_tls: Optional[bool] = None
    auth_type: Optional[MonitoringAuthType] = None
    username: Optional[str] = None
    password: Optional[str] = None
    bearer_token: Optional[str] = None

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: Optional[str]) -> Optional[str]:
        return _validate_http_url(value, field_name="url")


class MonitoringBitwardenSettingsRead(BaseModel):
    enabled: bool
    server_url: Optional[str] = None
    has_access_token: bool = False
    verify_tls: bool
    organization_id: Optional[str] = None
    collection_id: Optional[str] = None
    auth_method: str


class MonitoringBitwardenSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    server_url: Optional[str] = None
    access_token: Optional[str] = None
    verify_tls: Optional[bool] = None
    organization_id: Optional[str] = None
    collection_id: Optional[str] = None
    auth_method: Optional[str] = None

    @field_validator("server_url")
    @classmethod
    def validate_server_url(cls, value: Optional[str]) -> Optional[str]:
        return _validate_http_url(value, field_name="server_url")


class MonitoringSettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    prometheus: MonitoringBackendSettingsRead
    loki: MonitoringBackendSettingsRead
    bitwarden: MonitoringBitwardenSettingsRead
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class MonitoringSettingsUpdate(BaseModel):
    prometheus: Optional[MonitoringBackendSettingsUpdate] = None
    loki: Optional[MonitoringBackendSettingsUpdate] = None
    bitwarden: Optional[MonitoringBitwardenSettingsUpdate] = None

    @model_validator(mode="after")
    def require_at_least_one_section(self) -> "MonitoringSettingsUpdate":
        if self.prometheus is None and self.loki is None and self.bitwarden is None:
            raise ValueError("At least one monitoring settings section is required")
        return self


class MonitoringSecretMappingCreate(BaseModel):
    name: str
    job_template_id: Optional[int] = None
    item_reference: str
    item_field: str = "password"
    ansible_var_name: str
    injection_mode: SecretInjectionMode = SecretInjectionMode.extra_vars
    is_enabled: bool = True


class MonitoringSecretMappingUpdate(BaseModel):
    name: Optional[str] = None
    job_template_id: Optional[int] = None
    item_reference: Optional[str] = None
    item_field: Optional[str] = None
    ansible_var_name: Optional[str] = None
    injection_mode: Optional[SecretInjectionMode] = None
    is_enabled: Optional[bool] = None


class MonitoringSecretMappingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    job_template_id: Optional[int] = None
    item_reference: str
    item_field: str
    ansible_var_name: str
    injection_mode: SecretInjectionMode
    is_enabled: bool
    created_at: datetime
    updated_at: datetime
