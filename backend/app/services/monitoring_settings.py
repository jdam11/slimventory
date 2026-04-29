from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models.monitoring import MonitoringAuthType, MonitoringSecretMapping, MonitoringSettings, SecretInjectionMode
from app.schemas.monitoring_settings import (
    MonitoringBackendSettingsRead,
    MonitoringBitwardenSettingsRead,
    MonitoringSecretMappingRead,
    MonitoringSettingsRead,
)
from app.services.field_encryption import decrypt_field_value, encrypt_field_value


@dataclass
class BackendConnection:
    enabled: bool
    url: Optional[str]
    timeout_seconds: int
    verify_tls: bool
    auth_type: MonitoringAuthType
    username: Optional[str] = None
    password: Optional[str] = None
    bearer_token: Optional[str] = None


@dataclass
class BitwardenConnection:
    enabled: bool
    server_url: Optional[str]
    access_token: Optional[str]
    verify_tls: bool
    organization_id: Optional[str] = None
    collection_id: Optional[str] = None
    auth_method: str = "token"


@dataclass
class MonitoringSettingsSnapshot:
    prometheus: BackendConnection
    loki: BackendConnection
    bitwarden: BitwardenConnection
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


@dataclass
class RuntimeSecretHandoff:
    extra_vars: dict[str, Any]
    vault_password: Optional[str]
    resolved_mappings: list[dict[str, Any]]


class MonitoringSettingsError(RuntimeError):
    pass


class BitwardenSecretClient:
    def __init__(self, connection: BitwardenConnection):
        if not connection.enabled:
            raise MonitoringSettingsError("Bitwarden/Vaultwarden integration is disabled")
        if not connection.server_url:
            raise MonitoringSettingsError("Bitwarden/Vaultwarden server URL is not configured")
        if not connection.access_token:
            raise MonitoringSettingsError("Bitwarden/Vaultwarden access token is not configured")
        self.connection = connection

    def _client(self) -> httpx.Client:
        headers = {
            "Authorization": f"Bearer {self.connection.access_token}",
            "Accept": "application/json",
        }
        return httpx.Client(
            base_url=self.connection.server_url,
            timeout=httpx.Timeout(30.0, connect=10.0),
            verify=self.connection.verify_tls,
            headers=headers,
        )

    def _first_payload_item(self, payload: Any) -> Any:
        if isinstance(payload, dict):
            if isinstance(payload.get("data"), list) and payload["data"]:
                return payload["data"][0]
            if isinstance(payload.get("data"), dict):
                return payload["data"]
            if isinstance(payload.get("items"), list) and payload["items"]:
                return payload["items"][0]
        if isinstance(payload, list) and payload:
            return payload[0]
        return payload

    def _request_json(self, client: httpx.Client, path: str, params: Optional[dict[str, Any]] = None) -> Any:
        try:
            response = client.get(path, params=params)
            response.raise_for_status()
            return response.json()
        except Exception as exc:  # noqa: BLE001
            raise MonitoringSettingsError(str(exc)) from exc

    def _candidate_paths(self, item_reference: str) -> list[tuple[str, Optional[dict[str, Any]]]]:
        params: dict[str, Any] = {"search": item_reference}
        if self.connection.organization_id:
            params["organizationId"] = self.connection.organization_id
        if self.connection.collection_id:
            params["collectionId"] = self.connection.collection_id
        return [
            (f"/api/items/{item_reference}", None),
            ("/api/items", params),
            ("/api/list/object/items", params),
            ("/api/search", {"query": item_reference}),
        ]

    def resolve_item(self, item_reference: str) -> dict[str, Any]:
        with self._client() as client:
            last_exc: Exception | None = None
            for path, params in self._candidate_paths(item_reference):
                try:
                    payload = self._request_json(client, path, params)
                    item = self._first_payload_item(payload)
                    if isinstance(item, dict) and item:
                        return item
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code == 404:
                        last_exc = exc
                        continue
                    raise MonitoringSettingsError(
                        f"Bitwarden/Vaultwarden request failed for {item_reference}: {exc.response.status_code}"
                    ) from exc
                except Exception as exc:  # noqa: BLE001
                    last_exc = exc
            raise MonitoringSettingsError(
                f"Unable to resolve Bitwarden/Vaultwarden item {item_reference!r}"
            ) from last_exc

    def resolve_field(self, item_reference: str, field_name: str) -> str:
        item = self.resolve_item(item_reference)
        value = _extract_item_field(item, field_name)
        if value is None:
            raise MonitoringSettingsError(
                f"Bitwarden/Vaultwarden item {item_reference!r} does not contain field {field_name!r}"
            )
        return value


