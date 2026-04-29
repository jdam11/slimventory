from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncGenerator
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.ai import (
    AiAgent,
    AiAgentTool,
    AiAgentType,
    AiConversation,
    AiFeatureSettings,
    AiMessage,
    AiMessageRole,
    AiProvider,
    AiProviderType,
    AiTool,
)
from app.models.auth import AppUser, UserRole
from app.models.git import AnsiblePlaybook, PlaybookHostSource, PlaybookRun
from app.models.inventory import App, Environment, Host, Role
from app.models.job_templates import JobTemplate
from app.schemas.ai import AiPageContext
from app.security import decrypt_secret, encrypt_secret
from app.services.monitoring import (
    MonitoringInventoryHost,
    get_loki_log_volume,
    get_prometheus_status,
    get_prometheus_target_summary,
)
from app.services.playbook_execution import create_playbook_run, launch_playbook_run

log = logging.getLogger(__name__)

FORBIDDEN_KEY_PATTERNS = (
    "password",
    "secret",
    "token",
    "api_key",
    "ssh",
    "vault",
    "cookie",
    "authorization",
)
ACTION_PATTERN = re.compile(r"<slim_action>(.*?)</slim_action>", re.DOTALL)
RUN_INTENT_PATTERN = re.compile(r"\b(run|execute|launch|start|restart|remediate|repair|fix)\b", re.IGNORECASE)
SYSTEM_PROMPT_MAX_LENGTH = 12_000
AGENT_ORDER = [
    AiAgentType.manager,
    AiAgentType.noc_monitor,
    AiAgentType.incident_responder,
    AiAgentType.automation_operator,
]
SYSTEM_AGENT_TYPES = set(AGENT_ORDER)
UNSET = object()
DEFAULT_CONVERSATION_TITLE = "New conversation"
CONVERSATION_TITLE_MAX_LENGTH = 80

DEFAULT_AGENT_DEFINITIONS: dict[AiAgentType, dict[str, Any]] = {
    AiAgentType.manager: {
        "agent_key": "manager",
        "name": "Manager",
        "description": (
            "Routes requests across the AI ops team and keeps responses grounded in current "
            "SLIM inventory, monitoring, and automation context."
        ),
        "system_prompt": (
            "You are the Manager for SLIM's homelab NOC and IT team. "
            "Treat SLIM as the source of truth for inventory, monitoring state, recent automation, "
            "and enabled AI tools. "
            "Your job is to decide whether to answer directly or delegate to exactly one specialist, "
            "while keeping replies concise, operator-facing, and zero-trust. "
            "Answer directly for brief questions about SLIM's AI team, routing, current configuration, "
            "or when the user clearly wants orchestration guidance rather than deep technical analysis. "
            "Delegate when the request is operational, investigative, or action-oriented. "
            "Prefer NOC Monitor for telemetry, alerts, logs, trends, and health interpretation. "
            "Prefer Incident Responder for triage, probable cause analysis, blast radius, and recovery sequencing. "
            "Prefer Automation Operator when the request involves job templates, execution decisions, "
            "or bounded remediation through approved tools. "
            "Do not invent lab details. Call out uncertainty when the available SLIM context is incomplete."
        ),
        "is_enabled": True,
    },
    AiAgentType.noc_monitor: {
        "agent_key": "noc_monitor",
        "name": "NOC Monitor",
        "description": "Interprets monitoring state, alerts, logs, service health, and operating trends.",
        "system_prompt": (
            "You are the NOC Monitor for SLIM's homelab. "
            "Focus on observability, telemetry, service health, logs, capacity, and drift signals. "
            "Explain what the current signals show, what patterns are abnormal, what they most likely "
            "indicate, and what operators should inspect next. "
            "Prefer concrete evidence from SLIM context over generic advice. "
            "When data is missing, say what is missing and what would confirm or disprove your hypothesis."
        ),
        "is_enabled": True,
    },
    AiAgentType.incident_responder: {
        "agent_key": "incident_responder",
        "name": "Incident Responder",
        "description": "Leads diagnosis, incident triage, blast-radius analysis, and recovery guidance.",
        "system_prompt": (
            "You are the Incident Responder for SLIM's homelab. "
            "Focus on triage, likely causes, blast radius, service impact, recovery sequencing, and "
            "safe remediation planning. "
            "Structure your reasoning around what is known, the leading hypotheses, the risks of each "
            "path, and the next safest operator actions. "
            "Keep recommendations practical for a homelab run through SLIM, and avoid pretending an "
            "issue is confirmed when the evidence is still partial."
        ),
        "is_enabled": True,
    },
    AiAgentType.automation_operator: {
        "agent_key": "automation_operator",
        "name": "Automation Operator",
        "description": "Owns bounded automation through approved job-template tools and runbook-backed remediation.",
        "system_prompt": (
            "You are the Automation Operator for SLIM's homelab. "
            "Focus on safe automation guidance, job-template selection, execution readiness checks, "
            "and bounded remediation through approved AI tools. "
            "Make the operator intent, scope, prerequisites, and likely outcome explicit before "
            "recommending or triggering automation. "
            "Never treat SLIM as a shell. Only reason about the approved tools and job templates provided in context."
        ),
        "is_enabled": True,
    },
}

LEGACY_DEFAULT_AGENT_DEFINITIONS: dict[AiAgentType, dict[str, str]] = {
    AiAgentType.manager: {
        "description": "Routes requests to the best specialist and keeps answers grounded in current SLIM context.",
        "system_prompt": (
            "You are the Manager agent for a homelab NOC and IT operations assistant. "
            "Decide whether to answer directly or route the request to exactly one specialist. "
            "Prefer NOC Monitor for telemetry, monitoring, logs, and service health. "
            "Prefer Incident Responder for diagnosis, root cause analysis, and recovery guidance. "
            "Prefer Automation Operator when the request involves executing or preparing automation."
        ),
    },
    AiAgentType.noc_monitor: {
        "description": "Explains monitoring state, alerts, logs, and service health.",
        "system_prompt": (
            "You are the NOC Monitor agent. Focus on observability, telemetry, health signals, alerts, "
            "capacity, and logs. Explain what is wrong, why it is likely happening, and what operators "
            "should check next."
        ),
    },
    AiAgentType.incident_responder: {
        "description": "Handles diagnosis, incident triage, and recovery guidance.",
        "system_prompt": (
            "You are the Incident Responder agent. Focus on incident triage, probable causes, recovery sequencing, "
            "risk communication, and safe remediation planning."
        ),
    },
    AiAgentType.automation_operator: {
        "description": "Owns bounded automation through approved job-template tools.",
        "system_prompt": (
            "You are the Automation Operator agent. Focus on safe automation guidance and bounded execution "
            "through approved AI tools that map to job templates."
        ),
    },
}


class AiError(RuntimeError):
    pass


def is_manager_agent(agent: AiAgent) -> bool:
    return agent.agent_type == AiAgentType.manager


def is_specialist_agent(agent: AiAgent) -> bool:
    return not is_manager_agent(agent)


def provider_has_api_key(provider: AiProvider) -> bool:
    return bool(provider.api_key)


def to_provider_read(provider: AiProvider) -> dict[str, Any]:
    return {
        "id": provider.id,
        "name": provider.name,
        "provider_type": provider.provider_type,
        "base_url": provider.base_url,
        "default_model": provider.default_model,
        "has_api_key": provider_has_api_key(provider),
        "is_enabled": provider.is_enabled,
        "is_default": provider.is_default,
        "request_timeout_seconds": provider.request_timeout_seconds,
        "created_at": provider.created_at,
        "updated_at": provider.updated_at,
    }


