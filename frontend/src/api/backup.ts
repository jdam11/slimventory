import api from "./client";

export interface BackupConfig {
  id: number;
  schedule_enabled: boolean;
  cron_expression: string;
  timezone: string;
  retention_count: number;
  updated_at: string;
}

export interface BackupConfigInput {
  schedule_enabled: boolean;
  cron_expression: string;
  timezone: string;
  retention_count: number;
}

export interface BackupHistory {
  id: number;
  filename: string;
  size_bytes: number;
  status: "running" | "completed" | "failed";
  trigger_source: "manual" | "scheduled";
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  created_by: string | null;
}

export interface BackupHistoryPage {
  items: BackupHistory[];
  total: number;
}

export function getBackupConfig() {
  return api.get<BackupConfig>("/backups/config").then((r) => r.data);
}

export function updateBackupConfig(payload: BackupConfigInput) {
  return api.patch<BackupConfig>("/backups/config", payload).then((r) => r.data);
}

export function triggerBackup() {
  return api.post<BackupHistory>("/backups/trigger").then((r) => r.data);
}

export function listBackupHistory(skip = 0, limit = 50) {
  return api
    .get<BackupHistoryPage>("/backups/history", { params: { skip, limit } })
    .then((r) => r.data);
}

export function downloadBackup(id: number, filename: string) {
  return api
    .get(`/backups/${id}/download`, { responseType: "blob" })
    .then((r) => {
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    });
}

export function restoreBackup(backupId: number) {
  return api
    .post<{ detail: string }>("/backups/restore", { backup_id: backupId, confirm: true })
    .then((r) => r.data);
}

export function deleteBackup(id: number) {
  return api.delete<{ detail: string }>(`/backups/${id}`).then((r) => r.data);
}
