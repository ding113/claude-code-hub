import { describe, expect, test } from "vitest";
import {
  isRawPassthroughEndpointPath,
  isRawPassthroughEndpointPolicy,
  resolveEndpointPolicy,
} from "@/app/v1/_lib/proxy/endpoint-policy";
import { V1_ENDPOINT_PATHS } from "@/app/v1/_lib/proxy/endpoint-paths";

describe("endpoint-policy", () => {
  test("raw passthrough endpoints resolve to identical strict policy", () => {
    const countTokensPolicy = resolveEndpointPolicy(V1_ENDPOINT_PATHS.MESSAGES_COUNT_TOKENS);
    const compactPolicy = resolveEndpointPolicy(V1_ENDPOINT_PATHS.RESPONSES_COMPACT);

    expect(countTokensPolicy).toBe(compactPolicy);
    expect(isRawPassthroughEndpointPolicy(countTokensPolicy)).toBe(true);
    expect(countTokensPolicy).toEqual({
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
  });

  test.each([
    "/v1/messages/count_tokens/",
    "/V1/MESSAGES/COUNT_TOKENS",
    "/v1/responses/compact/",
    "/V1/RESPONSES/COMPACT",
  ])("raw passthrough endpoints path helper matches variant %s", (pathname) => {
    expect(isRawPassthroughEndpointPath(pathname)).toBe(true);
    expect(isRawPassthroughEndpointPolicy(resolveEndpointPolicy(pathname))).toBe(true);
  });

  test("default policy stays on non-target endpoints", () => {
    const messagesPolicy = resolveEndpointPolicy(V1_ENDPOINT_PATHS.MESSAGES);
    const responsesPolicy = resolveEndpointPolicy(V1_ENDPOINT_PATHS.RESPONSES);

    expect(messagesPolicy).toBe(responsesPolicy);
    expect(isRawPassthroughEndpointPolicy(messagesPolicy)).toBe(false);
    expect(messagesPolicy).toEqual({
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
  });
});
