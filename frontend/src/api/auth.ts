import api from "./client";
import type { User } from "../types";

export interface LoginPayload {
  username: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  role: string;
  username: string;
}

export const authApi = {
  login: (data: LoginPayload) =>
    api.post<TokenResponse>("/auth/login", data).then((r) => r.data),

  logout: () => api.post("/auth/logout"),

  me: () => api.get<User>("/auth/me").then((r) => r.data),
};
