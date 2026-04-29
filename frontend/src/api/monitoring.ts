import api from "./client";
import type {
  MonitoringAlertsResponse,
  MonitoringHistory,
  MonitoringLogsResponse,
  MonitoringOverview,
  MonitoringSecretMapping,
  MonitoringSecretMappingCreate,
  MonitoringSecretMappingUpdate,
  MonitoringSettings,
  MonitoringSettingsUpdate,
  PageResponse,
} from "../types";

export function getMonitoringOverview(hostId?: number) {
  return api
    .get<MonitoringOverview>("/monitoring/overview", {
      params: { host_id: hostId || undefined },
    })
    .then((r) => r.data);
}

export function getMonitoringLogs(serviceName?: string, limit = 50, hostId?: number) {
  return api
    .get<MonitoringLogsResponse>("/monitoring/logs", {
      params: { service_name: serviceName || undefined, limit, host_id: hostId || undefined },
    })
    .then((r) => r.data);
}

export function getMonitoringAlerts(hostId?: number) {
  return api
    .get<MonitoringAlertsResponse>("/monitoring/alerts", {
      params: { host_id: hostId || undefined },
    })
    .then((r) => r.data);
}

export function getMonitoringHistory(hours = 24, hostId?: number) {
  return api
    .get<MonitoringHistory>("/monitoring/history", {
      params: { hours, host_id: hostId || undefined },
    })
    .then((r) => r.data);
}

export function getMonitoringSettings() {
  return api.get<MonitoringSettings>("/monitoring/settings").then((r) => r.data);
}

export function updateMonitoringSettings(payload: MonitoringSettingsUpdate) {
  return api.patch<MonitoringSettings>("/monitoring/settings", payload).then((r) => r.data);
}

export function listMonitoringSecretMappings(jobTemplateId?: number | null) {
  return api
    .get<MonitoringSecretMapping[]>("/monitoring/secret-mappings", {
      params: { job_template_id: jobTemplateId || undefined },
    })
    .then((r) => r.data);
}

export function createMonitoringSecretMapping(payload: MonitoringSecretMappingCreate) {
  return api.post<MonitoringSecretMapping>("/monitoring/secret-mappings", payload).then((r) => r.data);
}

export function updateMonitoringSecretMapping(id: number, payload: MonitoringSecretMappingUpdate) {
  return api.patch<MonitoringSecretMapping>(`/monitoring/secret-mappings/${id}`, payload).then((r) => r.data);
}

export function deleteMonitoringSecretMapping(id: number) {
  return api.delete(`/monitoring/secret-mappings/${id}`);
}
