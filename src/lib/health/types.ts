export type ComponentStatus = "up" | "down" | "degraded" | "unchecked";

export interface ComponentHealth {
  status: ComponentStatus;
  latencyMs?: number;
  message?: string;
}

export interface HealthCheckResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  version: string;
  uptime: number;
  components?: {
    database?: ComponentHealth;
    redis?: ComponentHealth;
    proxy?: ComponentHealth;
  };
}
