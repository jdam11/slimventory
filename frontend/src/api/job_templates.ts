import api from "./client";
import type {
  JobTemplate,
  JobTemplateCreate,
  JobTemplatePreview,
  JobTemplateSchedule,
  JobTemplateScheduleCreate,
  PageResponse,
  PlaybookRun,
  VaultCredential,
  VaultCredentialCreate,
} from "../types";

export function listVaultCredentials(skip = 0, limit = 100) {
  return api
    .get<PageResponse<VaultCredential>>("/vault-credentials", { params: { skip, limit } })
    .then((r) => r.data);
}

export function createVaultCredential(payload: VaultCredentialCreate) {
  return api.post<VaultCredential>("/vault-credentials", payload).then((r) => r.data);
}

export function updateVaultCredential(id: number, payload: Partial<VaultCredentialCreate>) {
  return api.patch<VaultCredential>(`/vault-credentials/${id}`, payload).then((r) => r.data);
}

export function deleteVaultCredential(id: number) {
  return api.delete(`/vault-credentials/${id}`);
}

export function listJobTemplates(skip = 0, limit = 100) {
  return api
    .get<PageResponse<JobTemplate>>("/job-templates", { params: { skip, limit } })
    .then((r) => r.data);
}

export function createJobTemplate(payload: JobTemplateCreate) {
  return api.post<JobTemplate>("/job-templates", payload).then((r) => r.data);
}

export function updateJobTemplate(id: number, payload: Partial<JobTemplateCreate>) {
  return api.patch<JobTemplate>(`/job-templates/${id}`, payload).then((r) => r.data);
}

export function deleteJobTemplate(id: number) {
  return api.delete(`/job-templates/${id}`);
}

export function launchJobTemplate(id: number) {
  return api.post<PlaybookRun>(`/job-templates/${id}/run`).then((r) => r.data);
}

export function getJobTemplateRuns(id: number, limit = 20) {
  return api
    .get<PageResponse<PlaybookRun>>(`/job-templates/${id}/runs`, { params: { limit } })
    .then((r) => r.data);
}

export function getJobTemplateSchedule(id: number) {
  return api.get<JobTemplateSchedule | null>(`/job-templates/${id}/schedule`).then((r) => r.data);
}

export function upsertJobTemplateSchedule(id: number, payload: JobTemplateScheduleCreate) {
  return api.put<JobTemplateSchedule>(`/job-templates/${id}/schedule`, payload).then((r) => r.data);
}

export function deleteJobTemplateSchedule(id: number) {
  return api.delete(`/job-templates/${id}/schedule`);
}

export function getJobTemplatePreview(id: number, refresh = false) {
  return api
    .get<JobTemplatePreview>(`/job-templates/${id}/preview`, { params: { refresh } })
    .then((r) => r.data);
}

export function refreshJobTemplatePreview(id: number) {
  return api.post<JobTemplatePreview>(`/job-templates/${id}/preview/refresh`).then((r) => r.data);
}