def _extract_item_field(item: dict[str, Any], field_name: str) -> Optional[str]:
    field = field_name.strip() or "password"
    if field == "password":
        login = item.get("login")
        if isinstance(login, dict):
            password = login.get("password")
            if isinstance(password, str) and password:
                return password
        password = item.get("password")
        if isinstance(password, str) and password:
            return password

    current: Any = item
    for part in field.split("."):
        if not isinstance(current, dict):
            current = None
            break
        current = current.get(part)
    if isinstance(current, str) and current:
        return current

    fields = item.get("fields")
    if isinstance(fields, list):
        for candidate in fields:
            if not isinstance(candidate, dict):
                continue
            candidate_name = str(candidate.get("name") or candidate.get("label") or candidate.get("fieldName") or "")
            if candidate_name == field:
                value = candidate.get("value")
                if isinstance(value, str) and value:
                    return value
    return None


def _singleton_row(db: Session) -> MonitoringSettings | None:
    return db.execute(select(MonitoringSettings).order_by(MonitoringSettings.id.asc())).scalars().first()


def _decrypt_or_none(value: Optional[str]) -> Optional[str]:
    decrypted = decrypt_field_value(value)
    return decrypted if decrypted else None


def _clean_optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _backend_from_row(
    row: MonitoringSettings | None,
    *,
    prefix: str,
    enabled_default: bool,
    url_default: Optional[str],
    timeout_default: int,
) -> BackendConnection:
    enabled = bool(getattr(row, f"{prefix}_enabled", enabled_default)) if row is not None else enabled_default
    url = getattr(row, f"{prefix}_url", url_default) if row is not None else url_default
    timeout_seconds = (
        int(getattr(row, f"{prefix}_timeout_seconds", timeout_default)) if row is not None else timeout_default
    )
    verify_tls = bool(getattr(row, f"{prefix}_verify_tls", True)) if row is not None else True
    auth_type = (
        getattr(row, f"{prefix}_auth_type", MonitoringAuthType.none) if row is not None else MonitoringAuthType.none
    )
    if isinstance(auth_type, str):
        auth_type = MonitoringAuthType(auth_type)
    username = getattr(row, f"{prefix}_username", None) if row is not None else None
    password = _decrypt_or_none(getattr(row, f"{prefix}_password", None)) if row is not None else None
    bearer_token = _decrypt_or_none(getattr(row, f"{prefix}_bearer_token", None)) if row is not None else None
    return BackendConnection(
        enabled=enabled,
        url=url,
        timeout_seconds=timeout_seconds,
        verify_tls=verify_tls,
        auth_type=auth_type,
        username=username,
        password=password,
        bearer_token=bearer_token,
    )


def _bitwarden_from_row(row: MonitoringSettings | None) -> BitwardenConnection:
    if row is None:
        return BitwardenConnection(
            enabled=False,
            server_url=None,
            access_token=None,
            verify_tls=True,
            organization_id=None,
            collection_id=None,
            auth_method="token",
        )
    return BitwardenConnection(
        enabled=bool(row.bitwarden_enabled),
        server_url=row.bitwarden_server_url,
        access_token=_decrypt_or_none(row.bitwarden_access_token),
        verify_tls=bool(row.bitwarden_verify_tls),
        organization_id=row.bitwarden_organization_id,
        collection_id=row.bitwarden_collection_id,
        auth_method=row.bitwarden_auth_method or "token",
    )


