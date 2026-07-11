import api from "./client";
import type { IpamSummaryResponse, IpamVlanDetail } from "../types";

export function getIpamSummary() {
  return api.get<IpamSummaryResponse>("/ipam/").then((r) => r.data);
}

export function getIpamDetail(vlanPk: number) {
  return api.get<IpamVlanDetail>(`/ipam/${vlanPk}`).then((r) => r.data);
}
