import { normalizeEndpointPath, V1_ENDPOINT_PATHS } from "./endpoint-paths";

export type EndpointGuardPreset = "chat" | "raw_passthrough";

export type EndpointPoolStrictness = "inherit" | "strict";

export interface EndpointPolicy {
  readonly kind: "default" | "raw_passthrough";
  readonly guardPreset: EndpointGuardPreset;
  readonly allowRetry: boolean;
  readonly allowProviderSwitch: boolean;
  readonly allowRawCrossProviderFallback: boolean;
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
  allowRawCrossProviderFallback: false,
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
  allowRawCrossProviderFallback: true,
  allowCircuitBreakerAccounting: false,
  trackConcurrentRequests: false,
  bypassRequestFilters: true,
  bypassForwarderPreprocessing: true,
  bypassSpecialSettings: true,
  bypassResponseRectifier: true,
  endpointPoolStrictness: "strict",
});

const rawPassthroughEndpointPathSet = new Set<string>([
  V1_ENDPOINT_PATHS.MESSAGES_COUNT_TOKENS,
  V1_ENDPOINT_PATHS.RESPONSES_COMPACT,
]);

export function isRawPassthroughEndpointPath(pathname: string): boolean {
  return rawPassthroughEndpointPathSet.has(normalizeEndpointPath(pathname));
}

export function isRawPassthroughEndpointPolicy(policy: EndpointPolicy): boolean {
  return policy.kind === "raw_passthrough";
}

export function isStrictEndpointPoolPolicy(policy: Pick<EndpointPolicy, "endpointPoolStrictness">) {
  return policy.endpointPoolStrictness === "strict";
}

export function resolveEndpointPolicy(pathname: string): EndpointPolicy {
  const normalizedPath = normalizeEndpointPath(pathname);

  if (rawPassthroughEndpointPathSet.has(normalizedPath)) {
    return RAW_PASSTHROUGH_ENDPOINT_POLICY;
  }

  return DEFAULT_ENDPOINT_POLICY;
}
