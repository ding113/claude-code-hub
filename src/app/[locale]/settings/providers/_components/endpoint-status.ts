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

/**
 * Source of incident for unified status semantics.
 * - "provider": Incident originates from provider-level health check
 * - "endpoint": Incident originates from endpoint-level health check (circuit breaker)
 */
export type IncidentSource = "provider" | "endpoint";

/**
 * Resolved display status for endpoint with unified semantics.
 */
export interface EndpointDisplayStatus {
  status: string;
  source: IncidentSource;
  priority: number;
}

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

/**
 * Resolves the display status for an endpoint with unified semantics.
 *
 * Priority order:
 * 1. circuit-open (priority 0) - Circuit breaker has opened
 * 2. circuit-half-open (priority 1) - Circuit breaker is testing recovery
 * 3. enabled (priority 2) - Circuit closed and endpoint is enabled
 * 4. disabled (priority 3) - Circuit closed but endpoint is disabled
 *
 * @param endpoint - Endpoint data with optional isEnabled property
 * @param circuitState - Current circuit breaker state
 * @returns Display status with source indicator and priority
 */
export function resolveEndpointDisplayStatus(
  endpoint: { lastProbeOk: boolean | null; isEnabled?: boolean | null },
  circuitState?: EndpointCircuitState | null
): EndpointDisplayStatus {
  // Priority 0: Circuit Open
  if (circuitState === "open") {
    return {
      status: "circuit-open",
      source: "endpoint",
      priority: 0,
    };
  }

  // Priority 1: Circuit Half-Open
  if (circuitState === "half-open") {
    return {
      status: "circuit-half-open",
      source: "endpoint",
      priority: 1,
    };
  }

  // Priority 2/3: Circuit Closed - check enabled/disabled (no circuit incident)
  const isExplicitlyDisabled = endpoint.isEnabled === false;
  return {
    status: isExplicitlyDisabled ? "disabled" : "enabled",
    source: "provider",
    priority: isExplicitlyDisabled ? 3 : 2,
  };
}
