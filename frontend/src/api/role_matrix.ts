import api from "./client";
import type {
  RoleMatrixResponse,
  RoleMatrixToggleRequest,
  RoleMatrixToggleResponse,
} from "../types";

export function getRoleMatrix() {
  return api.get<RoleMatrixResponse>("/role-matrix/").then((r) => r.data);
}

export function toggleRoleAssignment(payload: RoleMatrixToggleRequest) {
  return api
    .post<RoleMatrixToggleResponse>("/role-matrix/toggle", payload)
    .then((r) => r.data);
}
