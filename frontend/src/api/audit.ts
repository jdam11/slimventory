import api from "./client";
import type { AuditLogPage, AuditLogQuery } from "../types";

export function getAuditLog(query: AuditLogQuery = {}) {
  const params: Record<string, string | number> = {};
  if (query.entity) params.entity = query.entity;
  if (query.username) params.username = query.username;
  if (query.action) params.action = query.action;
  if (query.since) params.since = query.since;
  if (query.skip != null) params.skip = query.skip;
  if (query.limit != null) params.limit = query.limit;
  return api.get<AuditLogPage>("/audit", { params }).then((r) => r.data);
}
