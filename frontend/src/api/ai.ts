import api from "./client";
import type {
  AiAgent,
  AiAgentPromptAssistRequest,
  AiChatRequest,
  AiConversation,
  AiConversationDetail,
  AiProvider,
  AiProviderModels,
  AiProviderType,
  AiSettings,
  AiTool,
  AiToolCandidate,
  AiToolPrefill,
  PageResponse,
} from "../types";

export function listAiProviders() {
  return api.get<AiProvider[]>("/ai/providers").then((r) => r.data);
}

export function listAdminAiProviders() {
  return api.get<AiProvider[]>("/ai/admin/providers").then((r) => r.data);
}

export function listAiProviderModels(providerId: number) {
  return api.get<AiProviderModels>(`/ai/admin/providers/${providerId}/models`).then((r) => r.data);
}

export function testAiProvider(payload: {
  provider_type: AiProviderType;
  base_url: string;
  default_model?: string | null;
  api_key?: string | null;
  request_timeout_seconds: number;
}) {
  return api.post<AiProviderModels>("/ai/admin/providers/test", payload).then((r) => r.data);
}

export function createAiProvider(payload: {
  name: string;
  provider_type: AiProviderType;
  base_url: string;
  default_model: string;
  api_key?: string | null;
  is_enabled: boolean;
  is_default: boolean;
  request_timeout_seconds: number;
}) {
  return api.post<AiProvider>("/ai/admin/providers", payload).then((r) => r.data);
}

export function updateAiProvider(
  id: number,
  payload: Partial<{
    name: string;
    provider_type: AiProviderType;
    base_url: string;
    default_model: string;
    api_key: string | null;
    is_enabled: boolean;
    is_default: boolean;
    request_timeout_seconds: number;
  }>
) {
  return api.patch<AiProvider>(`/ai/admin/providers/${id}`, payload).then((r) => r.data);
}

export function deleteAiProvider(id: number) {
  return api.delete(`/ai/admin/providers/${id}`);
}

export function getAiSettings() {
  return api.get<AiSettings>("/ai/admin/settings").then((r) => r.data);
}

export function updateAiSettings(payload: { agentic_noc_enabled: boolean }) {
  return api.patch<AiSettings>("/ai/admin/settings", payload).then((r) => r.data);
}

export function listAiAgents() {
  return api.get<AiAgent[]>("/ai/admin/agents").then((r) => r.data);
}

export function createAiAgent(payload: {
  name: string;
  description?: string | null;
  provider_id?: number | null;
  model?: string | null;
  system_prompt: string;
  is_enabled: boolean;
}) {
  return api.post<AiAgent>("/ai/admin/agents", payload).then((r) => r.data);
}

export function updateAiAgent(
  id: number,
  payload: Partial<{
    name: string;
    description: string | null;
    provider_id: number | null;
    model: string | null;
    system_prompt: string;
    is_enabled: boolean;
  }>
) {
  return api.patch<AiAgent>(`/ai/admin/agents/${id}`, payload).then((r) => r.data);
}

export function deleteAiAgent(id: number) {
  return api.delete(`/ai/admin/agents/${id}`);
}

export function listAiToolCandidates() {
  return api.get<AiToolCandidate[]>("/ai/admin/tool-candidates").then((r) => r.data);
}

export function listAiTools() {
  return api.get<AiTool[]>("/ai/admin/tools").then((r) => r.data);
}

export function createAiTool(payload: {
  job_template_id: number;
  is_enabled: boolean;
  tool_name: string;
  description?: string | null;
  when_to_use?: string | null;
  input_hint?: string | null;
  example_payload?: unknown;
  safety_notes?: string | null;
  agent_ids: number[];
}) {
  return api.post<AiTool>("/ai/admin/tools", payload).then((r) => r.data);
}

export function updateAiTool(
  id: number,
  payload: Partial<{
    is_enabled: boolean;
    tool_name: string | null;
    description: string | null;
    when_to_use: string | null;
    input_hint: string | null;
    example_payload: unknown;
    safety_notes: string | null;
    agent_ids: number[];
  }>
) {
  return api.patch<AiTool>(`/ai/admin/tools/${id}`, payload).then((r) => r.data);
}

export function deleteAiTool(id: number) {
  return api.delete(`/ai/admin/tools/${id}`);
}

export function prefillAiTool(payload: {
  job_template_id: number;
  agent_id?: number | null;
  instructions?: string | null;
  current_tool_name?: string | null;
  current_description?: string | null;
  current_when_to_use?: string | null;
  current_input_hint?: string | null;
  current_safety_notes?: string | null;
}) {
  return api.post<AiToolPrefill>("/ai/admin/tools/prefill", payload).then((r) => r.data);
}

export function listAiConversations(skip = 0, limit = 100) {
  return api.get<PageResponse<AiConversation>>("/ai/conversations", { params: { skip, limit } }).then((r) => r.data);
}

export function getAiConversation(id: number) {
  return api.get<AiConversationDetail>(`/ai/conversations/${id}`).then((r) => r.data);
}

export function createAiConversation() {
  return api.post<AiConversation>("/ai/conversations").then((r) => r.data);
}

export function deleteAiConversation(id: number) {
  return api.delete(`/ai/conversations/${id}`);
}

export async function streamAssistantChat(
  payload: AiChatRequest,
  handlers: {
    onEvent: (event: Record<string, unknown>) => void;
    onError?: (message: string) => void;
  }
) {
  const response = await fetch("/api/ai/chat/stream", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(detail || "Failed to start assistant stream");
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const rawEvent of events) {
      const line = rawEvent.split("\n").find((candidate) => candidate.startsWith("data: "));
      if (!line) {
        continue;
      }
      try {
        const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
        handlers.onEvent(event);
      } catch {
        handlers.onError?.("Failed to parse assistant stream");
      }
    }
  }
}

export async function streamAiPromptAssist(
  payload: AiAgentPromptAssistRequest,
  handlers: {
    onEvent: (event: Record<string, unknown>) => void;
    onError?: (message: string) => void;
  }
) {
  const response = await fetch("/api/ai/admin/prompt-assist/stream", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(detail || "Failed to start prompt assist stream");
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const rawEvent of events) {
      const line = rawEvent.split("\n").find((candidate) => candidate.startsWith("data: "));
      if (!line) {
        continue;
      }
      try {
        const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
        handlers.onEvent(event);
      } catch {
        handlers.onError?.("Failed to parse prompt assist stream");
      }
    }
  }
}