def encode_provider_api_key(api_key: str | None) -> str | None:
    if not api_key:
        return None
    return encrypt_secret(api_key)


def set_provider_default(db: Session, provider: AiProvider) -> None:
    if not provider.is_default:
        return
    db.query(AiProvider).filter(AiProvider.id != provider.id).update({"is_default": False})


def get_enabled_provider(db: Session, provider_id: int | None = None) -> AiProvider:
    stmt = select(AiProvider).where(AiProvider.is_enabled.is_(True))
    if provider_id is not None:
        stmt = stmt.where(AiProvider.id == provider_id)
        provider = db.execute(stmt).scalar_one_or_none()
    else:
        provider = db.execute(stmt.order_by(AiProvider.is_default.desc(), AiProvider.name.asc())).scalars().first()
    if provider is None:
        raise AiError("No enabled AI provider is configured")
    return provider


def get_agent_provider(db: Session, agent: AiAgent) -> AiProvider:
    if agent.provider_id is not None:
        provider = db.execute(
            select(AiProvider).where(AiProvider.id == agent.provider_id, AiProvider.is_enabled.is_(True))
        ).scalar_one_or_none()
        if provider is None:
            raise AiError(f"Agent {agent.name} does not have a valid enabled provider")
        return provider
    return get_enabled_provider(db)


