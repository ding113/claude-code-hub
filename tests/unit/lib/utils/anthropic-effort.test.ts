import { describe, expect, test } from "vitest";
import type { SpecialSetting } from "@/types/special-settings";
import {
  extractAnthropicEffortInfo,
  extractReasoningEffortInfo,
  type AnthropicEffortOverrideInfo,
} from "@/lib/utils/anthropic-effort";

describe("extractAnthropicEffortInfo", () => {
  const cases: Array<{
    name: string;
    input: SpecialSetting[] | null | undefined;
    expected: AnthropicEffortOverrideInfo | null;
  }> = [
    {
      name: "null specialSettings returns null",
      input: null,
      expected: null,
    },
    {
      name: "undefined specialSettings returns null",
      input: undefined,
      expected: null,
    },
    {
      name: "empty array returns null",
      input: [],
      expected: null,
    },
    {
      name: "no effort-related settings returns null",
      input: [
        {
          type: "response_fixer",
          scope: "response",
          hit: true,
          fixersApplied: [],
          totalBytesProcessed: 0,
          processingTimeMs: 0,
        },
      ],
      expected: null,
    },
    {
      name: "anthropic_effort only (no override) returns original effort",
      input: [
        {
          type: "anthropic_effort",
          scope: "request",
          hit: true,
          effort: "medium",
        },
      ],
      expected: {
        originalEffort: "medium",
        overriddenEffort: null,
        isOverridden: false,
        path: "output_config.effort",
        hasRequestEffort: true,
      },
    },
    {
      name: "anthropic_effort + override with changed:true returns overridden info",
      input: [
        {
          type: "anthropic_effort",
          scope: "request",
          hit: true,
          effort: "medium",
        },
        {
          type: "provider_parameter_override",
          scope: "provider",
          providerId: 1,
          providerName: "test",
          providerType: "claude",
          hit: true,
          changed: true,
          changes: [
            { path: "max_tokens", before: 1024, after: 1024, changed: false },
            { path: "output_config.effort", before: "medium", after: "high", changed: true },
          ],
        },
      ],
      expected: {
        originalEffort: "medium",
        overriddenEffort: "high",
        isOverridden: true,
        path: "output_config.effort",
        hasRequestEffort: true,
      },
    },
    {
      name: "override with changed:false returns non-overridden info",
      input: [
        {
          type: "anthropic_effort",
          scope: "request",
          hit: true,
          effort: "high",
        },
        {
          type: "provider_parameter_override",
          scope: "provider",
          providerId: 1,
          providerName: "test",
          providerType: "claude",
          hit: true,
          changed: false,
          changes: [
            { path: "output_config.effort", before: "high", after: "high", changed: false },
          ],
        },
      ],
      expected: {
        originalEffort: "high",
        overriddenEffort: null,
        isOverridden: false,
        path: "output_config.effort",
        hasRequestEffort: true,
      },
    },
    {
      name: "fallback: no anthropic_effort but override exists uses before as original",
      input: [
        {
          type: "provider_parameter_override",
          scope: "provider",
          providerId: 1,
          providerName: "test",
          providerType: "claude",
          hit: true,
          changed: true,
          changes: [{ path: "output_config.effort", before: "low", after: "max", changed: true }],
        },
      ],
      expected: {
        originalEffort: "low",
        overriddenEffort: "max",
        isOverridden: true,
        path: "output_config.effort",
        hasRequestEffort: true,
      },
    },
    {
      name: "override with no effort path returns effort from anthropic_effort only",
      input: [
        {
          type: "anthropic_effort",
          scope: "request",
          hit: true,
          effort: "auto",
        },
        {
          type: "provider_parameter_override",
          scope: "provider",
          providerId: 1,
          providerName: "test",
          providerType: "claude",
          hit: true,
          changed: true,
          changes: [{ path: "max_tokens", before: 1024, after: 2048, changed: true }],
        },
      ],
      expected: {
        originalEffort: "auto",
        overriddenEffort: null,
        isOverridden: false,
        path: "output_config.effort",
        hasRequestEffort: true,
      },
    },
    {
      name: "anthropic_effort with whitespace-only effort is ignored",
      input: [
        {
          type: "anthropic_effort",
          scope: "request",
          hit: true,
          effort: "   ",
        },
      ],
      expected: null,
    },
  ];

  for (const { name, input, expected } of cases) {
    test(name, () => {
      expect(extractAnthropicEffortInfo(input)).toEqual(expected);
    });
  }
});

