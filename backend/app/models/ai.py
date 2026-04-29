import enum

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy import (
    Enum as SAEnum,
)

from .base import Base


class AiProviderType(str, enum.Enum):
    ollama = "ollama"
    openai_compatible = "openai_compatible"
    openwebui = "openwebui"
    anthropic = "anthropic"


class AiMessageRole(str, enum.Enum):
    system = "system"
    user = "user"
    assistant = "assistant"


class AiAgentType(str, enum.Enum):
    manager = "manager"
    noc_monitor = "noc_monitor"
    incident_responder = "incident_responder"
    automation_operator = "automation_operator"
    custom = "custom"


class AiProvider(Base):
    __tablename__ = "ai_providers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(128), unique=True, nullable=False)
    provider_type = Column(SAEnum(AiProviderType), nullable=False)
    base_url = Column(String(512), nullable=False)
    default_model = Column(String(255), nullable=False)
    api_key = Column(Text, nullable=True)
    is_enabled = Column(Boolean, nullable=False, default=True)
    is_default = Column(Boolean, nullable=False, default=False)
    request_timeout_seconds = Column(Integer, nullable=False, default=60)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class AiFeatureSettings(Base):
    __tablename__ = "ai_feature_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    agentic_noc_enabled = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class AiAgent(Base):
    __tablename__ = "ai_agents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    agent_type = Column(SAEnum(AiAgentType), nullable=False)
    agent_key = Column(String(128), nullable=False, unique=True)
    name = Column(String(128), nullable=False)
    description = Column(Text, nullable=True)
    provider_id = Column(Integer, ForeignKey("ai_providers.id", ondelete="SET NULL"), nullable=True)
    model = Column(String(255), nullable=True)
    system_prompt = Column(Text, nullable=False)
    is_enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class AiUserPreference(Base):
    __tablename__ = "ai_user_preferences"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    system_prompt = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class AiConversation(Base):
    __tablename__ = "ai_conversations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    provider_id = Column(Integer, ForeignKey("ai_providers.id", ondelete="SET NULL"), nullable=True)
    model = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class AiMessage(Base):
    __tablename__ = "ai_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(Integer, ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(SAEnum(AiMessageRole), nullable=False)
    content = Column(Text, nullable=False)
    context_summary = Column(Text, nullable=True)
    agent_id = Column(Integer, ForeignKey("ai_agents.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class AiTool(Base):
    __tablename__ = "ai_tools"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_template_id = Column(Integer, ForeignKey("job_templates.id", ondelete="CASCADE"), nullable=False, unique=True)
    is_enabled = Column(Boolean, nullable=False, default=True)
    tool_name = Column(String(128), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    when_to_use = Column(Text, nullable=True)
    input_hint = Column(Text, nullable=True)
    example_payload = Column(JSON, nullable=True)
    safety_notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class AiAgentTool(Base):
    __tablename__ = "ai_agent_tools"

    id = Column(Integer, primary_key=True, autoincrement=True)
    agent_id = Column(Integer, ForeignKey("ai_agents.id", ondelete="CASCADE"), nullable=False)
    tool_id = Column(Integer, ForeignKey("ai_tools.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    __table_args__ = (UniqueConstraint("agent_id", "tool_id", name="uq_ai_agent_tools_agent_tool"),)