def get_monitoring_settings_snapshot(db: Session | None = None) -> MonitoringSettingsSnapshot:
    session = db
    created_session = False
    if session is None:
        session = SessionLocal()
        created_session = True
    try:
        row = _singleton_row(session)
    except Exception:  # noqa: BLE001
        row = None
    finally:
        if created_session:
            session.close()

    return MonitoringSettingsSnapshot(
        prometheus=_backend_from_row(
            row,
            prefix="prometheus",
            enabled_default=bool(settings.MONITORING_PROMETHEUS_URL),
            url_default=settings.MONITORING_PROMETHEUS_URL,
            timeout_default=settings.MONITORING_TIMEOUT_SECONDS,
        ),
        loki=_backend_from_row(
            row,
            prefix="loki",
            enabled_default=bool(settings.MONITORING_LOKI_URL),
            url_default=settings.MONITORING_LOKI_URL,
            timeout_default=settings.MONITORING_TIMEOUT_SECONDS,
        ),
        bitwarden=_bitwarden_from_row(row),
        created_at=row.created_at if row is not None else None,
        updated_at=row.updated_at if row is not None else None,
    )


def get_monitoring_settings_read(db: Session | None = None) -> MonitoringSettingsRead:
    snapshot = get_monitoring_settings_snapshot(db)
    return MonitoringSettingsRead(
        prometheus=MonitoringBackendSettingsRead(
            enabled=snapshot.prometheus.enabled,
            url=snapshot.prometheus.url,
            timeout_seconds=snapshot.prometheus.timeout_seconds,
            verify_tls=snapshot.prometheus.verify_tls,
            auth_type=snapshot.prometheus.auth_type,
            username=snapshot.prometheus.username,
            has_password=bool(snapshot.prometheus.password),
            has_bearer_token=bool(snapshot.prometheus.bearer_token),
        ),
        loki=MonitoringBackendSettingsRead(
            enabled=snapshot.loki.enabled,
            url=snapshot.loki.url,
            timeout_seconds=snapshot.loki.timeout_seconds,
            verify_tls=snapshot.loki.verify_tls,
            auth_type=snapshot.loki.auth_type,
            username=snapshot.loki.username,
            has_password=bool(snapshot.loki.password),
            has_bearer_token=bool(snapshot.loki.bearer_token),
        ),
        bitwarden=MonitoringBitwardenSettingsRead(
            enabled=snapshot.bitwarden.enabled,
            server_url=snapshot.bitwarden.server_url,
            has_access_token=bool(snapshot.bitwarden.access_token),
            verify_tls=snapshot.bitwarden.verify_tls,
            organization_id=snapshot.bitwarden.organization_id,
            collection_id=snapshot.bitwarden.collection_id,
            auth_method=snapshot.bitwarden.auth_method,
        ),
        created_at=snapshot.created_at,
        updated_at=snapshot.updated_at,
    )


def _ensure_row(db: Session) -> MonitoringSettings:
    row = _singleton_row(db)
    if row is None:
        row = MonitoringSettings()
        db.add(row)
        db.flush()
    return row


def update_monitoring_settings(
    db: Session,
    *,
    prometheus: dict[str, Any] | None = None,
    loki: dict[str, Any] | None = None,
    bitwarden: dict[str, Any] | None = None,
) -> MonitoringSettings:
    row = _ensure_row(db)

    for prefix, payload in (("prometheus", prometheus), ("loki", loki)):
        if payload is None:
            continue
        for key, value in payload.items():
            if key in {"password", "bearer_token"}:
                setattr(row, f"{prefix}_{key}", encrypt_field_value(value) if _clean_optional_text(value) else None)
            else:
                if key in {"url", "username"}:
                    setattr(row, f"{prefix}_{key}", _clean_optional_text(value))
                else:
                    setattr(row, f"{prefix}_{key}", value)

    if bitwarden is not None:
        for key, value in bitwarden.items():
            if key == "access_token":
                row.bitwarden_access_token = encrypt_field_value(value) if _clean_optional_text(value) else None
                continue
            if key in {"server_url", "organization_id", "collection_id"}:
                setattr(row, f"bitwarden_{key}", _clean_optional_text(value))
            else:
                setattr(row, f"bitwarden_{key}", value)

    _validate_monitoring_settings(row)

    db.commit()
    db.refresh(row)
    return row


