from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.ai import AiAgentType, AiMessageRole, AiProviderType
from app.schemas.git import PlaybookRunRead


class AiProviderCreate(BaseModel):
    name: str
    provider_type: AiProviderType
    base_url: str
    default_model: str
    api_key: Optional[str] = None
    is_enabled: bool = True
    is_default: bool = False
    request_timeout_seconds: int = 60


class AiProviderUpdate(BaseModel):
    name: Optional[str] = None
    provider_type: Optional[AiProviderType] = None
    base_url: Optional[str] = None
    default_model: Optional[str] = None
    api_key: Optional[str] = None
    is_enabled: Optional[bool] = None
    is_default: Optional[bool] = None
    request_timeout_seconds: Optional[int] = None


class AiProviderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    provider_type: AiProviderType
    base_url: str
    default_model: str
    has_api_key: bool
    is_enabled: bool
    is_default: bool
    request_timeout_seconds: int
    created_at: datetime
    updated_at: datetime


class AiProviderTestRequest(BaseModel):
    provider_type: AiProviderType
    base_url: str
    default_model: Optional[str] = None
    api_key: Optional[str] = None
    request_timeout_seconds: int = 60


class AiProviderModelsRead(BaseModel):
    provider_id: int | None = None
    provider_name: str
    default_model: Optional[str] = None
    models: list[str] = Field(default_factory=list)


class AiSettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    agentic_noc_enabled: bool
    created_at: datetime
    updated_at: datetime


class AiSettingsUpdate(BaseModel):
    agentic_noc_enabled: bool


class AiAgentCreate(BaseModel):
    name: str
    description: Optional[str] = None
    provider_id: Optional[int] = None
    model: Optional[str] = None
    system_prompt: str
    is_enabled: bool = True


class AiAgentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    provider_id: Optional[int] = None
    model: Optional[str] = None
    system_prompt: Optional[str] = None
    is_enabled: Optional[bool] = None


class AiAgentRefRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    agent_key: str
    agent_type: AiAgentType
    name: str


class AiAgentRead(AiAgentRefRead):
    description: Optional[str] = None
    provider_id: Optional[int] = None
    provider_name: Optional[str] = None
    model: Optional[str] = None
    system_prompt: str
    is_enabled: bool
    created_at: datetime
    updated_at: datetime


class AiToolAgentRead(BaseModel):
    id: int
    agent_type: AiAgentType
    name: str


class AiToolCreate(BaseModel):
    job_template_id: int
    is_enabled: bool = True
    tool_name: str
    description: Optional[str] = None
    when_to_use: Optional[str] = None
    input_hint: Optional[str] = None
    example_payload: Any = None
    safety_notes: Optional[str] = None
    agent_ids: list[int] = Field(default_factory=list)


class AiToolUpdate(BaseModel):
    is_enabled: Optional[bool] = None
    tool_name: Optional[str] = None
    description: Optional[str] = None
    when_to_use: Optional[str] = None
    input_hint: Optional[str] = None
    example_payload: Any = None
    safety_notes: Optional[str] = None
    agent_ids: Optional[list[int]] = None


class AiToolRead(BaseModel):
    id: int
    job_template_id: int
    job_template_name: str
    playbook_id: Optional[int] = None
    is_enabled: bool
    tool_name: str
    description: Optional[str] = None
    when_to_use: Optional[str] = None
    input_hint: Optional[str] = None
    example_payload: Any = None
    safety_notes: Optional[str] = None
    assigned_agents: list[AiToolAgentRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class AiToolCandidateRead(BaseModel):
    job_template_id: int
    job_template_name: str
    playbook_id: Optional[int] = None
    runbook_enabled: bool
    runbook_category: Optional[str] = None
    recommended_when: Optional[str] = None
    risk_level: Optional[str] = None
    ai_tool_id: Optional[int] = None
    ai_enabled: bool = False


class AiToolPrefillRequest(BaseModel):
    job_template_id: int
    agent_id: Optional[int] = None
    instructions: Optional[str] = None
    current_tool_name: Optional[str] = None
    current_description: Optional[str] = None
    current_when_to_use: Optional[str] = None
    current_input_hint: Optional[str] = None
    current_safety_notes: Optional[str] = None


class AiToolPrefillRead(BaseModel):
    tool_name: str
    description: Optional[str] = None
    when_to_use: Optional[str] = None
    input_hint: Optional[str] = None
    example_payload: Any = None
    safety_notes: Optional[str] = None
    source: str


class AiMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: AiMessageRole
    content: str
    context_summary: Optional[str] = None
    agent: Optional[AiAgentRefRead] = None
    created_at: datetime


class AiConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    provider_id: Optional[int] = None
    model: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class AiConversationDetailRead(AiConversationRead):
    messages: list[AiMessageRead]


class AiPageContext(BaseModel):
    route: Optional[str] = None
    host_id: Optional[int] = None
    monitoring_host_id: Optional[int] = None
    job_template_id: Optional[int] = None
    playbook_run_id: Optional[int] = None
    editor_title: Optional[str] = None
    editor_language: Optional[str] = None
    editor_content: Optional[str] = None


class AiChatStreamRequest(BaseModel):
    conversation_id: Optional[int] = None
    message: str
    page_context: Optional[AiPageContext] = None


class AiAgentPromptAssistRequest(BaseModel):
    agent_id: int
    current_prompt: Optional[str] = None
    message: str


class AiChatResult(BaseModel):
    conversation: AiConversationRead
    assistant_message: AiMessageRead
    triggered_run: Optional[PlaybookRunRead] = None
