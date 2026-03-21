import { normalizeEndpointPath, V1_ENDPOINT_PATHS } from "./endpoint-paths";

export type EndpointGuardPreset = "chat" | "raw_passthrough";

export type EndpointPoolStrictness = "inherit" | "strict";

export interface EndpointPolicy {
  readonly kind: "default" | "raw_passthrough" | "guarded_passthrough";
  readonly guardPreset: EndpointGuardPreset;
  readonly allowRetry: boolean;
  readonly allowProviderSwitch: boolean;
  readonly allowCircuitBreakerAccounting: boolean;
  readonly trackConcurrentRequests: boolean;
  readonly bypassRequestFilters: boolean;
  readonly bypassForwarderPreprocessing: boolean;
  readonly bypassSpecialSettings: boolean;
  readonly bypassResponseRectifier: boolean;
  readonly endpointPoolStrictness: EndpointPoolStrictness;
}

const DEFAULT_ENDPOINT_POLICY: EndpointPolicy = Object.freeze({
  kind: "default",
  guardPreset: "chat",
  allowRetry: true,
  allowProviderSwitch: true,
  allowCircuitBreakerAccounting: true,
  trackConcurrentRequests: true,
  bypassRequestFilters: false,
  bypassForwarderPreprocessing: false,
  bypassSpecialSettings: false,
  bypassResponseRectifier: false,
  endpointPoolStrictness: "inherit",
});

const RAW_PASSTHROUGH_ENDPOINT_POLICY: EndpointPolicy = Object.freeze({
  kind: "raw_passthrough",
  guardPreset: "raw_passthrough",
  allowRetry: false,
  allowProviderSwitch: false,
  allowCircuitBreakerAccounting: false,
  trackConcurrentRequests: false,
  bypassRequestFilters: true,
  bypassForwarderPreprocessing: true,
  bypassSpecialSettings: true,
  bypassResponseRectifier: true,
  endpointPoolStrictness: "strict",
});

const GUARDED_PASSTHROUGH_ENDPOINT_POLICY: EndpointPolicy = Object.freeze({
  kind: "guarded_passthrough",
  guardPreset: "chat",
  allowRetry: false,
  allowProviderSwitch: false,
  allowCircuitBreakerAccounting: true,
  trackConcurrentRequests: true,
  bypassRequestFilters: false,
  bypassForwarderPreprocessing: true,
  bypassSpecialSettings: true,
  bypassResponseRectifier: true,
  endpointPoolStrictness: "strict",
});

const rawPassthroughEndpointPathSet = new Set<string>([V1_ENDPOINT_PATHS.MESSAGES_COUNT_TOKENS]);
const guardedPassthroughEndpointPathSet = new Set<string>([V1_ENDPOINT_PATHS.RESPONSES_COMPACT]);

export function isRawPassthroughEndpointPath(pathname: string): boolean {
  return rawPassthroughEndpointPathSet.has(normalizeEndpointPath(pathname));
}

export function isRawPassthroughEndpointPolicy(policy: EndpointPolicy): boolean {
  return policy.kind === "raw_passthrough";
}

export function resolveEndpointPolicy(pathname: string): EndpointPolicy {
  if (isRawPassthroughEndpointPath(pathname)) {
    return RAW_PASSTHROUGH_ENDPOINT_POLICY;
  }

  if (guardedPassthroughEndpointPathSet.has(normalizeEndpointPath(pathname))) {
    return GUARDED_PASSTHROUGH_ENDPOINT_POLICY;
  }

  return DEFAULT_ENDPOINT_POLICY;
}
