import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  HelpCircle,
  type LucideIcon,
  XCircle,
} from "lucide-react";
import type { ProviderEndpoint } from "@/types/provider";

export type EndpointCircuitState = "closed" | "open" | "half-open";

export type EndpointStatusSeverity = "success" | "error" | "warning" | "neutral";

export type EndpointStatusToken =
  | "healthy"
  | "unhealthy"
  | "unknown"
  | "circuit-open"
  | "circuit-half-open";

export interface EndpointStatusModel {
  status: EndpointStatusToken;
  labelKey: string;
  severity: EndpointStatusSeverity;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  borderColor: string;
}

/**
 * Determines the UI status model for an endpoint based on its probe snapshot and circuit state.
 *
 * Logic:
 * 1. Circuit Open -> 'circuit-open' (Error)
 * 2. Circuit Half-Open -> 'circuit-half-open' (Warning)
 * 3. Circuit Closed (or missing):
 *    - lastProbeOk === true -> 'healthy' (Success)
 *    - lastProbeOk === false -> 'unhealthy' (Error)
 *    - lastProbeOk === null -> 'unknown' (Neutral)
 */
export function getEndpointStatusModel(
  endpoint: Pick<ProviderEndpoint, "lastProbeOk">,
  circuitState?: EndpointCircuitState | null
): EndpointStatusModel {
  // 1. Circuit Breaker Priority
  if (circuitState === "open") {
    return {
      status: "circuit-open",
      labelKey: "settings.providers.endpointStatus.circuitOpen",
      severity: "error",
      icon: Ban,
      color: "text-rose-500",
      bgColor: "bg-rose-500/10",
      borderColor: "border-rose-500/30",
    };
  }

  if (circuitState === "half-open") {
    return {
      status: "circuit-half-open",
      labelKey: "settings.providers.endpointStatus.circuitHalfOpen",
      severity: "warning",
      icon: AlertTriangle,
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
      borderColor: "border-amber-500/30",
    };
  }

  // 2. Probe Status Fallback (Circuit Closed)
  if (endpoint.lastProbeOk === true) {
    return {
      status: "healthy",
      labelKey: "settings.providers.endpointStatus.healthy",
      severity: "success",
      icon: CheckCircle2,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
      borderColor: "border-emerald-500/30",
    };
  }

  if (endpoint.lastProbeOk === false) {
    return {
      status: "unhealthy",
      labelKey: "settings.providers.endpointStatus.unhealthy",
      severity: "error",
      icon: XCircle,
      color: "text-rose-500",
      bgColor: "bg-rose-500/10",
      borderColor: "border-rose-500/30",
    };
  }

  // 3. Unknown
  return {
    status: "unknown",
    labelKey: "settings.providers.endpointStatus.unknown",
    severity: "neutral",
    icon: HelpCircle,
    color: "text-slate-400",
    bgColor: "bg-slate-400/10",
    borderColor: "border-slate-400/30",
  };
}
