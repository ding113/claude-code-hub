import { describe, expect, test } from "vitest";
import {
  isRawPassthroughEndpointPolicy,
  resolveEndpointPolicy,
} from "@/app/v1/_lib/proxy/endpoint-policy";
import { V1_ENDPOINT_PATHS } from "@/app/v1/_lib/proxy/endpoint-paths";

describe("non-chat endpoint policy", () => {
  test("count tokens and compact remain raw passthrough while exposing fallback capability", () => {
    const countTokensPolicy = resolveEndpointPolicy(V1_ENDPOINT_PATHS.MESSAGES_COUNT_TOKENS);
    const compactPolicy = resolveEndpointPolicy(V1_ENDPOINT_PATHS.RESPONSES_COMPACT);

    expect(countTokensPolicy).toBe(compactPolicy);
    expect(isRawPassthroughEndpointPolicy(countTokensPolicy)).toBe(true);
    expect(countTokensPolicy).toEqual(
      expect.objectContaining({
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
      })
    );
  });

  test("other endpoint families remain unchanged", () => {
    const messagesPolicy = resolveEndpointPolicy(V1_ENDPOINT_PATHS.MESSAGES);
    const chatCompletionsPolicy = resolveEndpointPolicy(V1_ENDPOINT_PATHS.CHAT_COMPLETIONS);
    const embeddingsPolicy = resolveEndpointPolicy(V1_ENDPOINT_PATHS.EMBEDDINGS);

    expect(messagesPolicy).toEqual(
      expect.objectContaining({
        kind: "default",
        guardPreset: "chat",
        allowRetry: true,
        allowProviderSwitch: true,
        allowRawCrossProviderFallback: false,
      })
    );
    expect(chatCompletionsPolicy).toEqual(
      expect.objectContaining({
        kind: "default",
        guardPreset: "chat",
        allowRawCrossProviderFallback: false,
      })
    );
    expect(embeddingsPolicy.endpointPoolStrictness).toBe("inherit");
  });
});
