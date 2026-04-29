import api from "./client";
import type { PageResponse, UnifiSettings, UnifiSite, UnifiSyncRun, UnifiVlanPreview } from "../types";

export interface UnifiSettingsInput {
  enabled?: boolean;
  base_url?: string | null;
  username?: string | null;
  password?: string | null;
  site?: string | null;
  verify_tls?: boolean;
}

export interface TriggerUnifiSyncInput {
  trigger_source: "manual" | "api";
}

export interface UnifiVlanImportResult {
  requested: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<Record<string, string>>;
}

export function getUnifiSettings() {
  return api.get<UnifiSettings>("/unifi/settings").then((r) => r.data);
}

export function updateUnifiSettings(payload: UnifiSettingsInput) {
  return api.patch<UnifiSettings>("/unifi/settings", payload).then((r) => r.data);
}

export function listUnifiSites() {
  return api.get<UnifiSite[]>("/unifi/sites").then((r) => r.data);
}

export function triggerUnifiSync(payload: TriggerUnifiSyncInput = { trigger_source: "manual" }) {
  return api.post<UnifiSyncRun>("/unifi/sync", payload).then((r) => r.data);
}

export function listUnifiRuns(skip = 0, limit = 50) {
  return api.get<PageResponse<UnifiSyncRun>>("/unifi/runs", { params: { skip, limit } }).then((r) => r.data);
}

export function previewUnifiVlans() {
  return api.get<UnifiVlanPreview[]>("/unifi/vlans/preview").then((r) => r.data);
}

export function importUnifiVlans(network_ids: string[]) {
  return api.post<UnifiVlanImportResult>("/unifi/vlans/import", { network_ids }).then((r) => r.data);
}
