import api from "./client";
import type { HealthReport } from "../types";

export function getInventoryHealth() {
  return api.get<HealthReport>("/inventory-health/").then((r) => r.data);
}