def _validate_monitoring_settings(row: MonitoringSettings) -> None:
    for prefix in ("prometheus", "loki"):
        enabled = bool(getattr(row, f"{prefix}_enabled"))
        url = getattr(row, f"{prefix}_url")
        timeout_seconds = int(getattr(row, f"{prefix}_timeout_seconds"))
        auth_type = getattr(row, f"{prefix}_auth_type")
        if isinstance(auth_type, str):
            auth_type = MonitoringAuthType(auth_type)
        if timeout_seconds < 1:
            raise MonitoringSettingsError(f"{prefix.title()} timeout must be at least 1 second")
        if enabled and not url:
            raise MonitoringSettingsError(f"{prefix.title()} URL is required when enabled")
        if enabled and auth_type == MonitoringAuthType.basic:
            if not getattr(row, f"{prefix}_username"):
                raise MonitoringSettingsError(f"{prefix.title()} username is required for basic auth")
            if not _decrypt_or_none(getattr(row, f"{prefix}_password")):
                raise MonitoringSettingsError(f"{prefix.title()} password is required for basic auth")
        if (
            enabled
            and auth_type == MonitoringAuthType.bearer
            and not _decrypt_or_none(getattr(row, f"{prefix}_bearer_token"))
        ):
            raise MonitoringSettingsError(f"{prefix.title()} bearer token is required for bearer auth")

    if row.bitwarden_enabled:
        if not row.bitwarden_server_url:
            raise MonitoringSettingsError("Bitwarden/Vaultwarden server URL is required when enabled")
        if not _decrypt_or_none(row.bitwarden_access_token):
            raise MonitoringSettingsError("Bitwarden/Vaultwarden access token is required when enabled")


def list_secret_mappings(db: Session, *, job_template_id: int | None = None) -> list[MonitoringSecretMapping]:
    q = select(MonitoringSecretMapping).order_by(MonitoringSecretMapping.name.asc())
    if job_template_id is None:
        q = q.where(MonitoringSecretMapping.job_template_id.is_(None))
    else:
        q = q.where(
            (MonitoringSecretMapping.job_template_id.is_(None))
            | (MonitoringSecretMapping.job_template_id == job_template_id)
        )
    return list(db.execute(q).scalars().all())


def get_secret_mapping(db: Session, mapping_id: int) -> MonitoringSecretMapping | None:
    return db.get(MonitoringSecretMapping, mapping_id)


def create_secret_mapping(db: Session, **data: Any) -> MonitoringSecretMapping:
    mapping = MonitoringSecretMapping(**data)
    db.add(mapping)
    db.commit()
    db.refresh(mapping)
    return mapping


def update_secret_mapping(db: Session, mapping: MonitoringSecretMapping, **data: Any) -> MonitoringSecretMapping:
    for key, value in data.items():
        setattr(mapping, key, value)
    db.commit()
    db.refresh(mapping)
    return mapping


def delete_secret_mapping(db: Session, mapping: MonitoringSecretMapping) -> None:
    db.delete(mapping)
    db.commit()


def to_secret_mapping_read(mapping: MonitoringSecretMapping) -> MonitoringSecretMappingRead:
    return MonitoringSecretMappingRead.model_validate(mapping)


