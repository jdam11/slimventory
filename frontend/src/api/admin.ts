import apiClient from "./client";
import type {
  AnsibleRunnerSettings,
  AnsibleRunnerSettingsUpdate,
  ClearedKnownHostsResult,
  InventoryApiKey,
  InventoryApiKeyCreate,
  InventoryApiKeySecret,
  InventoryApiKeyUpdate,
  LogLevelResponse,
  SshKnownHostsSummary,
} from "../types";

export async function getLogLevel(): Promise<LogLevelResponse> {
  const res = await apiClient.get<LogLevelResponse>("/admin/log-level");
  return res.data;
}

export async function setLogLevel(level: string): Promise<LogLevelResponse> {
  const res = await apiClient.patch<LogLevelResponse>("/admin/log-level", {
    log_level: level,
  });
  return res.data;
}

export async function listInventoryApiKeys(): Promise<InventoryApiKey[]> {
  const res = await apiClient.get<InventoryApiKey[]>("/admin/inventory-api-keys");
  return res.data;
}

export async function createInventoryApiKey(payload: InventoryApiKeyCreate): Promise<InventoryApiKeySecret> {
  const res = await apiClient.post<InventoryApiKeySecret>("/admin/inventory-api-keys", payload);
  return res.data;
}

export async function updateInventoryApiKey(id: number, payload: InventoryApiKeyUpdate): Promise<InventoryApiKey> {
  const res = await apiClient.patch<InventoryApiKey>(`/admin/inventory-api-keys/${id}`, payload);
  return res.data;
}

export async function rotateInventoryApiKey(id: number): Promise<InventoryApiKeySecret> {
  const res = await apiClient.post<InventoryApiKeySecret>(`/admin/inventory-api-keys/${id}/rotate`);
  return res.data;
}

export async function deleteInventoryApiKey(id: number): Promise<void> {
  await apiClient.delete(`/admin/inventory-api-keys/${id}`);
}

export async function getAnsibleRunnerSettings(): Promise<AnsibleRunnerSettings> {
  const res = await apiClient.get<AnsibleRunnerSettings>("/admin/ansible-runner-settings");
  return res.data;
}

export async function updateAnsibleRunnerSettings(
  payload: AnsibleRunnerSettingsUpdate
): Promise<AnsibleRunnerSettings> {
  const res = await apiClient.patch<AnsibleRunnerSettings>("/admin/ansible-runner-settings", payload);
  return res.data;
}

export async function getSshKnownHostsSummary(): Promise<SshKnownHostsSummary> {
  const res = await apiClient.get<SshKnownHostsSummary>("/admin/ssh-known-hosts");
  return res.data;
}

export async function clearAnsibleKnownHostsForHost(hostId: number): Promise<ClearedKnownHostsResult> {
  const res = await apiClient.post<ClearedKnownHostsResult>(`/admin/ssh-known-hosts/ansible/hosts/${hostId}/clear`);
  return res.data;
}

export async function clearGitKnownHostsForRepo(repoId: number): Promise<ClearedKnownHostsResult> {
  const res = await apiClient.post<ClearedKnownHostsResult>(`/admin/ssh-known-hosts/git-repos/${repoId}/clear`);
  return res.data;
}
