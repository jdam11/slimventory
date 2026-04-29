import {
  DeleteOutlined,
  EditOutlined,
  MessageOutlined,
  PlusOutlined,
  RobotOutlined,
  SaveOutlined,
  SettingOutlined,
  UpOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Empty,
  Form,
  Grid,
  Input,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tabs,
  Typography,
  theme as antdTheme,
  message,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  createAiAgent,
  createAiConversation,
  createAiProvider,
  createAiTool,
  deleteAiAgent,
  deleteAiConversation,
  deleteAiProvider,
  deleteAiTool,
  getAiConversation,
  getAiSettings,
  listAdminAiProviders,
  listAiAgents,
  listAiConversations,
  listAiProviderModels,
  listAiToolCandidates,
  listAiTools,
  prefillAiTool,
  streamAiPromptAssist,
  streamAssistantChat,
  testAiProvider,
  updateAiAgent,
  updateAiProvider,
  updateAiSettings,
  updateAiTool,
} from "../api/ai";
import PlaybookRunOutput from "./PlaybookRunOutput";
import { useAuth } from "../store/AuthContext";
import type {
  AiAgent,
  AiConversation,
  AiProvider,
  AiProviderModels,
  AiProviderType,
  AiTool,
  AiToolCandidate,
  PlaybookRun,
} from "../types";

const { Paragraph, Text, Title } = Typography;
const { useBreakpoint } = Grid;

interface Props {
  embedded?: boolean;
  mode?: "page" | "popup";
  showChat?: boolean;
  showAdminTabs?: boolean;
  showSharedEditor?: boolean;
  pageContext?: {
    route?: string;
    host_id?: number | null;
    monitoring_host_id?: number | null;
    job_template_id?: number | null;
    playbook_run_id?: number | null;
    editor_title?: string | null;
    editor_language?: string | null;
    editor_content?: string | null;
  };
}

interface ProviderFormValues {
  name: string;
  provider_type: AiProviderType;
  base_url: string;
  default_model: string;
  api_key?: string;
  is_enabled: boolean;
  is_default: boolean;
  request_timeout_seconds: number;
}

interface AgentFormValues {
  name: string;
  description?: string;
  provider_id?: number;
  model?: string;
  system_prompt: string;
  is_enabled: boolean;
  assist_request?: string;
}

interface ToolFormValues {
  job_template_id: number;
  is_enabled: boolean;
  tool_name: string;
  description?: string;
  when_to_use?: string;
  input_hint?: string;
  example_payload_raw?: string;
  safety_notes?: string;
  agent_ids: number[];
  prefill_instructions?: string;
}

const DEFAULT_PROMPT_ASSIST_REQUEST =
  "Tighten this agent prompt for homelab operations. Keep it practical, concise, and aligned with safe zero-trust operations.";
const DEFAULT_CUSTOM_AGENT_PROMPT =
  "You are a specialist AI agent inside SLIM's homelab NOC/IT system. Stay practical, grounded in current SLIM context, and only use approved tools when explicitly asked.";