def _runtime_mappings(db: Session, job_template_id: int | None) -> list[MonitoringSecretMapping]:
    q = select(MonitoringSecretMapping).where(MonitoringSecretMapping.is_enabled.is_(True))
    if job_template_id is None:
        q = q.where(MonitoringSecretMapping.job_template_id.is_(None))
    else:
        q = q.where(
            (MonitoringSecretMapping.job_template_id.is_(None))
            | (MonitoringSecretMapping.job_template_id == job_template_id)
        )
    return list(db.execute(q.order_by(MonitoringSecretMapping.name.asc())).scalars().all())


def resolve_runtime_secret_handoff(db: Session, *, job_template_id: int | None = None) -> RuntimeSecretHandoff:
    snapshot = get_monitoring_settings_snapshot(db)
    mappings = _runtime_mappings(db, job_template_id)
    if not mappings:
        return RuntimeSecretHandoff(extra_vars={}, vault_password=None, resolved_mappings=[])
    if not snapshot.bitwarden.enabled:
        raise MonitoringSettingsError("Bitwarden/Vaultwarden integration is disabled")

    client = BitwardenSecretClient(snapshot.bitwarden)
    extra_vars: dict[str, Any] = {}
    vault_password_values: list[str] = []
    resolved: list[dict[str, Any]] = []

    for mapping in mappings:
        value = client.resolve_field(mapping.item_reference, mapping.item_field)
        resolved.append(
            {
                "mapping_id": mapping.id,
                "name": mapping.name,
                "ansible_var_name": mapping.ansible_var_name,
                "injection_mode": mapping.injection_mode.value,
            }
        )
        if mapping.injection_mode == SecretInjectionMode.vault_password_file:
            vault_password_values.append(value)
            continue
        extra_vars[mapping.ansible_var_name] = value

    if len(vault_password_values) > 1:
        raise MonitoringSettingsError("Only one vault_password_file secret mapping can be used per run")

    vault_password = vault_password_values[0] if vault_password_values else None
    return RuntimeSecretHandoff(
        extra_vars=extra_vars,
        vault_password=vault_password,
        resolved_mappings=resolved,
    )


def _merge_auth_headers(connection: BackendConnection) -> dict[str, str]:
    headers: dict[str, str] = {"Accept": "application/json"}
    if connection.auth_type == MonitoringAuthType.bearer and connection.bearer_token:
        headers["Authorization"] = f"Bearer {connection.bearer_token}"
    return headers


def _client_for_backend(connection: BackendConnection) -> httpx.Client:
    auth: tuple[str, str] | None = None
    if connection.auth_type == MonitoringAuthType.basic and connection.username and connection.password:
        auth = (connection.username, connection.password)
    return httpx.Client(
        base_url=connection.url or "",
        timeout=httpx.Timeout(connection.timeout_seconds, connect=min(connection.timeout_seconds, 10)),
        verify=connection.verify_tls,
        headers=_merge_auth_headers(connection),
        auth=auth,
    )


def request_backend_json(connection: BackendConnection, path: str, params: Optional[dict[str, Any]] = None) -> Any:
    if not connection.enabled or not connection.url:
        return {}
    try:
        with _client_for_backend(connection) as client:
            response = client.get(path, params=params)
            response.raise_for_status()
            return response.json()
    except Exception as exc:  # noqa: BLE001
        raise MonitoringSettingsError(str(exc)) from exc


def request_backend_status(connection: BackendConnection, path: str) -> bool:
    if not connection.enabled or not connection.url:
        return False
    try:
        with _client_for_backend(connection) as client:
            response = client.get(path)
            if response.status_code == 503:
                return False
            response.raise_for_status()
            return 200 <= response.status_code < 300
    except Exception as exc:  # noqa: BLE001
        raise MonitoringSettingsError(str(exc)) from exc


def build_bitwarden_query_params(connection: BitwardenConnection, item_reference: str) -> dict[str, Any]:
    params: dict[str, Any] = {"search": item_reference}
    if connection.organization_id:
        params["organizationId"] = connection.organization_id
    if connection.collection_id:
        params["collectionId"] = connection.collection_id
    return params
