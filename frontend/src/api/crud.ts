import api from "./client";
import type { PageResponse } from "../types";

export function listRecords<T>(endpoint: string, skip = 0, limit = 100) {
  return api
    .get<PageResponse<T>>(endpoint, { params: { skip, limit } })
    .then((r) => r.data);
}

export function getRecord<T>(endpoint: string, id: number | string) {
  return api.get<T>(`${endpoint}/${id}`).then((r) => r.data);
}

export function createRecord<T>(endpoint: string, data: unknown) {
  return api.post<T>(endpoint, data).then((r) => r.data);
}

export function updateRecord<T>(endpoint: string, id: number | string, data: unknown) {
  return api.patch<T>(`${endpoint}/${id}`, data).then((r) => r.data);
}

export function deleteRecord(endpoint: string, id: number | string) {
  return api.delete(`${endpoint}/${id}`);
}
