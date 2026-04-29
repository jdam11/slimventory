import api from "./client";
import { clearGitKnownHostsForRepo } from "./admin";
import type {
  AnsiblePlaybook,
  AnsibleRolePreview,
  AppImportPreview,
  BulkAppImportItem,
  BulkAppImportPreview,
  GitCredential,
  GitCredentialCreate,
  GitRepo,
  GitRepoCreate,
  GitRepoSyncResult,
  PageResponse,
  PlaybookRun,
  PlaybookRunCreate,
  RoleImportItem,
  RoleImportResult,
} from "../types";


export function listGitRepos(skip = 0, limit = 100) {
  return api
    .get<PageResponse<GitRepo>>("/git-repos", { params: { skip, limit } })
    .then((r) => r.data);
}

export function listGitCredentials(skip = 0, limit = 100) {
  return api
    .get<PageResponse<GitCredential>>("/git-credentials", { params: { skip, limit } })
    .then((r) => r.data);
}

export function createGitCredential(payload: GitCredentialCreate) {
  return api.post<GitCredential>("/git-credentials", payload).then((r) => r.data);
}

export function updateGitCredential(id: number, payload: Partial<GitCredentialCreate>) {
  return api.patch<GitCredential>(`/git-credentials/${id}`, payload).then((r) => r.data);
}

export function deleteGitCredential(id: number) {
  return api.delete(`/git-credentials/${id}`);
}

export function getGitRepo(id: number) {
  return api.get<GitRepo>(`/git-repos/${id}`).then((r) => r.data);
}

export function createGitRepo(payload: GitRepoCreate) {
  return api.post<GitRepo>("/git-repos", payload).then((r) => r.data);
}

export function updateGitRepo(id: number, payload: Partial<GitRepoCreate>) {
  return api.patch<GitRepo>(`/git-repos/${id}`, payload).then((r) => r.data);
}

export function deleteGitRepo(id: number) {
  return api.delete(`/git-repos/${id}`);
}

export function syncGitRepo(id: number) {
  return api.post<GitRepoSyncResult>(`/git-repos/${id}/sync`).then((r) => r.data);
}

export { clearGitKnownHostsForRepo };

export function previewImportApp(id: number) {
  return api.post<AppImportPreview>(`/git-repos/${id}/preview-import`).then((r) => r.data);
}

export function bulkPreviewImport(id: number) {
  return api.post<BulkAppImportPreview[]>(`/git-repos/${id}/bulk-preview-import`).then((r) => r.data);
}

export function bulkImport(id: number, payload: BulkAppImportItem[]) {
  return api.post<{ created_apps: number }>(`/git-repos/${id}/bulk-import`, payload).then((r) => r.data);
}

export function previewRoles(id: number) {
  return api.post<AnsibleRolePreview[]>(`/git-repos/${id}/preview-roles`).then((r) => r.data);
}

export function importRoles(id: number, items: RoleImportItem[]) {
  return api.post<RoleImportResult>(`/git-repos/${id}/import-roles`, { items }).then((r) => r.data);
}


export function listPlaybooks(repoId?: number, skip = 0, limit = 200) {
  return api
    .get<PageResponse<AnsiblePlaybook>>("/ansible-playbooks", {
      params: { repo_id: repoId, skip, limit },
    })
    .then((r) => r.data);
}


export function listPlaybookRuns(params?: {
  playbook_id?: number;
  status?: string;
  skip?: number;
  limit?: number;
}) {
  return api
    .get<PageResponse<PlaybookRun>>("/playbook-runs", { params })
    .then((r) => r.data);
}

export function getPlaybookRun(id: number) {
  return api.get<PlaybookRun>(`/playbook-runs/${id}`).then((r) => r.data);
}

export function createPlaybookRun(payload: PlaybookRunCreate) {
  return api.post<PlaybookRun>("/playbook-runs", payload).then((r) => r.data);
}

export function cancelPlaybookRun(id: number) {
  return api.delete(`/playbook-runs/${id}`);
}
