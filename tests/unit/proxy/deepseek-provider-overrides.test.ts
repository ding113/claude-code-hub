import { describe, expect, test } from "vitest";
import {
  applyDeepSeekProviderOverrides,
  applyDeepSeekProviderOverridesWithAudit,
} from "@/lib/deepseek/provider-overrides";

describe("applyDeepSeekProviderOverrides", () => {
  test("returns the original request for non-deepseek providers", () => {
    const provider = {
      providerType: "claude",
      deepseekReasoningEffortPreference: "max",
    };
    const request = {
      model: "deepseek-v4-flash",
      messages: [],
    };

    const result = applyDeepSeekProviderOverrides(provider, request);

    expect(result).toBe(request);
  });

  test("uses output_config.effort for claude-format requests even without body markers", () => {
    const provider = {
      providerType: "deepseek",
      deepseekReasoningEffortPreference: "max",
    };
    const request = {
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 256,
    };

    const result = applyDeepSeekProviderOverrides(provider, request, {
      requestFormat: "claude",
    });

    expect(result).not.toBe(request);
    expect(result.output_config).toEqual({ effort: "max" });
    expect(result.reasoning_effort).toBeUndefined();
  });

  test("uses reasoning_effort for openai-format requests", () => {
    const provider = {
      providerType: "deepseek",
      deepseekReasoningEffortPreference: "high",
    };
    const request = {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
    };

    const result = applyDeepSeekProviderOverrides(provider, request, {
      requestFormat: "openai",
    });

    expect(result.reasoning_effort).toBe("high");
    expect(result.output_config).toBeUndefined();
  });
});

describe("applyDeepSeekProviderOverridesWithAudit", () => {
  test("records claude-format override under output_config.effort", () => {
    const provider = {
      id: 1,
      name: "deepseek",
      providerType: "deepseek",
      deepseekReasoningEffortPreference: "max",
    };
    const request = {
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 256,
    };

    const result = applyDeepSeekProviderOverridesWithAudit(provider, request, {
      requestFormat: "claude",
    });

    expect(result.request.output_config).toEqual({ effort: "max" });
    expect(result.audit?.changed).toBe(true);
    expect(result.audit?.changes).toEqual([
      {
        path: "output_config.effort",
        before: null,
        after: "max",
        changed: true,
      },
    ]);
  });
});