describe("extractReasoningEffortInfo", () => {
  test("reads generic request audit for codex reasoning.effort", () => {
    expect(
      extractReasoningEffortInfo([
        {
          type: "reasoning_effort",
          scope: "request",
          hit: true,
          path: "reasoning.effort",
          effort: "high",
        },
      ])
    ).toEqual({
      originalEffort: "high",
      overriddenEffort: null,
      isOverridden: false,
      path: "reasoning.effort",
      hasRequestEffort: true,
    });
  });

  test("uses reasoning.effort override audit path when provider changed codex effort", () => {
    expect(
      extractReasoningEffortInfo([
        {
          type: "reasoning_effort",
          scope: "request",
          hit: true,
          path: "reasoning.effort",
          effort: "medium",
        },
        {
          type: "provider_parameter_override",
          scope: "provider",
          providerId: 2,
          providerName: "codex provider",
          providerType: "codex",
          hit: true,
          changed: true,
          changes: [
            { path: "reasoning.summary", before: "auto", after: "detailed", changed: true },
            { path: "reasoning.effort", before: "medium", after: "high", changed: true },
          ],
        },
      ])
    ).toEqual({
      originalEffort: "medium",
      overriddenEffort: "high",
      isOverridden: true,
      path: "reasoning.effort",
      hasRequestEffort: true,
    });
  });

  test("falls back to override-only reasoning.effort audit", () => {
    expect(
      extractReasoningEffortInfo([
        {
          type: "provider_parameter_override",
          scope: "provider",
          providerId: 2,
          providerName: "codex provider",
          providerType: "codex",
          hit: true,
          changed: true,
          changes: [{ path: "reasoning.effort", before: "low", after: "xhigh", changed: true }],
        },
      ])
    ).toEqual({
      originalEffort: "low",
      overriddenEffort: "xhigh",
      isOverridden: true,
      path: "reasoning.effort",
      hasRequestEffort: true,
    });
  });

  test("uses applied effort when provider override added effort without request value", () => {
    expect(
      extractReasoningEffortInfo([
        {
          type: "provider_parameter_override",
          scope: "provider",
          providerId: 2,
          providerName: "codex provider",
          providerType: "codex",
          hit: true,
          changed: true,
          changes: [{ path: "reasoning.effort", before: null, after: "high", changed: true }],
        },
      ])
    ).toEqual({
      originalEffort: "high",
      overriddenEffort: "high",
      isOverridden: true,
      path: "reasoning.effort",
      hasRequestEffort: false,
    });
  });

  test("prefers generic request audit over legacy anthropic setting when both exist", () => {
    expect(
      extractReasoningEffortInfo([
        {
          type: "anthropic_effort",
          scope: "request",
          hit: true,
          effort: "medium",
        },
        {
          type: "reasoning_effort",
          scope: "request",
          hit: true,
          path: "reasoning.effort",
          effort: "high",
        },
      ])
    ).toEqual({
      originalEffort: "high",
      overriddenEffort: null,
      isOverridden: false,
      path: "reasoning.effort",
      hasRequestEffort: true,
    });
  });

  test("matches DeepSeek reasoning_effort override when original path is reasoning.effort", () => {
    expect(
      extractReasoningEffortInfo([
        {
          type: "reasoning_effort",
          scope: "request",
          hit: true,
          path: "reasoning.effort",
          effort: "medium",
        },
        {
          type: "provider_parameter_override",
          scope: "provider",
          providerId: 3,
          providerName: "deepseek provider",
          providerType: "deepseek",
          hit: true,
          changed: true,
          changes: [{ path: "reasoning_effort", before: "medium", after: "max", changed: true }],
        },
      ])
    ).toEqual({
      originalEffort: "medium",
      overriddenEffort: "max",
      isOverridden: true,
      path: "reasoning.effort",
      hasRequestEffort: true,
    });
  });
});