function MarkdownMessage({ content }: { content: string }) {
  const { token } = antdTheme.useToken();

  return (
    <div style={{ lineHeight: 1.65 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: "0 0 0.85em" }}>{children}</p>,
          ul: ({ children }) => <ul style={{ margin: "0 0 0.85em 1.25em", padding: 0 }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: "0 0 0.85em 1.25em", padding: 0 }}>{children}</ol>,
          li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote
              style={{
                margin: "0 0 0.85em",
                paddingLeft: 12,
                borderLeft: `3px solid ${token.colorPrimaryBorder}`,
                color: token.colorTextSecondary,
              }}
            >
              {children}
            </blockquote>
          ),
          pre: ({ children }) => <pre style={{ margin: "0 0 0.85em" }}>{children}</pre>,
          code: ({ className, children }) =>
            !className ? (
              <code
                style={{
                  padding: "0.1em 0.35em",
                  borderRadius: 4,
                  background: token.colorFillSecondary,
                  fontFamily: "SFMono-Regular, Consolas, monospace",
                }}
              >
                {children}
              </code>
            ) : (
              <code
                className={className}
                style={{
                  display: "block",
                  padding: 12,
                  borderRadius: 8,
                  overflowX: "auto",
                  whiteSpace: "pre",
                  background: token.colorFillSecondary,
                  fontFamily: "SFMono-Regular, Consolas, monospace",
                }}
              >
                {children}
              </code>
            ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function MessageContent({ content, markdown = false }: { content: string; markdown?: boolean }) {
  if (!markdown) {
    return <div style={{ whiteSpace: "pre-wrap" }}>{content}</div>;
  }
  return <MarkdownMessage content={content} />;
}

function agentTypeLabel(agentType: AiAgent["agent_type"]): string {
  if (agentType === "manager") return "Manager";
  if (agentType === "noc_monitor") return "NOC Monitor";
  if (agentType === "incident_responder") return "Incident Responder";
  if (agentType === "custom") return "Custom Specialist";
  return "Automation Operator";
}

function serializeJson(value: unknown): string {
  if (value == null || value === "") {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

const OPENAI_COMPATIBLE_PRESETS = [
  { label: "OpenAI",          base_url: "https://api.openai.com/v1",                                 default_model: "gpt-4o" },
  { label: "Groq",            base_url: "https://api.groq.com/openai/v1",                            default_model: "llama-3.3-70b-versatile" },
  { label: "Mistral",         base_url: "https://api.mistral.ai/v1",                                 default_model: "mistral-large-latest" },
  { label: "Google Gemini",   base_url: "https://generativelanguage.googleapis.com/v1beta/openai",   default_model: "gemini-2.0-flash" },
  { label: "OpenRouter",      base_url: "https://openrouter.ai/api/v1",                              default_model: "openai/gpt-4o" },
  { label: "Together AI",     base_url: "https://api.together.xyz/v1",                               default_model: "meta-llama/Llama-3-70b-chat-hf" },
  { label: "Perplexity",      base_url: "https://api.perplexity.ai",                                 default_model: "llama-3.1-sonar-large-128k-online" },
  { label: "xAI / Grok",     base_url: "https://api.x.ai/v1",                                       default_model: "grok-2-latest" },
  { label: "LM Studio Local", base_url: "http://localhost:1234/v1",                                  default_model: "local-model" },
  { label: "LM Studio Cloud", base_url: "https://cloud.lmstudio.ai",                                 default_model: "llama-3.3-70b-instruct" },
];

const OLLAMA_PRESETS = [
  { label: "Local (Docker)",  base_url: "http://ollama:11434",   default_model: "llama3" },
  { label: "Local (Native)", base_url: "http://localhost:11434", default_model: "llama3" },
];

const OPENWEBUI_PRESETS = [
  { label: "Self-hosted", base_url: "https://openwebui.example.com", default_model: "" },
];

type ProviderPreset = { label: string; base_url: string; default_model: string };

export default function AssistantPanel({
  embedded = false,
  mode = "page",
  showChat = true,
  showAdminTabs = !embedded && mode !== "popup",
  showSharedEditor = false,
  pageContext,
}: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { token } = antdTheme.useToken();
  const isAdmin = user?.role === "admin";
  const screens = useBreakpoint();
  const isCompact = mode === "popup";
  const isMobile = !screens.md;
  const draftStorageKey = "slim-ai-draft";
  const conversationStorageKey = "slim-ai-conversation-id";
  const editorTitleStorageKey = "slim-ai-editor-title";
  const editorLanguageStorageKey = "slim-ai-editor-language";
  const editorContentStorageKey = "slim-ai-editor-content";
  const [draft, setDraft] = useState(() => window.localStorage.getItem(draftStorageKey) ?? "");
  const [activeConversationId, setActiveConversationId] = useState<number | null>(() => {
    const raw = window.localStorage.getItem(conversationStorageKey);
    return raw ? Number(raw) || null : null;
  });
  const [sharedEditorTitle, setSharedEditorTitle] = useState(
    () => window.localStorage.getItem(editorTitleStorageKey) ?? ""
  );
  const [sharedEditorLanguage, setSharedEditorLanguage] = useState(
    () => window.localStorage.getItem(editorLanguageStorageKey) ?? "text"
  );
  const [sharedEditorContent, setSharedEditorContent] = useState(
    () => window.localStorage.getItem(editorContentStorageKey) ?? ""
  );
  const [streaming, setStreaming] = useState(false);
  const [streamedReply, setStreamedReply] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [activeAgentName, setActiveAgentName] = useState<string | null>(null);
  const [lastTriggeredRun, setLastTriggeredRun] = useState<PlaybookRun | null>(null);
  const [popupView, setPopupView] = useState<"chat" | "run">("chat");
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AiProvider | null>(null);
  const [providerModelSuggestions, setProviderModelSuggestions] = useState<string[]>([]);
  const [providerModelError, setProviderModelError] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AiAgent | null>(null);
  const [promptAssistStreaming, setPromptAssistStreaming] = useState(false);
  const [promptAssistDraft, setPromptAssistDraft] = useState("");
  const [promptAssistError, setPromptAssistError] = useState<string | null>(null);
  const [toolModalOpen, setToolModalOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<AiTool | null>(null);
  const [toolPrefillLoading, setToolPrefillLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [providerForm] = Form.useForm<ProviderFormValues>();
  const [agentForm] = Form.useForm<AgentFormValues>();
  const [toolForm] = Form.useForm<ToolFormValues>();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["/ai/admin/settings"],
    queryFn: getAiSettings,
    enabled: isAdmin,
  });
  const adminProvidersQuery = useQuery({
    queryKey: ["/ai/admin/providers"],
    queryFn: listAdminAiProviders,
    enabled: isAdmin,
  });
  const agentsQuery = useQuery({
    queryKey: ["/ai/admin/agents"],
    queryFn: listAiAgents,
    enabled: isAdmin,
  });
  const toolCandidatesQuery = useQuery({
    queryKey: ["/ai/admin/tool-candidates"],
    queryFn: listAiToolCandidates,
    enabled: isAdmin && !isCompact,
  });
  const toolsQuery = useQuery({
    queryKey: ["/ai/admin/tools"],
    queryFn: listAiTools,
    enabled: isAdmin && !isCompact,
  });
  const conversationsQuery = useQuery({
    queryKey: ["/ai/conversations"],
    queryFn: () => listAiConversations(0, 100),
    enabled: isAdmin,
  });
  const conversationQuery = useQuery({
    queryKey: ["/ai/conversations", activeConversationId],
    queryFn: () => getAiConversation(activeConversationId!),
    enabled: isAdmin && !!activeConversationId,
  });
  const providerOptions = adminProvidersQuery.data ?? [];
  const providerTypeValue = Form.useWatch("provider_type", providerForm);
  const providerBaseUrlValue = Form.useWatch("base_url", providerForm);
  const selectedAgentProviderId = Form.useWatch("provider_id", agentForm);
  const effectiveAgentProvider = useMemo(() => {
    if (selectedAgentProviderId != null) {
      return providerOptions.find((provider) => provider.id === selectedAgentProviderId) ?? null;
    }
    return providerOptions.find((provider) => provider.is_default) ?? providerOptions.find((provider) => provider.is_enabled) ?? null;
  }, [providerOptions, selectedAgentProviderId]);
  const agentProviderModelsQuery = useQuery({
    queryKey: ["/ai/admin/providers", effectiveAgentProvider?.id, "models"],
    queryFn: () => listAiProviderModels(effectiveAgentProvider!.id),
    enabled: isAdmin && agentModalOpen && !!effectiveAgentProvider?.id,
    retry: false,
  });

  useEffect(() => {
    if (!providerModalOpen) {
      setSelectedPreset(null);
      return;
    }
    setSelectedPreset(null);
    setProviderModelError(null);
    setProviderModelSuggestions([]);
  }, [providerTypeValue, providerModalOpen]);

  useEffect(() => {
    if (!providerModalOpen) return;
    setProviderModelError(null);
    setProviderModelSuggestions([]);
  }, [providerBaseUrlValue, providerModalOpen]);

  useEffect(() => {
    window.localStorage.setItem(draftStorageKey, draft);
  }, [draft]);

  useEffect(() => {
    window.localStorage.setItem(editorTitleStorageKey, sharedEditorTitle);
  }, [editorTitleStorageKey, sharedEditorTitle]);

  useEffect(() => {
    window.localStorage.setItem(editorLanguageStorageKey, sharedEditorLanguage);
  }, [editorLanguageStorageKey, sharedEditorLanguage]);

  useEffect(() => {
    window.localStorage.setItem(editorContentStorageKey, sharedEditorContent);
  }, [editorContentStorageKey, sharedEditorContent]);

  useEffect(() => {
    if (activeConversationId) {
      window.localStorage.setItem(conversationStorageKey, String(activeConversationId));
    } else {
      window.localStorage.removeItem(conversationStorageKey);
    }
  }, [activeConversationId]);

  useEffect(() => {
    if (!activeConversationId && conversationsQuery.data?.items?.length) {
      setActiveConversationId(conversationsQuery.data.items[0].id);
    }
  }, [activeConversationId, conversationsQuery.data]);

  useEffect(() => {
    if (isCompact && lastTriggeredRun) {
      setPopupView("run");
    }
  }, [isCompact, lastTriggeredRun]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationQuery.data, streamedReply]);

  const createConversationMutation = useMutation({
    mutationFn: createAiConversation,
    onSuccess: async (conversation) => {
      await qc.invalidateQueries({ queryKey: ["/ai/conversations"] });
      setActiveConversationId(conversation.id);
    },
  });
  const deleteConversationMutation = useMutation({
    mutationFn: deleteAiConversation,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/ai/conversations"] });
      setActiveConversationId(null);
    },
  });
  const updateSettingsMutation = useMutation({
    mutationFn: updateAiSettings,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/ai/admin/settings"] });
      message.success("AI feature settings updated.");
    },
  });
  const createAgentMutation = useMutation({
    mutationFn: createAiAgent,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/ai/admin/agents"] });
      await qc.invalidateQueries({ queryKey: ["/ai/admin/tools"] });
      message.success("AI agent created.");
      setAgentModalOpen(false);
      setPromptAssistDraft("");
      setPromptAssistError(null);
    },
  });
  const createProviderMutation = useMutation({
    mutationFn: createAiProvider,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/ai/admin/providers"] });
      message.success("AI provider created.");
      setProviderModalOpen(false);
    },
  });
  const testProviderMutation = useMutation({
    mutationFn: testAiProvider,
    onSuccess: (result) => {
      applyProviderModelResult(result);
      message.success(
        result.models.length > 0
          ? `Loaded ${result.models.length} model${result.models.length === 1 ? "" : "s"} from provider.`
          : "Provider connection succeeded, but no models were returned."
      );
    },
    onError: (error: unknown) => {
      const detail =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (error as Error).message ??
        "Provider test failed.";
      setProviderModelError(detail);
      message.error(detail);
    },
  });
  const updateProviderMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<ProviderFormValues> }) => updateAiProvider(id, payload),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/ai/admin/providers"] });
      await qc.invalidateQueries({ queryKey: ["/ai/admin/agents"] });
      message.success("AI provider updated.");
      setProviderModalOpen(false);
    },
  });
  const deleteProviderMutation = useMutation({
    mutationFn: deleteAiProvider,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/ai/admin/providers"] });
      await qc.invalidateQueries({ queryKey: ["/ai/admin/agents"] });
      message.success("AI provider deleted.");
    },
  });
  const updateAgentMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: Partial<{
        name: string;
        description: string | null;
        provider_id: number | null;
        model: string | null;
        system_prompt: string;
        is_enabled: boolean;
      }>;
    }) => updateAiAgent(id, payload),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/ai/admin/agents"] });
      message.success("AI agent updated.");
      setAgentModalOpen(false);
      setPromptAssistDraft("");
      setPromptAssistError(null);
    },
  });
  const deleteAgentMutation = useMutation({
    mutationFn: deleteAiAgent,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/ai/admin/agents"] });
      await qc.invalidateQueries({ queryKey: ["/ai/admin/tools"] });
      message.success("AI agent deleted.");
    },
  });
  const createToolMutation = useMutation({
    mutationFn: createAiTool,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/ai/admin/tools"] });
      await qc.invalidateQueries({ queryKey: ["/ai/admin/tool-candidates"] });
      message.success("AI tool created.");
      setToolModalOpen(false);
    },
  });
  const updateToolMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) => updateAiTool(id, payload),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/ai/admin/tools"] });
      await qc.invalidateQueries({ queryKey: ["/ai/admin/tool-candidates"] });
      message.success("AI tool updated.");
      setToolModalOpen(false);
    },
  });
  const deleteToolMutation = useMutation({
    mutationFn: deleteAiTool,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/ai/admin/tools"] });
      await qc.invalidateQueries({ queryKey: ["/ai/admin/tool-candidates"] });
      message.success("AI tool deleted.");
    },
  });

  const currentMessages = conversationQuery.data?.messages ?? [];
  const conversationList = conversationsQuery.data?.items ?? [];
  const agents = agentsQuery.data ?? [];
  const tools = toolsQuery.data ?? [];
  const toolCandidates = toolCandidatesQuery.data ?? [];
  const specialistAgents = useMemo(
    () => agents.filter((agent) => agent.agent_type !== "manager"),
    [agents]
  );
  const agentProviderModels = agentProviderModelsQuery.data?.models ?? [];
  const agentProviderDefaultModel = agentProviderModelsQuery.data?.default_model ?? effectiveAgentProvider?.default_model ?? "";
  const agentModelOptions = useMemo(
    () =>
      Array.from(new Set([agentProviderDefaultModel, ...agentProviderModels].filter(Boolean))).map((model) => ({
        value: model,
        label: model === agentProviderDefaultModel ? `${model} (provider default)` : model,
      })),
    [agentProviderDefaultModel, agentProviderModels]
  );
  const effectivePageContext = useMemo(() => {
    const baseContext = pageContext ?? { route: window.location.pathname };
    if (!showSharedEditor || !sharedEditorContent.trim()) {
      return baseContext;
    }
    return {
      ...baseContext,
      editor_title: sharedEditorTitle.trim() || null,
      editor_language: sharedEditorLanguage.trim() || null,
      editor_content: sharedEditorContent,
    };
  }, [pageContext, sharedEditorContent, sharedEditorLanguage, sharedEditorTitle, showSharedEditor]);

  function loadMessageIntoEditor(content: string) {
    setSharedEditorContent(content);
    if (!sharedEditorTitle.trim()) {
      setSharedEditorTitle("scratch.txt");
    }
  }

  function clearSharedEditor() {
    setSharedEditorTitle("");
    setSharedEditorLanguage("text");
    setSharedEditorContent("");
  }

  async function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed || streaming || !settingsQuery.data?.agentic_noc_enabled) {
      return;
    }
    setStreaming(true);
    setStreamedReply("");
    setStreamError(null);
    setLastTriggeredRun(null);
    setPopupView("chat");
    setActiveAgentName(null);

    let conversationId = activeConversationId;
    if (!conversationId) {
      const conversation = await createConversationMutation.mutateAsync();
      conversationId = conversation.id;
      setActiveConversationId(conversation.id);
    }

    try {
      await streamAssistantChat(
        {
          conversation_id: conversationId,
          message: trimmed,
          page_context: effectivePageContext,
        },
        {
          onEvent: async (event) => {
            const type = String(event.type ?? "");
            if (type === "agent_selected") {
              const agent = event.agent as { name?: string } | undefined;
              setActiveAgentName(agent?.name ?? null);
            } else if (type === "chunk") {
              setStreamedReply((prev) => prev + String(event.text ?? ""));
            } else if (type === "message_complete") {
              if (event.triggered_run) {
                setLastTriggeredRun(event.triggered_run as PlaybookRun);
              }
              const agent = event.agent as { name?: string } | undefined;
              setActiveAgentName(agent?.name ?? activeAgentName);
              setStreaming(false);
              setDraft("");
              await qc.invalidateQueries({ queryKey: ["/ai/conversations"] });
              await qc.invalidateQueries({ queryKey: ["/ai/conversations", conversationId] });
            } else if (type === "error") {
              setStreaming(false);
              setStreamError(String(event.message ?? "Assistant stream failed"));
            }
          },
        }
      );
    } catch (error) {
      setStreamError((error as Error).message);
      setStreaming(false);
    }
  }

  function openCreateProvider() {
    setEditingProvider(null);
    setProviderModelSuggestions([]);
    setProviderModelError(null);
    providerForm.resetFields();
    providerForm.setFieldsValue({
      provider_type: "ollama",
      is_enabled: true,
      is_default: false,
      request_timeout_seconds: 60,
    });
    setProviderModalOpen(true);
  }

  function openEditProvider(provider: AiProvider) {
    setEditingProvider(provider);
    setProviderModelSuggestions([]);
    setProviderModelError(null);
    providerForm.setFieldsValue({
      name: provider.name,
      provider_type: provider.provider_type,
      base_url: provider.base_url,
      default_model: provider.default_model,
      api_key: "",
      is_enabled: provider.is_enabled,
      is_default: provider.is_default,
      request_timeout_seconds: provider.request_timeout_seconds,
    });
    setProviderModalOpen(true);
  }

  function applyProviderModelResult(result: AiProviderModels) {
    setProviderModelError(null);
    setProviderModelSuggestions(result.models);
    const currentDefaultModel = providerForm.getFieldValue("default_model") as string | undefined;
    if (!currentDefaultModel?.trim()) {
      const suggestedDefault = result.default_model ?? result.models[0];
      if (suggestedDefault) {
        providerForm.setFieldValue("default_model", suggestedDefault);
      }
    }
  }

  function handlePresetChange(presetLabel: string, presets: ProviderPreset[]) {
    const preset = presets.find((p) => p.label === presetLabel);
    if (!preset) return;
    setSelectedPreset(presetLabel);
    providerForm.setFieldsValue({ base_url: preset.base_url, default_model: preset.default_model });
    setProviderModelSuggestions([]);
    setProviderModelError(null);
  }

  async function handleProviderSubmit(values: ProviderFormValues) {
    const payload = {
      ...values,
      api_key: values.api_key?.trim() ? values.api_key.trim() : undefined,
    };
    if (editingProvider) {
      await updateProviderMutation.mutateAsync({ id: editingProvider.id, payload });
    } else {
      await createProviderMutation.mutateAsync(payload);
    }
  }

  async function handleTestProvider() {
    setProviderModelError(null);
    const values = await providerForm.validateFields([
      "provider_type",
      "base_url",
      "request_timeout_seconds",
      "api_key",
    ]);
    await testProviderMutation.mutateAsync({
      provider_type: values.provider_type,
      base_url: values.base_url.trim(),
      default_model: values.default_model?.trim() || null,
      api_key: values.api_key?.trim() || null,
      request_timeout_seconds: Number(values.request_timeout_seconds),
    });
  }

  function openEditAgent(agent: AiAgent) {
    setEditingAgent(agent);
    setPromptAssistDraft("");
    setPromptAssistError(null);
    agentForm.setFieldsValue({
      name: agent.name,
      description: agent.description ?? "",
      provider_id: agent.provider_id ?? undefined,
      model: agent.model ?? undefined,
      system_prompt: agent.system_prompt,
      is_enabled: agent.is_enabled,
      assist_request: DEFAULT_PROMPT_ASSIST_REQUEST,
    });
    setAgentModalOpen(true);
  }

  function openCreateAgent() {
    setEditingAgent(null);
    setPromptAssistDraft("");
    setPromptAssistError(null);
    agentForm.resetFields();
    agentForm.setFieldsValue({
      name: "",
      description: "",
      provider_id: undefined,
      model: undefined,
      system_prompt: DEFAULT_CUSTOM_AGENT_PROMPT,
      is_enabled: true,
      assist_request: DEFAULT_PROMPT_ASSIST_REQUEST,
    });
    setAgentModalOpen(true);
  }

  async function handleAgentSubmit(values: AgentFormValues) {
    const payload = {
      name: values.name.trim(),
      description: values.description?.trim() || null,
      provider_id: values.provider_id ?? null,
      model: values.model?.trim() || null,
      system_prompt: values.system_prompt.trim(),
      is_enabled: values.is_enabled,
    };
    if (editingAgent) {
      await updateAgentMutation.mutateAsync({
        id: editingAgent.id,
        payload,
      });
    } else {
      await createAgentMutation.mutateAsync(payload);
    }
  }

  async function handlePromptAssist() {
    if (!editingAgent) {
      return;
    }
    const values = await agentForm.validateFields(["system_prompt", "assist_request"]);
    const request = values.assist_request?.trim();
    if (!request) {
      message.error("Describe how the agent prompt should change.");
      return;
    }
    setPromptAssistStreaming(true);
    setPromptAssistDraft("");
    setPromptAssistError(null);
    try {
      await streamAiPromptAssist(
        {
          agent_id: editingAgent.id,
          current_prompt: values.system_prompt,
          message: request,
        },
        {
          onEvent: (event) => {
            const type = String(event.type ?? "");
            if (type === "chunk") {
              setPromptAssistDraft((prev) => prev + String(event.text ?? ""));
            } else if (type === "message_complete") {
              setPromptAssistStreaming(false);
            } else if (type === "error") {
              setPromptAssistStreaming(false);
              setPromptAssistError(String(event.message ?? "Prompt assist failed"));
            }
          },
        }
      );
    } catch (error) {
      setPromptAssistStreaming(false);
      setPromptAssistError((error as Error).message);
    }
  }

  function openCreateTool() {
    setEditingTool(null);
    toolForm.resetFields();
    toolForm.setFieldsValue({
      is_enabled: true,
      agent_ids: [],
      prefill_instructions: "",
    });
    setToolModalOpen(true);
  }

  function openEditTool(tool: AiTool) {
    setEditingTool(tool);
    toolForm.setFieldsValue({
      job_template_id: tool.job_template_id,
      is_enabled: tool.is_enabled,
      tool_name: tool.tool_name,
      description: tool.description ?? "",
      when_to_use: tool.when_to_use ?? "",
      input_hint: tool.input_hint ?? "",
      example_payload_raw: serializeJson(tool.example_payload),
      safety_notes: tool.safety_notes ?? "",
      agent_ids: tool.assigned_agents.map((agent) => agent.id),
      prefill_instructions: "",
    });
    setToolModalOpen(true);
  }

  async function handleToolPrefill() {
    const values = toolForm.getFieldsValue();
    if (!values.job_template_id) {
      message.error("Choose a job template first.");
      return;
    }
    setToolPrefillLoading(true);
    try {
      const prefills = await prefillAiTool({
        job_template_id: values.job_template_id,
        instructions: values.prefill_instructions?.trim() || null,
        current_tool_name: values.tool_name?.trim() || null,
        current_description: values.description?.trim() || null,
        current_when_to_use: values.when_to_use?.trim() || null,
        current_input_hint: values.input_hint?.trim() || null,
        current_safety_notes: values.safety_notes?.trim() || null,
      });
      toolForm.setFieldsValue({
        tool_name: prefills.tool_name,
        description: prefills.description ?? "",
        when_to_use: prefills.when_to_use ?? "",
        input_hint: prefills.input_hint ?? "",
        example_payload_raw: serializeJson(prefills.example_payload),
        safety_notes: prefills.safety_notes ?? "",
      });
      message.success(prefills.source === "ai" ? "Tool metadata drafted with AI." : "Tool metadata filled from template defaults.");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setToolPrefillLoading(false);
    }
  }

  async function handleToolSubmit(values: ToolFormValues) {
    let examplePayload: unknown = null;
    if (values.example_payload_raw?.trim()) {
      try {
        examplePayload = JSON.parse(values.example_payload_raw);
      } catch {
        message.error("Example payload must be valid JSON.");
        return;
      }
    }

    const payload = {
      job_template_id: values.job_template_id,
      is_enabled: values.is_enabled,
      tool_name: values.tool_name.trim(),
      description: values.description?.trim() || null,
      when_to_use: values.when_to_use?.trim() || null,
      input_hint: values.input_hint?.trim() || null,
      example_payload: examplePayload,
      safety_notes: values.safety_notes?.trim() || null,
      agent_ids: values.agent_ids ?? [],
    };

    if (editingTool) {
      await updateToolMutation.mutateAsync({ id: editingTool.id, payload });
    } else {
      await createToolMutation.mutateAsync(payload);
    }
  }

  if (!isAdmin) {
    return <Alert type="warning" showIcon message="AI access is restricted to admins." />;
  }

  const conversationSelector = isCompact ? (
    <Card size="small" styles={{ body: { paddingBottom: 12 } }}>
      <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
        <Space wrap>
          <Select
            placeholder="Recent conversations"
            style={{ minWidth: isMobile ? 180 : 260 }}
            value={activeConversationId ?? undefined}
            onChange={(value) => setActiveConversationId(value)}
            options={conversationList.map((item) => ({
              value: item.id,
              label: item.title,
            }))}
          />
          <Button size="small" icon={<PlusOutlined />} onClick={() => createConversationMutation.mutate()}>
            New
          </Button>
        </Space>
        {activeConversationId ? (
          <Popconfirm title="Delete this conversation?" onConfirm={() => deleteConversationMutation.mutate(activeConversationId)}>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        ) : null}
      </Space>
    </Card>
  ) : (
    <Card
      size="small"
      title="Conversations"
      extra={
        <Button size="small" icon={<PlusOutlined />} onClick={() => createConversationMutation.mutate()}>
          New
        </Button>
      }
    >
      <List<AiConversation>
        size="small"
        dataSource={conversationList}
        locale={{ emptyText: "No saved conversations yet." }}
        renderItem={(item) => (
          <List.Item
            style={{
              cursor: "pointer",
              paddingInline: 8,
              borderRadius: 6,
              background: item.id === activeConversationId ? token.colorPrimaryBg : undefined,
            }}
            onClick={() => setActiveConversationId(item.id)}
            actions={[
              <Popconfirm
                key="delete"
                title="Delete this conversation?"
                onConfirm={(e) => {
                  e?.stopPropagation();
                  deleteConversationMutation.mutate(item.id);
                }}
              >
                <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              title={<Text ellipsis>{item.title}</Text>}
              description={<Text type="secondary">{new Date(item.updated_at).toLocaleString()}</Text>}
            />
          </List.Item>
        )}
      />
    </Card>
  );

  const chatContent = (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isCompact ? "minmax(0, 1fr)" : embedded ? "280px minmax(0, 1fr)" : "240px minmax(0, 1fr)",
        gap: 16,
        minHeight: isCompact ? undefined : embedded ? "calc(100vh - 220px)" : 560,
      }}
    >
      {!isCompact && conversationSelector}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {isCompact && conversationSelector}
        <Card size="small">
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {!settingsQuery.data?.agentic_noc_enabled && (
              <Alert
                type="warning"
                showIcon
                message="Agentic NOC / IT is disabled"
                description={
                  showAdminTabs
                    ? "Enable the feature in AI Settings before sending chat requests."
                    : "Chat is disabled until an admin enables the AI feature in Admin > AI Settings."
                }
              />
            )}
            <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
              <Space wrap>
                <Tag color="blue">Manager-first routing</Tag>
                <Tag>{effectivePageContext.route ?? window.location.pathname}</Tag>
                {activeAgentName ? <Tag color="purple">{activeAgentName}</Tag> : <Tag>Awaiting route</Tag>}
                {isCompact && <Tag icon={<MessageOutlined />}>Popup chat</Tag>}
                {showSharedEditor && sharedEditorContent.trim() && (
                  <Tag color="geekblue">
                    {sharedEditorTitle.trim() || "Untitled buffer"}
                    {sharedEditorLanguage.trim() ? ` · ${sharedEditorLanguage.trim()}` : ""}
                  </Tag>
                )}
              </Space>
              {isCompact && lastTriggeredRun && (
                <Space.Compact>
                  <Button type={popupView === "chat" ? "primary" : "default"} onClick={() => setPopupView("chat")}>
                    Chat
                  </Button>
                  <Button type={popupView === "run" ? "primary" : "default"} onClick={() => setPopupView("run")}>
                    Live Tail
                  </Button>
                </Space.Compact>
              )}
            </Space>
            {isCompact && lastTriggeredRun && (
              <Alert
                type="success"
                showIcon
                message={`AI started run #${lastTriggeredRun.id}`}
                description={`Tracking ${lastTriggeredRun.status} output live in this popup.`}
              />
            )}
          </Space>
        </Card>

        {showSharedEditor && !isCompact && (
          <Card
            size="small"
            title="Shared Editor"
            extra={
              <Space size={8}>
                <Text type="secondary">{sharedEditorContent.length.toLocaleString()} chars</Text>
                <Button size="small" onClick={clearSharedEditor}>
                  Clear
                </Button>
              </Space>
            }
          >
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Space.Compact style={{ width: "100%" }}>
                <Input
                  value={sharedEditorTitle}
                  onChange={(e) => setSharedEditorTitle(e.target.value)}
                  placeholder="filename or scratch title"
                  style={{ minWidth: 220 }}
                />
                <Input
                  value={sharedEditorLanguage}
                  onChange={(e) => setSharedEditorLanguage(e.target.value)}
                  placeholder="language"
                  style={{ width: 160 }}
                />
              </Space.Compact>
              <Text type="secondary">
                This buffer is included with each chat request so the assistant can review, discuss, and revise code or notes against shared text.
              </Text>
              <Input.TextArea
                value={sharedEditorContent}
                onChange={(e) => setSharedEditorContent(e.target.value)}
                spellCheck={false}
                autoSize={{ minRows: 12, maxRows: 28 }}
                style={{ fontFamily: "SFMono-Regular, Consolas, monospace" }}
                placeholder="Paste code, notes, or a draft here. Ask SLIM to explain it, review it, or rewrite it."
              />
            </Space>
          </Card>
        )}

        <Card
          size="small"
          styles={{
            body: {
              display: "flex",
              flexDirection: "column",
              gap: 12,
              height: isCompact ? (isMobile ? "min(70vh, 640px)" : 520) : embedded ? "calc(100vh - 420px)" : 420,
            },
          }}
        >
          {isCompact && popupView === "run" && lastTriggeredRun ? (
            <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: 12 }}>
              <div
                style={{
                  padding: 12,
                  borderRadius: token.borderRadiusLG,
                  background: token.colorFillQuaternary,
                  border: `1px solid ${token.colorBorderSecondary}`,
                }}
              >
                <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
                  <Space wrap>
                    <Text strong>{`Run #${lastTriggeredRun.id}`}</Text>
                    <Tag>{lastTriggeredRun.status}</Tag>
                    <Text type="secondary">{`Template ${lastTriggeredRun.job_template_id ?? "manual"}`}</Text>
                  </Space>
                  <Button size="small" onClick={() => setPopupView("chat")}>
                    Back to Chat
                  </Button>
                </Space>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <PlaybookRunOutput
                  runId={lastTriggeredRun.id}
                  initialOutput={lastTriggeredRun.output}
                  initialStatus={lastTriggeredRun.status}
                />
              </div>
            </div>
          ) : (
            <>
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
                {!activeConversationId && !streamedReply && (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Ask the manager about monitoring, incidents, or automation." />
                )}
                {currentMessages.map((messageItem) => (
                  <Card
                    key={messageItem.id}
                    size="small"
                    type="inner"
                    title={
                      messageItem.role === "user"
                        ? "You"
                        : messageItem.agent?.name
                          ? `SLIM · ${messageItem.agent.name}`
                          : "SLIM"
                    }
                    extra={
                      showSharedEditor ? (
                        <Button size="small" type="text" onClick={() => loadMessageIntoEditor(messageItem.content)}>
                          Load Into Editor
                        </Button>
                      ) : null
                    }
                  >
                    <MessageContent content={messageItem.content} markdown={messageItem.role !== "user"} />
                  </Card>
                ))}
                {streaming && (
                  <Card
                    size="small"
                    type="inner"
                    title={activeAgentName ? `SLIM · ${activeAgentName}` : "SLIM"}
                    extra={
                      showSharedEditor && streamedReply ? (
                        <Button size="small" type="text" onClick={() => loadMessageIntoEditor(streamedReply)}>
                          Load Into Editor
                        </Button>
                      ) : null
                    }
                  >
                    <Space direction="vertical" size={8} style={{ width: "100%" }}>
                      <Spin size="small" />
                      <MessageContent content={streamedReply || "Working…"} markdown />
                    </Space>
                  </Card>
                )}
                {streamError && <Alert type="error" showIcon message={streamError} />}
                {!isCompact && lastTriggeredRun && (
                  <Alert
                    type="success"
                    showIcon
                    message={`AI started run #${lastTriggeredRun.id}`}
                    description={`Status: ${lastTriggeredRun.status}`}
                  />
                )}
                <div ref={bottomRef} />
              </div>

              <Space.Compact style={{ width: "100%" }}>
                <Input.TextArea
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  disabled={!settingsQuery.data?.agentic_noc_enabled}
                  placeholder="Ask the manager to route monitoring, incident, or automation work."
                />
                <Button
                  type="primary"
                  icon={<RobotOutlined />}
                  loading={streaming}
                  disabled={!settingsQuery.data?.agentic_noc_enabled}
                  onClick={() => void handleSend()}
                >
                  Send
                </Button>
              </Space.Compact>
            </>
          )}
        </Card>
      </div>
    </div>
  );

  return (
    <>
      {showChat && !embedded && mode === "page" && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Space direction="vertical" size={2}>
            <Title level={4} style={{ margin: 0 }}>SLIM</Title>
            <Paragraph type="secondary" style={{ margin: 0 }}>
              Admin-only manager chat for monitoring, incident response, automation, and shared code discussion.
            </Paragraph>
          </Space>
          {showAdminTabs && (
            <Button
              size="small"
              icon={showSettings ? <UpOutlined /> : <SettingOutlined />}
              onClick={() => setShowSettings((v) => !v)}
            >
              {showSettings ? "Hide Settings" : "Settings"}
            </Button>
          )}
        </div>
      )}
      <div style={{ marginTop: embedded || mode === "popup" ? 0 : 16, display: "flex", flexDirection: "column", gap: 16 }}>
        {showChat && chatContent}

        {!isCompact && showAdminTabs && (showChat ? showSettings : true) && (
          <Tabs
            defaultActiveKey="agents"
            items={[
              {
                key: "agents",
                label: "Agents",
                children: (
                  <Card
                    size="small"
                    title="Agents"
                    extra={
                      <Button size="small" icon={<PlusOutlined />} onClick={openCreateAgent}>
                        Add Agent
                      </Button>
                    }
                  >
                    <Table<AiAgent>
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={agents}
                      locale={{ emptyText: "No AI agents configured." }}
                      columns={[
                        {
                          title: "Agent",
                          render: (_value, item) => (
                            <Space direction="vertical" size={0}>
                              <Text strong>{item.name}</Text>
                              <Text type="secondary">{item.agent_key}</Text>
                              <Text type="secondary">{item.description}</Text>
                            </Space>
                          ),
                        },
                        {
                          title: "Type",
                          dataIndex: "agent_type",
                          render: (value: AiAgent["agent_type"]) => <Tag>{agentTypeLabel(value)}</Tag>,
                        },
                        {
                          title: "Model",
                          render: (_value, item) => item.model || item.provider_name || "Default provider",
                        },
                        {
                          title: "Status",
                          render: (_value, item) => (
                            <Space>
                              {item.is_enabled ? <Tag color="green">Enabled</Tag> : <Tag>Disabled</Tag>}
                              {item.provider_name ? <Tag color="blue">{item.provider_name}</Tag> : <Tag>Default provider</Tag>}
                            </Space>
                          ),
                        },
                        {
                          title: "",
                          render: (_value, item) => (
                            <Space>
                              <Button size="small" icon={<EditOutlined />} onClick={() => openEditAgent(item)} />
                              {item.agent_type === "custom" ? (
                                <Popconfirm title="Delete this AI agent?" onConfirm={() => deleteAgentMutation.mutate(item.id)}>
                                  <Button size="small" danger icon={<DeleteOutlined />} />
                                </Popconfirm>
                              ) : null}
                            </Space>
                          ),
                        },
                      ]}
                    />
                  </Card>
                ),
              },
              {
                key: "tools",
                label: "Tools",
                children: (
                  <Card
                    size="small"
                    title="AI Tools"
                    extra={
                      <Button size="small" icon={<PlusOutlined />} onClick={openCreateTool}>
                        Add Tool
                      </Button>
                    }
                  >
                    <Table<AiTool>
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={tools}
                      locale={{ emptyText: "No AI tools configured." }}
                      columns={[
                        {
                          title: "Tool",
                          render: (_value, item) => (
                            <Space direction="vertical" size={0}>
                              <Text strong>{item.tool_name}</Text>
                              <Text type="secondary">{item.job_template_name}</Text>
                            </Space>
                          ),
                        },
                        {
                          title: "Agents",
                          render: (_value, item) =>
                            item.assigned_agents.length > 0
                              ? item.assigned_agents.map((agent) => <Tag key={agent.id}>{agent.name}</Tag>)
                              : <Text type="secondary">Unassigned</Text>,
                        },
                        {
                          title: "Status",
                          render: (_value, item) => (item.is_enabled ? <Tag color="green">Enabled</Tag> : <Tag color="orange">Disabled</Tag>),
                        },
                        {
                          title: "",
                          render: (_value, item) => (
                            <Space>
                              <Button size="small" icon={<EditOutlined />} onClick={() => openEditTool(item)} />
                              <Popconfirm title="Delete this AI tool?" onConfirm={() => deleteToolMutation.mutate(item.id)}>
                                <Button size="small" danger icon={<DeleteOutlined />} />
                              </Popconfirm>
                            </Space>
                          ),
                        },
                      ]}
                    />
                  </Card>
                ),
              },
              {
                key: "providers",
                label: "Providers",
                children: (
                  <Card
                    size="small"
                    title="AI Providers"
                    extra={
                      <Button size="small" icon={<PlusOutlined />} onClick={openCreateProvider}>
                        Add Provider
                      </Button>
                    }
                  >
                    <Table<AiProvider>
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={providerOptions}
                      locale={{ emptyText: "No providers configured." }}
                      columns={[
                        { title: "Name", dataIndex: "name" },
                        { title: "Type", dataIndex: "provider_type" },
                        { title: "Model", dataIndex: "default_model" },
                        { title: "Key", render: (_value, item) => (item.has_api_key ? "Configured" : "None") },
                        {
                          title: "Status",
                          render: (_value, item) => (
                            <Space>
                              {item.is_enabled ? <Tag color="green">Enabled</Tag> : <Tag>Disabled</Tag>}
                              {item.is_default ? <Tag color="blue">Default</Tag> : null}
                            </Space>
                          ),
                        },
                        {
                          title: "",
                          render: (_value, item) => (
                            <Space>
                              <Button size="small" icon={<SaveOutlined />} onClick={() => openEditProvider(item)} />
                              <Popconfirm title="Delete this provider?" onConfirm={() => deleteProviderMutation.mutate(item.id)}>
                                <Button size="small" danger icon={<DeleteOutlined />} />
                              </Popconfirm>
                            </Space>
                          ),
                        },
                      ]}
                    />
                  </Card>
                ),
              },
              {
                key: "settings",
                label: "Settings",
                children: (
                  <Card
                    size="small"
                    title="Feature Settings"
                    extra={
                      <Switch
                        checked={settingsQuery.data?.agentic_noc_enabled ?? false}
                        loading={updateSettingsMutation.isPending}
                        onChange={(checked) => updateSettingsMutation.mutate({ agentic_noc_enabled: checked })}
                      />
                    }
                  >
                    <Text type="secondary">
                      Toggle the manager and specialist agent runtime. Config remains editable while chat execution is disabled.
                    </Text>
                  </Card>
                ),
              },
            ]}
          />
        )}
      </div>

      <Modal
        title={editingProvider ? "Edit AI Provider" : "Add AI Provider"}
        open={providerModalOpen}
        onCancel={() => setProviderModalOpen(false)}
        onOk={() => providerForm.submit()}
        confirmLoading={createProviderMutation.isPending || updateProviderMutation.isPending}
        okText={editingProvider ? "Save Provider" : "Create Provider"}
        width={680}
        footer={(_, { OkBtn, CancelBtn }) => (
          <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
            <Button onClick={() => void handleTestProvider()} loading={testProviderMutation.isPending}>
              Test & Load Models
            </Button>
            <Space>
              <CancelBtn />
              <OkBtn />
            </Space>
          </div>
        )}
      >
        <Form form={providerForm} layout="vertical" onFinish={(values) => void handleProviderSubmit(values)}>
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Name is required" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="provider_type" label="Provider Type" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "ollama", label: "Ollama" },
                { value: "openai_compatible", label: "OpenAI-compatible" },
                { value: "openwebui", label: "OpenWebUI" },
                { value: "anthropic", label: "Anthropic (Claude)" },
              ]}
            />
          </Form.Item>
          {(providerTypeValue === "openai_compatible" || providerTypeValue === "ollama" || providerTypeValue === "openwebui") && (
            <Form.Item label="Quick Setup">
              <Select
                allowClear
                placeholder="Pick a preset to auto-fill URL..."
                value={selectedPreset}
                onChange={(val: string | undefined) => {
                  if (!val) { setSelectedPreset(null); return; }
                  const presets: ProviderPreset[] =
                    providerTypeValue === "ollama" ? OLLAMA_PRESETS :
                    providerTypeValue === "openwebui" ? OPENWEBUI_PRESETS :
                    OPENAI_COMPATIBLE_PRESETS;
                  handlePresetChange(val, presets);
                }}
                options={(
                  providerTypeValue === "ollama" ? OLLAMA_PRESETS :
                  providerTypeValue === "openwebui" ? OPENWEBUI_PRESETS :
                  OPENAI_COMPATIBLE_PRESETS
                ).map((p) => ({ value: p.label, label: p.label }))}
              />
            </Form.Item>
          )}
          <Form.Item name="base_url" label="Base URL" rules={[{ required: true, message: "Base URL is required" }]}>
            <Input placeholder="https://api.example.com/v1 (or pick a preset above)" />
          </Form.Item>
          <Form.Item
            name="api_key"
            label={editingProvider?.has_api_key ? "Replace API Key" : "API Key"}
            extra={
              (providerTypeValue === "openwebui" || providerTypeValue === "anthropic" || providerTypeValue === "openai_compatible") && !editingProvider ? (
                <Text type="secondary">Enter your API key, then click Test to load available models.</Text>
              ) : undefined
            }
          >
            <Input.Password placeholder={editingProvider?.has_api_key ? "Leave blank to keep current key" : undefined} />
          </Form.Item>
          <Form.Item
            name="default_model"
            label="Default Model"
            rules={[{ required: true, message: "Select a model from the list after clicking Test, or type one manually." }]}
            extra={
              <Space direction="vertical" size={2} style={{ width: "100%" }}>
                {providerModelSuggestions.length === 0 && !testProviderMutation.isPending && !providerModelError && (
                  <Text type="secondary">
                    {providerTypeValue === "ollama"
                      ? "Test the provider to prefill available models."
                      : "Enter your API key above and click Test to load available models."}
                  </Text>
                )}
                {providerModelSuggestions.length > 0 && (
                  <Text type="secondary">
                    {providerModelSuggestions.length} model{providerModelSuggestions.length === 1 ? "" : "s"} loaded — select one below.
                  </Text>
                )}
                {testProviderMutation.isPending && (
                  <Text type="secondary">Testing provider and loading models...</Text>
                )}
                {providerModelError && <Text type="danger">{providerModelError}</Text>}
              </Space>
            }
          >
            <AutoComplete
              allowClear
              options={providerModelSuggestions.map((model) => ({ value: model, label: model }))}
              filterOption={(inputValue, option) =>
                String(option?.value ?? "")
                  .toLowerCase()
                  .includes(inputValue.toLowerCase())
              }
            >
              <Input placeholder="Click Test above to load models, or type one manually" />
            </AutoComplete>
          </Form.Item>
          <Form.Item name="request_timeout_seconds" label="Request Timeout (seconds)" rules={[{ required: true }]}>
            <Input type="number" />
          </Form.Item>
          <Form.Item name="is_enabled" label="Enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="is_default" label="Default Provider" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingAgent ? `Edit ${editingAgent.name}` : "Add Agent"}
        open={agentModalOpen}
        onCancel={() => setAgentModalOpen(false)}
        onOk={() => agentForm.submit()}
        confirmLoading={createAgentMutation.isPending || updateAgentMutation.isPending}
        width={780}
      >
        <Form form={agentForm} layout="vertical" onFinish={(values) => void handleAgentSubmit(values)}>
          <Form.Item name="name" label="Agent Name" rules={[{ required: true, message: "Agent name is required" }]}>
            <Input placeholder="Storage Analyst" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="What this agent should handle." />
          </Form.Item>
          <Form.Item name="provider_id" label="Provider">
            <Select
              allowClear
              options={providerOptions.map((provider) => ({ value: provider.id, label: provider.name }))}
              placeholder="Use default enabled provider"
            />
          </Form.Item>
          <Form.Item
            name="model"
            label="Model Override"
            extra={
              <Space direction="vertical" size={2} style={{ width: "100%" }}>
                <Text type="secondary">
                  {effectiveAgentProvider
                    ? `Suggestions from ${effectiveAgentProvider.name}. Leave this blank to use ${agentProviderDefaultModel || "the provider default model"}.`
                    : "Select a provider to load its available models. Leave this blank to use the provider default model."}
                </Text>
                {agentProviderModelsQuery.isFetching && <Text type="secondary">Loading provider models...</Text>}
                {agentProviderModelsQuery.isError && (
                  <Text type="danger">
                    Failed to load models from this provider. You can still type a model name manually.
                  </Text>
                )}
              </Space>
            }
          >
            <AutoComplete
              allowClear
              options={agentModelOptions}
              filterOption={(inputValue, option) =>
                String(option?.value ?? "")
                  .toLowerCase()
                  .includes(inputValue.toLowerCase())
              }
            >
              <Input placeholder="Leave blank to use the provider default model" />
            </AutoComplete>
          </Form.Item>
          <Form.Item
            name="is_enabled"
            label="Enabled"
            valuePropName="checked"
            extra={editingAgent?.agent_type === "manager" ? "The manager should remain enabled." : undefined}
          >
            <Switch disabled={editingAgent?.agent_type === "manager"} />
          </Form.Item>
          <Form.Item
            name="system_prompt"
            label="System Prompt"
            rules={[{ required: true, message: "System prompt is required" }]}
          >
            <Input.TextArea autoSize={{ minRows: 8, maxRows: 16 }} />
          </Form.Item>
          <Card
            size="small"
            title="Use AI To Improve This Prompt"
            extra={
              <Button
                icon={<SettingOutlined />}
                loading={promptAssistStreaming}
                disabled={!editingAgent}
                onClick={() => void handlePromptAssist()}
              >
                Improve Prompt
              </Button>
            }
          >
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Text type="secondary">Prompt suggestions are generated with current SLIM lab context, inventory, monitoring, and automation data.</Text>
              {!editingAgent && (
                <Text type="secondary">Save the new agent first if you want prompt-assist suggestions for it.</Text>
              )}
              <Form.Item name="assist_request" label="Prompt Change Request">
                <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} placeholder={DEFAULT_PROMPT_ASSIST_REQUEST} />
              </Form.Item>
              {promptAssistStreaming && (
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  <Spin size="small" />
                  <div style={{ whiteSpace: "pre-wrap" }}>{promptAssistDraft || "Drafting prompt..."}</div>
                </Space>
              )}
              {!promptAssistStreaming && promptAssistDraft && <div style={{ whiteSpace: "pre-wrap" }}>{promptAssistDraft}</div>}
              {promptAssistError && <Alert type="error" showIcon message={promptAssistError} />}
              {promptAssistDraft && (
                <Button type="primary" onClick={() => agentForm.setFieldValue("system_prompt", promptAssistDraft.trim())}>
                  Use Suggestion
                </Button>
              )}
            </Space>
          </Card>
        </Form>
      </Modal>

      <Modal
        title={editingTool ? "Edit AI Tool" : "Add AI Tool"}
        open={toolModalOpen}
        onCancel={() => setToolModalOpen(false)}
        onOk={() => toolForm.submit()}
        confirmLoading={createToolMutation.isPending || updateToolMutation.isPending}
        width={860}
      >
        <Form form={toolForm} layout="vertical" onFinish={(values) => void handleToolSubmit(values)}>
          <Form.Item name="job_template_id" label="Job Template" rules={[{ required: true, message: "Job template is required" }]}>
            <Select
              disabled={!!editingTool}
              options={toolCandidates.map((candidate: AiToolCandidate) => ({
                value: candidate.job_template_id,
                label: `${candidate.job_template_name}${candidate.playbook_id ? "" : " (no playbook)"}`,
                disabled: !editingTool && !!candidate.ai_tool_id,
              }))}
            />
          </Form.Item>
          <Form.Item name="is_enabled" label="Enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="tool_name" label="Tool Name" rules={[{ required: true, message: "Tool name is required" }]}>
            <Input placeholder="restart-node-exporter" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
          </Form.Item>
          <Form.Item name="when_to_use" label="When To Use">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
          </Form.Item>
          <Form.Item name="input_hint" label="Input Hint">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
          </Form.Item>
          <Form.Item name="example_payload_raw" label="Example Payload JSON">
            <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} style={{ fontFamily: "monospace" }} />
          </Form.Item>
          <Form.Item name="safety_notes" label="Safety Notes">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
          </Form.Item>
          <Form.Item name="agent_ids" label="Assigned Agents">
            <Select
              mode="multiple"
              options={specialistAgents.map((agent) => ({ value: agent.id, label: agent.name }))}
            />
          </Form.Item>
          <Card
            size="small"
            title="Use AI To Prefill This Tool"
            extra={
              <Button loading={toolPrefillLoading} onClick={() => void handleToolPrefill()}>
                Prefill
              </Button>
            }
          >
            <Form.Item name="prefill_instructions" label="Extra Instructions">
              <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} placeholder="Optional guidance for how the tool should be presented to operators." />
            </Form.Item>
          </Card>
        </Form>
      </Modal>
    </>
  );
}
