import api from "./client";
import type {
  PageResponse,
  ProxmoxCredential,
  ProxmoxNodeStorage,
  ProxmoxPendingHost,
  ProxmoxSyncRun,
  ProxmoxSyncSchedule,
} from "../types";

export interface ProxmoxCredentialInput {
  name: string;
  base_url: string;
  auth_type: "token" | "password";
  token_id?: string;
  token_secret?: string;
  username?: string;
  password?: string;
  verify_tls: boolean;
  is_active: boolean;
}

export interface ProxmoxScheduleInput {
  enabled: boolean;
  cron_expression: string;
  timezone: string;
}

export interface TriggerSyncInput {
  trigger_source: "manual" | "api";
}

export function listProxmoxCredentials(skip = 0, limit = 100) {
  return api
    .get<PageResponse<ProxmoxCredential>>("/proxmox/credentials", { params: { skip, limit } })
    .then((r) => r.data);
}

export function createProxmoxCredential(payload: ProxmoxCredentialInput) {
  return api.post<ProxmoxCredential>("/proxmox/credentials", payload).then((r) => r.data);
}

export function updateProxmoxCredential(id: number, payload: Partial<ProxmoxCredentialInput>) {
  return api.patch<ProxmoxCredential>(`/proxmox/credentials/${id}`, payload).then((r) => r.data);
}

export function deleteProxmoxCredential(id: number) {
  return api.delete(`/proxmox/credentials/${id}`);
}

export function getProxmoxSchedule() {
  return api.get<ProxmoxSyncSchedule>("/proxmox/schedule").then((r) => r.data);
}

export function updateProxmoxSchedule(payload: ProxmoxScheduleInput) {
  return api.patch<ProxmoxSyncSchedule>("/proxmox/schedule", payload).then((r) => r.data);
}

export function triggerProxmoxSync(payload: TriggerSyncInput = { trigger_source: "manual" }) {
  return api.post<ProxmoxSyncRun>("/proxmox/sync", payload).then((r) => r.data);
}

export function listProxmoxSyncRuns(skip = 0, limit = 50) {
  return api
    .get<PageResponse<ProxmoxSyncRun>>("/proxmox/runs", { params: { skip, limit } })
    .then((r) => r.data);
}

export interface ProxmoxPendingHostUpdate {
  environment_id?: number | null;
  host_type_id?: number | null;
  vlan_id?: number | null;
  role_id?: number | null;
  ipv4?: string | null;
  mac?: string | null;
  notes?: string | null;
  host_id_override?: number | null;
}

export interface ProxmoxPendingBulkActionResult {
  requested: number;
  succeeded: number;
  succeeded_ids: number[];
  errors: Array<{ id: number; detail: string }>;
}

export function listProxmoxPendingHosts(skip = 0, limit = 100) {
  return api
    .get<PageResponse<ProxmoxPendingHost>>("/proxmox/pending", { params: { skip, limit } })
    .then((r) => r.data);
}

export function updateProxmoxPendingHost(id: number, payload: ProxmoxPendingHostUpdate) {
  return api.patch<ProxmoxPendingHost>(`/proxmox/pending/${id}`, payload).then((r) => r.data);
}

export function promoteProxmoxPendingHost(id: number) {
  return api.post<ProxmoxPendingHost>(`/proxmox/pending/${id}/promote`).then((r) => r.data);
}

export function dismissProxmoxPendingHost(id: number) {
  return api.delete(`/proxmox/pending/${id}`);
}

export function bulkPromoteProxmoxPendingHosts(ids: number[]) {
  return api
    .post<ProxmoxPendingBulkActionResult>("/proxmox/pending/bulk-promote", { ids })
    .then((r) => r.data);
}

export function bulkDismissProxmoxPendingHosts(ids: number[]) {
  return api
    .post<ProxmoxPendingBulkActionResult>("/proxmox/pending/bulk-dismiss", { ids })
    .then((r) => r.data);
}

export interface ProxmoxCredentialImportItem {
  name: string;
  base_url: string;
  verify_tls?: boolean;
  auth_type?: "token" | "password";
  token_id?: string;
  token_secret?: string;
  username?: string;
  password?: string;
  is_active?: boolean;
}

export interface ProxmoxCredentialImportResult {
  requested: number;
  created: number;
  skipped: number;
  errors: Array<{ id: number; detail: string }>;
}

export function importProxmoxCredentials(items: ProxmoxCredentialImportItem[]) {
  return api
    .post<ProxmoxCredentialImportResult>("/proxmox/credentials/import", { items })
    .then((r) => r.data);
}

export function listProxmoxNodeStorage(skip = 0, limit = 500) {
  return api
    .get<PageResponse<ProxmoxNodeStorage>>("/proxmox/node-storage", { params: { skip, limit } })
    .then((r) => r.data);
}