def _normalize_agent_key(raw: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", raw.strip().lower()).strip("-")
    return normalized or "agent"


def _ensure_unique_agent_key(db: Session, candidate: str, *, ignore_agent_id: int | None = None) -> str:
    base = _normalize_agent_key(candidate)
    suffix = 1
    while True:
        key = base if suffix == 1 else f"{base}-{suffix}"
        stmt = select(AiAgent).where(func.lower(AiAgent.agent_key) == key.lower())
        if ignore_agent_id is not None:
            stmt = stmt.where(AiAgent.id != ignore_agent_id)
        existing = db.execute(stmt).scalar_one_or_none()
        if existing is None:
            return key
        suffix += 1


def _agent_sort_key(agent: AiAgent) -> tuple[int, str, int]:
    order = {agent_type: index for index, agent_type in enumerate(AGENT_ORDER)}
    return (order.get(agent.agent_type, len(AGENT_ORDER)), agent.name.lower(), agent.id)


def _sorted_agents(agents: list[AiAgent]) -> list[AiAgent]:
    return sorted(agents, key=_agent_sort_key)


def _sync_system_agent_defaults(agent: AiAgent, definition: dict[str, Any]) -> bool:
    legacy = LEGACY_DEFAULT_AGENT_DEFINITIONS.get(agent.agent_type)
    changed = False
    if not agent.agent_key:
        agent.agent_key = definition["agent_key"]
        changed = True
    if agent.description is None or (legacy and agent.description == legacy["description"]):
        if agent.description != definition["description"]:
            agent.description = definition["description"]
            changed = True
    if not agent.system_prompt or (legacy and agent.system_prompt == legacy["system_prompt"]):
        if agent.system_prompt != definition["system_prompt"]:
            agent.system_prompt = definition["system_prompt"]
            changed = True
    return changed


def _openai_compatible_headers(provider: AiProvider) -> dict[str, str]:
    headers: dict[str, str] = {}
    if provider.api_key:
        headers["Authorization"] = f"Bearer {decrypt_secret(provider.api_key)}"
    return headers


def _normalize_provider_models(default_model: str | None, raw_models: list[Any]) -> list[str]:
    models: list[str] = []
    seen: set[str] = set()

    def add(candidate: Any) -> None:
        if not isinstance(candidate, str):
            return
        normalized = candidate.strip()
        if not normalized:
            return
        lowered = normalized.lower()
        if lowered in seen:
            return
        seen.add(lowered)
        models.append(normalized)

    add(default_model)
    for item in raw_models:
        add(item)

    return models


async def _list_ollama_models(provider: AiProvider) -> list[str]:
    async with httpx.AsyncClient(timeout=provider.request_timeout_seconds) as client:
        response = await client.get(f"{provider.base_url.rstrip('/')}/api/tags")
        response.raise_for_status()
    payload = response.json()
    raw_models = [item.get("name") for item in (payload.get("models") or []) if isinstance(item, dict)]
    return _normalize_provider_models(provider.default_model, raw_models)


async def _list_openai_compatible_models(provider: AiProvider) -> list[str]:
    async with httpx.AsyncClient(timeout=provider.request_timeout_seconds) as client:
        response = await client.get(
            f"{provider.base_url.rstrip('/')}/models",
            headers=_openai_compatible_headers(provider),
        )
        response.raise_for_status()
    payload = response.json()
    raw_models = [item.get("id") for item in (payload.get("data") or []) if isinstance(item, dict)]
    return _normalize_provider_models(provider.default_model, raw_models)


async def _list_openwebui_models(provider: AiProvider) -> list[str]:
    async with httpx.AsyncClient(timeout=provider.request_timeout_seconds) as client:
        response = await client.get(
            f"{provider.base_url.rstrip('/')}/api/models",
            headers=_openai_compatible_headers(provider),
        )
        response.raise_for_status()
    payload = response.json()
    raw_models = [item.get("id") for item in (payload.get("data") or []) if isinstance(item, dict)]
    return _normalize_provider_models(provider.default_model, raw_models)


async def _list_anthropic_models(provider: AiProvider) -> list[str]:
    headers: dict[str, str] = {"anthropic-version": "2023-06-01"}
    if provider.api_key:
        headers["x-api-key"] = decrypt_secret(provider.api_key)
    async with httpx.AsyncClient(timeout=provider.request_timeout_seconds) as client:
        response = await client.get(
            f"{provider.base_url.rstrip('/')}/v1/models",
            headers=headers,
        )
        response.raise_for_status()
    payload = response.json()
    raw_models = [item.get("id") for item in (payload.get("data") or []) if isinstance(item, dict)]
    return _normalize_provider_models(provider.default_model, raw_models)


async def list_provider_models(provider: AiProvider) -> list[str]:
    try:
        if provider.provider_type == AiProviderType.ollama:
            return await _list_ollama_models(provider)
        if provider.provider_type == AiProviderType.openwebui:
            return await _list_openwebui_models(provider)
        if provider.provider_type == AiProviderType.anthropic:
            return await _list_anthropic_models(provider)
        return await _list_openai_compatible_models(provider)
    except httpx.HTTPError as exc:
        raise AiError(f"Failed to load models from provider {provider.name}: {exc}") from exc
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise AiError(f"Provider {provider.name} returned an invalid model list") from exc


def build_transient_provider(
    *,
    provider_type: AiProviderType,
    base_url: str,
    default_model: str | None = None,
    api_key: str | None = None,
    request_timeout_seconds: int = 60,
    name: str = "Unsaved provider",
) -> AiProvider:
    return AiProvider(
        name=name,
        provider_type=provider_type,
        base_url=base_url.strip(),
        default_model=(default_model or "").strip(),
        api_key=encode_provider_api_key(api_key.strip()) if api_key and api_key.strip() else None,
        is_enabled=True,
        is_default=False,
        request_timeout_seconds=request_timeout_seconds,
    )


def create_conversation(
    db: Session,
    *,
    user_id: int,
    provider_id: int | None,
    model: str | None,
    title_seed: str,
) -> AiConversation:
    title = (title_seed.strip() or DEFAULT_CONVERSATION_TITLE)[:CONVERSATION_TITLE_MAX_LENGTH]
    conversation = AiConversation(
        user_id=user_id,
        provider_id=provider_id,
        model=model,
        title=title,
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


def get_conversation_for_user(db: Session, conversation_id: int, user_id: int) -> AiConversation | None:
    return db.execute(
        select(AiConversation).where(
            AiConversation.id == conversation_id,
            AiConversation.user_id == user_id,
        )
    ).scalar_one_or_none()


def save_message(
    db: Session,
    *,
    conversation_id: int,
    role: AiMessageRole,
    content: str,
    context_summary: str | None = None,
    agent_id: int | None = None,
) -> AiMessage:
    message = AiMessage(
        conversation_id=conversation_id,
        role=role,
        content=content,
        context_summary=context_summary,
        agent_id=agent_id,
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


def list_conversation_messages(db: Session, conversation_id: int) -> list[AiMessage]:
    return (
        db.execute(
            select(AiMessage)
            .where(AiMessage.conversation_id == conversation_id)
            .order_by(AiMessage.created_at.asc(), AiMessage.id.asc())
        )
        .scalars()
        .all()
    )


def list_user_conversations(db: Session, user_id: int, limit: int = 100) -> list[AiConversation]:
    return (
        db.execute(
            select(AiConversation)
            .where(AiConversation.user_id == user_id)
            .order_by(AiConversation.updated_at.desc(), AiConversation.id.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )


def update_conversation_metadata(db: Session, conversation: AiConversation, *, provider_id: int, model: str) -> None:
    conversation.provider_id = provider_id
    conversation.model = model
    db.commit()
    db.refresh(conversation)


def update_conversation_title(db: Session, conversation: AiConversation, *, title: str) -> None:
    normalized = (title or "").strip() or DEFAULT_CONVERSATION_TITLE
    conversation.title = normalized[:CONVERSATION_TITLE_MAX_LENGTH]
    db.commit()
    db.refresh(conversation)


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, dict):
        clean: dict[str, Any] = {}
        for key, item in value.items():
            lowered = key.lower()
            if any(pattern in lowered for pattern in FORBIDDEN_KEY_PATTERNS):
                continue
            clean[key] = _sanitize_value(item)
        return clean
    if isinstance(value, list):
        return [_sanitize_value(item) for item in value]
    return value


def _assert_no_forbidden_keys(value: Any) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            lowered = key.lower()
            if any(pattern in lowered for pattern in FORBIDDEN_KEY_PATTERNS):
                raise AiError(f"Refusing to send forbidden key in AI context: {key}")
            _assert_no_forbidden_keys(item)
    elif isinstance(value, list):
        for item in value:
            _assert_no_forbidden_keys(item)


def ensure_feature_settings(db: Session) -> AiFeatureSettings:
    settings = db.execute(select(AiFeatureSettings).limit(1)).scalar_one_or_none()
    if settings is None:
        settings = AiFeatureSettings(agentic_noc_enabled=False)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def ensure_default_agents(db: Session) -> list[AiAgent]:
    existing = {
        agent.agent_type: agent
        for agent in db.execute(select(AiAgent)).scalars().all()
        if agent.agent_type in SYSTEM_AGENT_TYPES
    }
    changed = False
    for agent_type in AGENT_ORDER:
        if agent_type in existing:
            agent = existing[agent_type]
            definition = DEFAULT_AGENT_DEFINITIONS[agent_type]
            changed = _sync_system_agent_defaults(agent, definition) or changed
            continue
        definition = DEFAULT_AGENT_DEFINITIONS[agent_type]
        agent = AiAgent(
            agent_type=agent_type,
            agent_key=definition["agent_key"],
            name=definition["name"],
            description=definition["description"],
            system_prompt=definition["system_prompt"],
            is_enabled=definition["is_enabled"],
        )
        db.add(agent)
        changed = True
    if changed:
        db.commit()
    return _sorted_agents(db.execute(select(AiAgent)).scalars().all())


def list_agents(db: Session) -> list[AiAgent]:
    ensure_default_agents(db)
    agents = db.execute(select(AiAgent)).scalars().all()
    return _sorted_agents(agents)


def get_agent_by_type(db: Session, agent_type: AiAgentType) -> AiAgent:
    ensure_default_agents(db)
    agent = db.execute(select(AiAgent).where(AiAgent.agent_type == agent_type)).scalar_one_or_none()
    if agent is None:
        raise AiError(f"AI agent {agent_type.value} is not configured")
    return agent


def get_agent_by_id(db: Session, agent_id: int) -> AiAgent | None:
    ensure_default_agents(db)
    return db.get(AiAgent, agent_id)


def get_agent_by_key(db: Session, agent_key: str) -> AiAgent | None:
    ensure_default_agents(db)
    return db.execute(select(AiAgent).where(AiAgent.agent_key == agent_key)).scalar_one_or_none()


def create_agent(
    db: Session,
    *,
    name: str,
    description: str | None,
    provider_id: int | None,
    model: str | None,
    system_prompt: str,
    is_enabled: bool,
) -> AiAgent:
    normalized_name = (name or "").strip()
    if not normalized_name:
        raise AiError("Agent name is required")
    normalized_prompt = (system_prompt or "").strip()
    if not normalized_prompt:
        raise AiError("System prompt cannot be empty")
    if len(normalized_prompt) > SYSTEM_PROMPT_MAX_LENGTH:
        raise AiError(f"System prompt must be {SYSTEM_PROMPT_MAX_LENGTH} characters or fewer")
    provider = None
    if provider_id is not None:
        provider = db.get(AiProvider, provider_id)
        if provider is None:
            raise AiError("AI provider not found")
    agent = AiAgent(
        agent_type=AiAgentType.custom,
        agent_key=_ensure_unique_agent_key(db, normalized_name),
        name=normalized_name,
        description=(description or "").strip() or None,
        provider_id=provider.id if provider is not None else None,
        model=(model or "").strip() or None,
        system_prompt=normalized_prompt,
        is_enabled=is_enabled,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent


def update_agent(
    db: Session,
    agent: AiAgent,
    *,
    name: str | None | object = UNSET,
    description: str | None | object = UNSET,
    provider_id: int | None | object = UNSET,
    model: str | None | object = UNSET,
    system_prompt: str | None | object = UNSET,
    is_enabled: bool | None | object = UNSET,
) -> AiAgent:
    if name is not UNSET:
        normalized_name = (name or "").strip()
        if not normalized_name:
            raise AiError("Agent name is required")
        agent.name = normalized_name
        if agent.agent_type == AiAgentType.custom and not agent.agent_key:
            agent.agent_key = _ensure_unique_agent_key(db, normalized_name, ignore_agent_id=agent.id)
    if description is not UNSET:
        agent.description = (description or "").strip() or None
    if provider_id is not UNSET and provider_id is not None:
        provider = db.get(AiProvider, provider_id)
        if provider is None:
            raise AiError("AI provider not found")
        agent.provider_id = provider.id
    elif provider_id is None:
        agent.provider_id = None
    if model is not UNSET and model is not None:
        agent.model = model.strip() or None
    if system_prompt is not UNSET and system_prompt is not None:
        normalized = system_prompt.strip()
        if not normalized:
            raise AiError("System prompt cannot be empty")
        if len(normalized) > SYSTEM_PROMPT_MAX_LENGTH:
            raise AiError(f"System prompt must be {SYSTEM_PROMPT_MAX_LENGTH} characters or fewer")
        agent.system_prompt = normalized
    if is_enabled is not UNSET and is_enabled is not None:
        if is_manager_agent(agent) and not is_enabled:
            raise AiError("Manager agent cannot be disabled")
        agent.is_enabled = is_enabled
    db.commit()
    db.refresh(agent)
    return agent


def to_agent_read(db: Session, agent: AiAgent) -> dict[str, Any]:
    provider = db.get(AiProvider, agent.provider_id) if agent.provider_id else None
    return {
        "id": agent.id,
        "agent_key": agent.agent_key,
        "agent_type": agent.agent_type,
        "name": agent.name,
        "description": agent.description,
        "provider_id": agent.provider_id,
        "provider_name": provider.name if provider else None,
        "model": agent.model,
        "system_prompt": agent.system_prompt,
        "is_enabled": agent.is_enabled,
        "created_at": agent.created_at,
        "updated_at": agent.updated_at,
    }


def to_settings_read(settings: AiFeatureSettings) -> dict[str, Any]:
    return {
        "agentic_noc_enabled": settings.agentic_noc_enabled,
        "created_at": settings.created_at,
        "updated_at": settings.updated_at,
    }


def set_feature_enabled(db: Session, enabled: bool) -> AiFeatureSettings:
    settings = ensure_feature_settings(db)
    settings.agentic_noc_enabled = enabled
    db.commit()
    db.refresh(settings)
    return settings


def get_agent_assignments(db: Session, tool_id: int) -> list[AiAgent]:
    rows = (
        db.execute(
            select(AiAgent).join(AiAgentTool, AiAgentTool.agent_id == AiAgent.id).where(AiAgentTool.tool_id == tool_id)
        )
        .scalars()
        .all()
    )
    return _sorted_agents(rows)


def _validate_tool_agent_ids(db: Session, agent_ids: list[int]) -> list[AiAgent]:
    if not agent_ids:
        return []
    agents = db.execute(select(AiAgent).where(AiAgent.id.in_(agent_ids))).scalars().all()
    found_ids = {agent.id for agent in agents}
    missing = [agent_id for agent_id in agent_ids if agent_id not in found_ids]
    if missing:
        raise AiError(f"Unknown AI agent ids: {missing}")
    for agent in agents:
        if not is_specialist_agent(agent):
            raise AiError("Tools can only be assigned to specialist agents")
    return agents


def sync_tool_assignments(db: Session, tool: AiTool, agent_ids: list[int]) -> None:
    agents = _validate_tool_agent_ids(db, agent_ids)
    db.query(AiAgentTool).filter(AiAgentTool.tool_id == tool.id).delete()
    for agent in agents:
        db.add(AiAgentTool(agent_id=agent.id, tool_id=tool.id))
    db.commit()


def _validate_tool_name(db: Session, tool_name: str, *, ignore_tool_id: int | None = None) -> str:
    normalized = tool_name.strip()
    if not normalized:
        raise AiError("Tool name is required")
    stmt = select(AiTool).where(func.lower(AiTool.tool_name) == normalized.lower())
    if ignore_tool_id is not None:
        stmt = stmt.where(AiTool.id != ignore_tool_id)
    existing = db.execute(stmt).scalar_one_or_none()
    if existing is not None:
        raise AiError("Tool name must be unique")
    return normalized


def create_ai_tool(
    db: Session,
    *,
    job_template_id: int,
    is_enabled: bool,
    tool_name: str,
    description: str | None,
    when_to_use: str | None,
    input_hint: str | None,
    example_payload: Any,
    safety_notes: str | None,
    agent_ids: list[int],
) -> AiTool:
    template = db.get(JobTemplate, job_template_id)
    if template is None:
        raise AiError("Job template not found")
    if template.playbook_id is None:
        raise AiError("Job template must have a playbook before it can be exposed as an AI tool")
    existing = db.execute(select(AiTool).where(AiTool.job_template_id == job_template_id)).scalar_one_or_none()
    if existing is not None:
        raise AiError("This job template is already configured as an AI tool")
    tool = AiTool(
        job_template_id=job_template_id,
        is_enabled=is_enabled,
        tool_name=_validate_tool_name(db, tool_name),
        description=(description or "").strip() or None,
        when_to_use=(when_to_use or "").strip() or None,
        input_hint=(input_hint or "").strip() or None,
        example_payload=example_payload,
        safety_notes=(safety_notes or "").strip() or None,
    )
    db.add(tool)
    db.commit()
    db.refresh(tool)
    sync_tool_assignments(db, tool, agent_ids)
    db.refresh(tool)
    return tool


def update_ai_tool(
    db: Session,
    tool: AiTool,
    *,
    is_enabled: bool | None,
    tool_name: str | None | object = UNSET,
    description: str | None | object = UNSET,
    when_to_use: str | None | object = UNSET,
    input_hint: str | None | object = UNSET,
    example_payload: Any = UNSET,
    safety_notes: str | None | object = UNSET,
    agent_ids: list[int] | None | object = UNSET,
) -> AiTool:
    if is_enabled is not None:
        tool.is_enabled = is_enabled
    if tool_name is not UNSET:
        if tool_name is None:
            raise AiError("Tool name is required")
        tool.tool_name = _validate_tool_name(db, tool_name, ignore_tool_id=tool.id)
    if description is not UNSET:
        tool.description = (description or "").strip() or None
    if when_to_use is not UNSET:
        tool.when_to_use = (when_to_use or "").strip() or None
    if input_hint is not UNSET:
        tool.input_hint = (input_hint or "").strip() or None
    if example_payload is not UNSET:
        tool.example_payload = example_payload
    if safety_notes is not UNSET:
        tool.safety_notes = (safety_notes or "").strip() or None
    db.commit()
    db.refresh(tool)
    if agent_ids is not UNSET:
        sync_tool_assignments(db, tool, agent_ids)
        db.refresh(tool)
    return tool


def list_ai_tools(db: Session, *, include_disabled: bool = True) -> list[AiTool]:
    stmt = select(AiTool).order_by(AiTool.tool_name.asc())
    if not include_disabled:
        stmt = stmt.where(AiTool.is_enabled.is_(True))
    return db.execute(stmt).scalars().all()


def to_tool_read(db: Session, tool: AiTool) -> dict[str, Any]:
    template = db.get(JobTemplate, tool.job_template_id)
    if template is None:
        raise AiError("AI tool is linked to a missing job template")
    assigned_agents = get_agent_assignments(db, tool.id)
    return {
        "id": tool.id,
        "job_template_id": template.id,
        "job_template_name": template.name,
        "playbook_id": template.playbook_id,
        "is_enabled": tool.is_enabled,
        "tool_name": tool.tool_name,
        "description": tool.description,
        "when_to_use": tool.when_to_use,
        "input_hint": tool.input_hint,
        "example_payload": tool.example_payload,
        "safety_notes": tool.safety_notes,
        "assigned_agents": [
            {
                "id": agent.id,
                "agent_type": agent.agent_type,
                "name": agent.name,
            }
            for agent in assigned_agents
        ],
        "created_at": tool.created_at,
        "updated_at": tool.updated_at,
    }


def list_tool_candidates(db: Session) -> list[dict[str, Any]]:
    tools_by_template = {tool.job_template_id: tool for tool in list_ai_tools(db, include_disabled=True)}
    templates = db.execute(select(JobTemplate).order_by(JobTemplate.name.asc())).scalars().all()
    return [
        {
            "job_template_id": template.id,
            "job_template_name": template.name,
            "playbook_id": template.playbook_id,
            "runbook_enabled": template.runbook_enabled,
            "runbook_category": template.runbook_category,
            "recommended_when": template.recommended_when,
            "risk_level": template.risk_level,
            "ai_tool_id": tools_by_template.get(template.id).id if template.id in tools_by_template else None,
            "ai_enabled": tools_by_template.get(template.id).is_enabled if template.id in tools_by_template else False,
        }
        for template in templates
    ]


def list_enabled_tools_for_agent(db: Session, agent: AiAgent) -> list[dict[str, Any]]:
    rows = db.execute(
        select(AiTool, JobTemplate)
        .join(JobTemplate, JobTemplate.id == AiTool.job_template_id)
        .join(AiAgentTool, AiAgentTool.tool_id == AiTool.id)
        .where(
            AiAgentTool.agent_id == agent.id,
            AiTool.is_enabled.is_(True),
        )
        .order_by(AiTool.tool_name.asc())
    ).all()
    items = [
        {
            "tool_id": tool.id,
            "tool_name": tool.tool_name,
            "job_template_id": template.id,
            "job_template_name": template.name,
            "description": tool.description,
            "when_to_use": tool.when_to_use,
            "input_hint": tool.input_hint,
            "example_payload": tool.example_payload,
            "safety_notes": tool.safety_notes,
            "risk_level": template.risk_level,
            "runbook_category": template.runbook_category,
        }
        for tool, template in rows
    ]
    clean_items = [_sanitize_value(item) for item in items]
    _assert_no_forbidden_keys(clean_items)
    return clean_items


def _host_monitoring_host(host: Host) -> MonitoringInventoryHost:
    return MonitoringInventoryHost(id=host.id, name=host.name, ipv4=host.ipv4)


def build_safe_context(
    db: Session,
    *,
    user: AppUser,
    page_context: AiPageContext | None,
) -> tuple[str, dict[str, Any]]:
    host_total = db.scalar(select(func.count()).select_from(Host)) or 0
    app_total = db.scalar(select(func.count()).select_from(App)) or 0
    template_total = db.scalar(select(func.count()).select_from(JobTemplate)) or 0
    env_total = db.scalar(select(func.count()).select_from(Environment)) or 0
    role_total = db.scalar(select(func.count()).select_from(Role)) or 0
    run_total = db.scalar(select(func.count()).select_from(PlaybookRun)) or 0
    enabled_tool_total = db.scalar(select(func.count()).select_from(AiTool).where(AiTool.is_enabled.is_(True))) or 0
    enabled_agents = [agent.name for agent in list_agents(db) if agent.is_enabled]

    context: dict[str, Any] = {
        "viewer": {"username": user.username, "role": user.role.value},
        "page_context": page_context.model_dump() if page_context else {},
        "inventory_summary": {
            "host_total": int(host_total),
            "app_total": int(app_total),
            "environment_total": int(env_total),
            "role_total": int(role_total),
        },
        "automation_summary": {
            "job_template_total": int(template_total),
            "automation_run_total": int(run_total),
        },
        "ai_summary": {
            "enabled_agents": enabled_agents,
            "enabled_tool_total": int(enabled_tool_total),
        },
    }

    recent_runs = db.execute(select(PlaybookRun).order_by(PlaybookRun.created_at.desc()).limit(5)).scalars().all()
    context["recent_automation_runs"] = [
        {
            "id": run.id,
            "playbook_id": run.playbook_id,
            "job_template_id": run.job_template_id,
            "status": run.status.value,
            "created_at": run.created_at.isoformat() if run.created_at else None,
        }
        for run in recent_runs
    ]

    if page_context and page_context.host_id:
        host = db.get(Host, page_context.host_id)
        if host is not None:
            monitoring_host = _host_monitoring_host(host)
            target_summary, host_metrics = get_prometheus_target_summary(selected_host=monitoring_host)
            from sqlalchemy import select as _select

            from app.models.inventory import HostRole as _HostRole

            _role_ids = [
                row[0]
                for row in db.execute(
                    _select(_HostRole.role_id).where(_HostRole.host_id == host.id).order_by(_HostRole.priority)
                ).all()
            ]
            context["selected_host"] = {
                "id": host.id,
                "name": host.name,
                "ipv4": host.ipv4,
                "role_ids": _role_ids,
                "environment_id": host.environment_id,
                "vlan_id": host.vlan_id,
                "status_id": host.status_id,
                "monitoring": {
                    "target_summary": target_summary,
                    "host_metrics": host_metrics[:1],
                },
            }

    if page_context and page_context.job_template_id:
        template = db.get(JobTemplate, page_context.job_template_id)
        if template is not None:
            context["selected_job_template"] = {
                "id": template.id,
                "name": template.name,
                "playbook_id": template.playbook_id,
                "inventory_filter_type": template.inventory_filter_type.value,
                "inventory_filter_value": template.inventory_filter_value,
                "extra_vars_defined": bool(template.extra_vars),
                "runbook_enabled": template.runbook_enabled,
                "runbook_category": template.runbook_category,
            }

    if page_context and page_context.editor_content:
        editor_content = page_context.editor_content.strip()
        if editor_content:
            max_editor_chars = 20_000
            truncated = len(editor_content) > max_editor_chars
            context["shared_editor"] = {
                "title": (page_context.editor_title or "").strip() or None,
                "language": (page_context.editor_language or "").strip() or None,
                "content": editor_content[:max_editor_chars],
                "truncated": truncated,
                "character_count": len(editor_content),
            }

    monitoring_status = get_prometheus_status()
    context["monitoring_backends"] = {
        "prometheus": {
            "configured": monitoring_status.configured,
            "reachable": monitoring_status.reachable,
            "ready": monitoring_status.ready,
        },
        "loki_volume_top": get_loki_log_volume(selected_host=None)[:5],
    }

    clean_context = _sanitize_value(context)
    _assert_no_forbidden_keys(clean_context)
    route_name = page_context.route if page_context and page_context.route else "unknown"
    summary = (
        f"Viewer {user.username} is asking from route {route_name}. "
        f"There are {host_total} hosts, {app_total} apps, {template_total} job templates, "
        f"{enabled_tool_total} enabled AI tools, and {len(enabled_agents)} enabled agents."
    )
    return summary, clean_context


def build_lab_profile(db: Session) -> dict[str, Any]:
    environment_names = db.execute(select(Environment.name).order_by(Environment.name.asc()).limit(12)).scalars().all()
    role_names = db.execute(select(Role.name).order_by(Role.name.asc()).limit(12)).scalars().all()
    app_names = db.execute(select(App.name).order_by(App.name.asc()).limit(12)).scalars().all()
    host_rows = db.execute(select(Host.name, Host.ipv4).order_by(Host.name.asc()).limit(12)).all()
    runbook_rows = db.execute(
        select(JobTemplate.name, JobTemplate.runbook_category, JobTemplate.risk_level)
        .where(JobTemplate.runbook_enabled.is_(True))
        .order_by(JobTemplate.name.asc())
        .limit(12)
    ).all()
    tool_names = (
        db.execute(
            select(AiTool.tool_name).where(AiTool.is_enabled.is_(True)).order_by(AiTool.tool_name.asc()).limit(12)
        )
        .scalars()
        .all()
    )
    provider_names = (
        db.execute(
            select(AiProvider.name).where(AiProvider.is_enabled.is_(True)).order_by(AiProvider.name.asc()).limit(12)
        )
        .scalars()
        .all()
    )

    profile = _sanitize_value(
        {
            "environments": environment_names,
            "roles": role_names,
            "apps": app_names,
            "hosts": [{"name": name, "ipv4": ipv4} for name, ipv4 in host_rows],
            "runbooks": [
                {
                    "name": name,
                    "category": category,
                    "risk_level": risk_level,
                }
                for name, category, risk_level in runbook_rows
            ],
            "enabled_ai_tools": tool_names,
            "enabled_ai_providers": provider_names,
        }
    )
    _assert_no_forbidden_keys(profile)
    return profile


def build_prompt_assist_agent_context(db: Session, agent: AiAgent) -> dict[str, Any]:
    specialists = [
        {
            "agent_key": candidate.agent_key,
            "name": candidate.name,
            "description": candidate.description,
        }
        for candidate in list_agents(db)
        if is_specialist_agent(candidate) and candidate.is_enabled
    ]
    context: dict[str, Any] = {
        "agent_key": agent.agent_key,
        "agent_type": agent.agent_type.value,
        "name": agent.name,
        "description": agent.description,
        "provider_id": agent.provider_id,
        "model_override": agent.model,
        "is_manager": is_manager_agent(agent),
    }
    if is_manager_agent(agent):
        context["available_specialists"] = specialists
    else:
        context["available_specialists"] = specialists
        context["assigned_tools"] = [
            {
                "tool_name": item["tool_name"],
                "job_template_name": item["job_template_name"],
                "description": item["description"],
                "when_to_use": item["when_to_use"],
            }
            for item in list_enabled_tools_for_agent(db, agent)
        ]
    clean_context = _sanitize_value(context)
    _assert_no_forbidden_keys(clean_context)
    return clean_context


def _history_for_prompt(db: Session, conversation_id: int, limit: int = 8) -> list[dict[str, str]]:
    messages = list_conversation_messages(db, conversation_id)[-limit:]
    history: list[dict[str, str]] = []
    for message in messages:
        if message.role == AiMessageRole.system:
            continue
        content = message.content
        if message.role == AiMessageRole.assistant and message.agent_id is not None:
            history.append(
                {
                    "role": "assistant",
                    "content": f"[agent:{message.agent_id}] {content}",
                }
            )
            continue
        history.append({"role": message.role.value, "content": content})
    return history


def _manager_route_system_prompt(agent: AiAgent) -> str:
    return (
        "You are the top-level manager for SLIM's homelab NOC/IT AI system. "
        "Treat the supplied SLIM inventory, monitoring, and automation data as the source of truth. "
        "You must decide whether to answer directly or delegate to exactly one specialist from the provided roster. "
        "Use direct mode for short questions about SLIM's AI team, routing, or obvious coordination answers. "
        "Use delegate mode for troubleshooting, monitoring analysis, incident work, runbook decisions, "
        "or anything action-oriented. "
        "Use the exact specialist agent_key from the provided roster when delegating. "
        "If context is incomplete, choose the safest specialist and mention the uncertainty in the reason. "
        "Return strict JSON only with one of these shapes:\n"
        '{"mode":"direct","reply":"..."}\n'
        '{"mode":"delegate","agent_key":"specialist-key","reason":"..."}\n'
        "Never emit action tags. Never claim tools executed. Never invent agents, tools, or lab state.\n\n"
        f"Agent instructions:\n{agent.system_prompt.strip()}"
    )


def build_manager_route_messages(
    db: Session,
    *,
    conversation_id: int,
    manager: AiAgent,
    context_summary: str,
    context_data: dict[str, Any],
    user_message: str,
) -> list[dict[str, str]]:
    specialists = [agent for agent in list_agents(db) if is_specialist_agent(agent) and agent.is_enabled]
    specialist_text = "\n".join(
        f"- {agent.agent_key}: {agent.name} :: {agent.description or 'No description'}" for agent in specialists
    )
    return [
        {
            "role": "system",
            "content": _manager_route_system_prompt(manager),
        },
        {
            "role": "user",
            "content": (
                f"Context summary: {context_summary}\n"
                f"Safe context JSON: {json.dumps(context_data, default=str)}\n"
                f"Available specialists:\n{specialist_text or '- none'}\n"
                f"Recent conversation snippets: {json.dumps(_history_for_prompt(db, conversation_id), default=str)}\n"
                f"User request: {user_message.strip()}"
            ),
        },
    ]


def _specialist_action_rule(allow_execution: bool) -> str:
    if not allow_execution:
        return "Do not emit any action tags in this reply."
    return (
        "You may execute exactly one AI tool by emitting "
        '<slim_action>{"type":"run_ai_tool","tool_id":NUMBER}</slim_action> '
        "only if the user explicitly asked to run or execute something and the tool is listed in available_tools."
    )


def build_specialist_prompt_messages(
    db: Session,
    *,
    conversation_id: int,
    agent: AiAgent,
    context_summary: str,
    context_data: dict[str, Any],
    user_message: str,
) -> list[dict[str, str]]:
    available_tools = list_enabled_tools_for_agent(db, agent)
    messages = [
        {
            "role": "system",
            "content": (
                "You are a specialist AI agent inside SLIM's homelab NOC/IT system. "
                "Ground your reply in the supplied SLIM context before giving generic advice. "
                "Be concise and operator-facing: explain what you see, what it likely means, what is "
                "uncertain, and what should happen next. "
                "You are zero-trust. Never claim to create, modify, delete, sync, import, or update anything except "
                "for one bounded capability: running exactly one enabled AI tool when explicitly requested. "
                "Never reveal or infer secrets, passwords, tokens, API keys, SSH keys, vault data, or masked values. "
                "Never claim a tool ran unless the platform actually triggered it. "
                f"{_specialist_action_rule(user_message_allows_execution(user_message))}\n\n"
                f"Agent role: {agent.name}\n"
                f"Agent instructions:\n{agent.system_prompt.strip()}\n\n"
                f"Context summary: {context_summary}\n"
                f"Safe context JSON: {json.dumps(context_data, default=str)}\n"
                f"Available tools: {json.dumps(available_tools, default=str)}"
            ),
        }
    ]
    messages.extend(_history_for_prompt(db, conversation_id))
    if not messages or messages[-1]["role"] != "user" or messages[-1]["content"] != user_message:
        messages.append({"role": "user", "content": user_message})
    return messages


def build_prompt_assist_messages(
    db: Session,
    *,
    agent: AiAgent,
    current_prompt: str | None,
    request: str,
    context_summary: str,
    context_data: dict[str, Any],
) -> list[dict[str, str]]:
    existing = (current_prompt or "").strip()
    agent_context = build_prompt_assist_agent_context(db, agent)
    lab_profile = build_lab_profile(db)
    return [
        {
            "role": "system",
            "content": (
                f"You help administrators write a system prompt for the {agent.name} AI agent in SLIM. "
                "Return only the proposed system prompt text, with no markdown fences, preamble, or explanation. "
                "Write concise, practical prompt text that improves answer quality while staying "
                "grounded in the supplied SLIM lab context. "
                "Preserve zero-trust behavior, do not request secrets, and do not include instructions "
                "that attempt to override server-side safety or execution controls. "
                "Use the real lab details, agent role, available specialists, and available tools when "
                "they are relevant."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Agent context JSON: {json.dumps(agent_context, default=str)}\n"
                f"Current prompt:\n{existing or '[none]'}\n\n"
                f"Admin request:\n{request.strip()}\n\n"
                f"Lab context summary: {context_summary}\n"
                f"Safe SLIM context JSON: {json.dumps(context_data, default=str)}\n"
                f"Lab profile JSON: {json.dumps(lab_profile, default=str)}\n\n"
                "Rewrite the system prompt accordingly."
            ),
        },
    ]


def _normalize_conversation_title(raw: str | None, fallback: str) -> str:
    candidate = (raw or "").strip()
    if not candidate:
        return fallback[:CONVERSATION_TITLE_MAX_LENGTH]
    candidate = candidate.splitlines()[0].strip()
    candidate = candidate.strip(" `\"'*-:#")
    candidate = re.sub(r"\s+", " ", candidate).strip()
    if not candidate:
        return fallback[:CONVERSATION_TITLE_MAX_LENGTH]
    return candidate[:CONVERSATION_TITLE_MAX_LENGTH]


def build_conversation_title_messages(*, user_message: str, assistant_message: str) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "You generate a short title for a chat conversation in SLIM. "
                "Return only the title text, with no markdown, quotes, prefix, or explanation. "
                "The title should be 2 to 6 words, concrete, and specific to the user's operational request."
            ),
        },
        {
            "role": "user",
            "content": (
                f"User message:\n{user_message.strip()}\n\n"
                f"Assistant reply:\n{assistant_message.strip()}\n\n"
                "Generate the conversation title."
            ),
        },
    ]


async def generate_conversation_title(
    provider: AiProvider,
    *,
    model: str,
    user_message: str,
    assistant_message: str,
) -> str:
    fallback = _normalize_conversation_title(user_message, DEFAULT_CONVERSATION_TITLE)
    try:
        raw = await collect_provider_response(
            provider,
            model=model,
            prompt_messages=build_conversation_title_messages(
                user_message=user_message,
                assistant_message=assistant_message,
            ),
        )
    except Exception:  # noqa: BLE001
        return fallback
    return _normalize_conversation_title(raw, fallback)


def _job_template_prefill_fallback(template: JobTemplate) -> dict[str, Any]:
    base_name = template.name.strip()
    description = template.description or f"Run the {base_name} job template from SLIM."
    when_to_use = template.recommended_when or (
        f"Use when operators need the {base_name} workflow and the preconfigured inventory targeting is appropriate."
    )
    input_hint = (
        "Review the linked job template before running. This AI tool runs the template as configured in SLIM "
        "and does not accept arbitrary runtime arguments in v1."
    )
    safety_notes = (
        "Confirm the target scope, playbook intent, and maintenance risk before execution. "
        "Do not use this tool for secrets retrieval or arbitrary changes outside the linked template."
    )
    return {
        "tool_name": base_name,
        "description": description,
        "when_to_use": when_to_use,
        "input_hint": input_hint,
        "example_payload": None,
        "safety_notes": safety_notes,
    }


def build_tool_prefill_messages(
    *,
    template: JobTemplate,
    current_draft: dict[str, Any],
    instructions: str | None,
) -> list[dict[str, str]]:
    fallback = _job_template_prefill_fallback(template)
    template_context = _sanitize_value(
        {
            "name": template.name,
            "description": template.description,
            "runbook_enabled": template.runbook_enabled,
            "runbook_category": template.runbook_category,
            "recommended_when": template.recommended_when,
            "risk_level": template.risk_level,
            "alert_match_type": template.alert_match_type,
            "alert_match_value": template.alert_match_value,
            "inventory_filter_type": template.inventory_filter_type.value,
            "inventory_filter_value": template.inventory_filter_value,
            "extra_vars_defined": bool(template.extra_vars),
        }
    )
    _assert_no_forbidden_keys(template_context)
    return [
        {
            "role": "system",
            "content": (
                "You help admins prefill metadata for an AI tool that wraps an existing job template in SLIM. "
                "Return strict JSON only with keys: tool_name, description, when_to_use, input_hint, "
                "example_payload, safety_notes. "
                "Do not request secrets. Do not claim the tool accepts arbitrary runtime arguments if "
                "the system does not."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Job template context: {json.dumps(template_context, default=str)}\n"
                f"Fallback draft: {json.dumps(fallback, default=str)}\n"
                f"Current admin draft: {json.dumps(current_draft, default=str)}\n"
                f"Extra admin instructions: {(instructions or '').strip() or '[none]'}\n"
                "Produce the best operator-facing AI tool metadata."
            ),
        },
    ]


def user_message_allows_execution(message: str) -> bool:
    return bool(RUN_INTENT_PATTERN.search(message))


async def _stream_ollama(
    provider: AiProvider,
    model: str,
    messages: list[dict[str, str]],
) -> AsyncGenerator[str, None]:
    async with httpx.AsyncClient(timeout=provider.request_timeout_seconds) as client:
        async with client.stream(
            "POST",
            f"{provider.base_url.rstrip('/')}/api/chat",
            json={"model": model, "messages": messages, "stream": True},
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                payload = json.loads(line)
                message = payload.get("message") or {}
                content = message.get("content")
                if content:
                    yield content


async def _stream_openai_compatible(
    provider: AiProvider,
    model: str,
    messages: list[dict[str, str]],
) -> AsyncGenerator[str, None]:
    async with httpx.AsyncClient(timeout=provider.request_timeout_seconds) as client:
        async with client.stream(
            "POST",
            f"{provider.base_url.rstrip('/')}/chat/completions",
            headers=_openai_compatible_headers(provider),
            json={"model": model, "messages": messages, "stream": True},
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                payload = json.loads(data)
                choices = payload.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content")
                if content:
                    yield content


async def _stream_openwebui(
    provider: AiProvider,
    model: str,
    messages: list[dict[str, str]],
) -> AsyncGenerator[str, None]:
    async with httpx.AsyncClient(timeout=provider.request_timeout_seconds) as client:
        async with client.stream(
            "POST",
            f"{provider.base_url.rstrip('/')}/api/chat/completions",
            headers=_openai_compatible_headers(provider),
            json={"model": model, "messages": messages, "stream": True},
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                event = json.loads(data)
                choices = event.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content")
                if content:
                    yield content


async def _stream_anthropic(
    provider: AiProvider,
    model: str,
    messages: list[dict[str, str]],
) -> AsyncGenerator[str, None]:
    system: str | None = None
    filtered: list[dict[str, str]] = []
    for msg in messages:
        if msg.get("role") == "system":
            system = msg.get("content", "")
        else:
            filtered.append(msg)

    body: dict[str, Any] = {
        "model": model,
        "max_tokens": 4096,
        "messages": filtered,
        "stream": True,
    }
    if system:
        body["system"] = system

    headers: dict[str, str] = {"anthropic-version": "2023-06-01", "content-type": "application/json"}
    if provider.api_key:
        headers["x-api-key"] = decrypt_secret(provider.api_key)

    async with httpx.AsyncClient(timeout=provider.request_timeout_seconds) as client:
        async with client.stream(
            "POST",
            f"{provider.base_url.rstrip('/')}/v1/messages",
            headers=headers,
            json=body,
        ) as response:
            response.raise_for_status()
            current_event: str | None = None
            async for line in response.aiter_lines():
                if line.startswith("event:"):
                    current_event = line[6:].strip()
                elif line.startswith("data:") and current_event == "content_block_delta":
                    raw = line[5:].strip()
                    event = json.loads(raw)
                    delta = event.get("delta") or {}
                    if delta.get("type") == "text_delta":
                        text = delta.get("text")
                        if text:
                            yield text


async def stream_provider_response(
    provider: AiProvider,
    *,
    model: str,
    prompt_messages: list[dict[str, str]],
) -> AsyncGenerator[str, None]:
    if provider.provider_type == AiProviderType.ollama:
        async for chunk in _stream_ollama(provider, model, prompt_messages):
            yield chunk
        return
    if provider.provider_type == AiProviderType.openwebui:
        async for chunk in _stream_openwebui(provider, model, prompt_messages):
            yield chunk
        return
    if provider.provider_type == AiProviderType.anthropic:
        async for chunk in _stream_anthropic(provider, model, prompt_messages):
            yield chunk
        return
    async for chunk in _stream_openai_compatible(provider, model, prompt_messages):
        yield chunk


async def collect_provider_response(
    provider: AiProvider,
    *,
    model: str,
    prompt_messages: list[dict[str, str]],
) -> str:
    parts: list[str] = []
    async for chunk in stream_provider_response(provider, model=model, prompt_messages=prompt_messages):
        parts.append(chunk)
    return "".join(parts).strip()


def _extract_action(text: str) -> tuple[str, dict[str, Any] | None]:
    match = ACTION_PATTERN.search(text)
    if not match:
        return text.strip(), None
    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError:
        payload = None
    cleaned = ACTION_PATTERN.sub("", text).strip()
    return cleaned, payload


def _extract_json_blob(text: str) -> dict[str, Any] | None:
    raw = text.strip()
    if not raw:
        return None
    try:
        payload = json.loads(raw)
        return payload if isinstance(payload, dict) else None
    except json.JSONDecodeError:
        pass
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        payload = json.loads(raw[start : end + 1])
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def choose_specialist_fallback(db: Session, *, user_message: str, page_context: AiPageContext | None) -> AiAgent:
    lowered = user_message.lower()
    preferred: AiAgentType
    if any(token in lowered for token in ("run", "execute", "launch", "playbook", "job template", "automation")):
        preferred = AiAgentType.automation_operator
    elif any(token in lowered for token in ("alert", "log", "cpu", "memory", "disk", "prometheus", "loki", "monitor")):
        preferred = AiAgentType.noc_monitor
    elif page_context and page_context.route and page_context.route.startswith("/monitoring"):
        preferred = AiAgentType.noc_monitor
    else:
        preferred = AiAgentType.incident_responder
    agent = get_agent_by_type(db, preferred)
    if agent.is_enabled:
        return agent
    for candidate in list_agents(db):
        if is_specialist_agent(candidate) and candidate.is_enabled:
            return candidate
    raise AiError("No specialist AI agent is enabled")


def parse_manager_route(
    db: Session,
    *,
    text: str,
    user_message: str,
    page_context: AiPageContext | None,
) -> tuple[str, AiAgent | None, str | None]:
    payload = _extract_json_blob(text)
    if payload:
        mode = str(payload.get("mode") or "").strip().lower()
        if mode == "direct":
            reply = str(payload.get("reply") or "").strip()
            if reply:
                return "direct", None, reply
        if mode == "delegate":
            raw_agent_key = str(payload.get("agent_key") or "").strip()
            agent = get_agent_by_key(db, raw_agent_key) if raw_agent_key else None
            if agent is None:
                raw_agent_type = str(payload.get("agent_type") or "").strip()
                try:
                    agent = get_agent_by_type(db, AiAgentType(raw_agent_type))
                except Exception:  # noqa: BLE001
                    agent = None
            if agent is not None and agent.is_enabled and is_specialist_agent(agent):
                return "delegate", agent, None
    return "delegate", choose_specialist_fallback(db, user_message=user_message, page_context=page_context), None


def _tool_for_agent(db: Session, *, tool_id: int, agent: AiAgent) -> AiTool | None:
    return db.execute(
        select(AiTool)
        .join(AiAgentTool, AiAgentTool.tool_id == AiTool.id)
        .where(
            AiTool.id == tool_id,
            AiTool.is_enabled.is_(True),
            AiAgentTool.agent_id == agent.id,
        )
    ).scalar_one_or_none()


def maybe_run_ai_tool(
    db: Session,
    *,
    user: AppUser,
    conversation_id: int,
    user_message: str,
    agent: AiAgent,
    action: dict[str, Any] | None,
) -> PlaybookRun | None:
    if user.role != UserRole.admin:
        return None
    if not action or action.get("type") != "run_ai_tool":
        return None
    if not user_message_allows_execution(user_message):
        return None
    tool_id = action.get("tool_id")
    if not isinstance(tool_id, int):
        return None
    tool = _tool_for_agent(db, tool_id=tool_id, agent=agent)
    if tool is None:
        return None
    template = db.get(JobTemplate, tool.job_template_id)
    if template is None or template.playbook_id is None:
        return None
    playbook = db.get(AnsiblePlaybook, template.playbook_id)
    if playbook is None:
        return None
    run = create_playbook_run(
        db,
        playbook_id=template.playbook_id,
        run_by_id=user.id,
        host_source=PlaybookHostSource.inventory,
        target_host_ids=None,
        inventory_filter_type=template.inventory_filter_type,
        inventory_filter_value=template.inventory_filter_value,
        extra_vars=template.extra_vars,
        job_template_id=template.id,
    )
    launch_playbook_run(run, playbook.repo_id, playbook.path)
    log.info(
        "ai_triggered_tool_run user_id=%s conversation_id=%s agent_type=%s tool_id=%s run_id=%s",
        user.id,
        conversation_id,
        agent.agent_type.value,
        tool.id,
        run.id,
    )
    return run


def get_message_agent_ref(db: Session, message: AiMessage) -> dict[str, Any] | None:
    if message.agent_id is None:
        return None
    agent = db.get(AiAgent, message.agent_id)
    if agent is None:
        return None
    return {
        "id": agent.id,
        "agent_key": agent.agent_key,
        "agent_type": agent.agent_type,
        "name": agent.name,
    }


async def draft_tool_prefill(
    db: Session,
    *,
    template: JobTemplate,
    agent_id: int | None,
    instructions: str | None,
    current_draft: dict[str, Any],
) -> dict[str, Any]:
    fallback = _job_template_prefill_fallback(template)
    agent = get_agent_by_id(db, agent_id) if agent_id is not None else get_agent_by_type(db, AiAgentType.manager)
    if agent is None:
        return {**fallback, "source": "fallback"}
    try:
        provider = get_agent_provider(db, agent)
    except AiError:
        return {**fallback, "source": "fallback"}
    model = agent.model or provider.default_model
    prompt_messages = build_tool_prefill_messages(
        template=template,
        current_draft=current_draft,
        instructions=instructions,
    )
    try:
        raw = await collect_provider_response(provider, model=model, prompt_messages=prompt_messages)
    except Exception:  # noqa: BLE001
        return {**fallback, "source": "fallback"}
    payload = _extract_json_blob(raw)
    if payload is None:
        return {**fallback, "source": "fallback"}
    return {
        "tool_name": str(payload.get("tool_name") or fallback["tool_name"]).strip() or fallback["tool_name"],
        "description": str(payload.get("description") or fallback["description"]).strip() or fallback["description"],
        "when_to_use": str(payload.get("when_to_use") or fallback["when_to_use"]).strip() or fallback["when_to_use"],
        "input_hint": str(payload.get("input_hint") or fallback["input_hint"]).strip() or fallback["input_hint"],
        "example_payload": payload.get("example_payload", fallback["example_payload"]),
        "safety_notes": str(payload.get("safety_notes") or fallback["safety_notes"]).strip()
        or fallback["safety_notes"],
        "source": "ai",
    }
