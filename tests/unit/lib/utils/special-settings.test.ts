import { describe, expect, test } from "vitest";
import type { SpecialSetting } from "@/types/special-settings";
import { buildUnifiedSpecialSettings } from "@/lib/utils/special-settings";

describe("buildUnifiedSpecialSettings", () => {
  test("无任何输入时应返回 null", () => {
    expect(buildUnifiedSpecialSettings({ existing: null })).toBe(null);
  });

  test("blockedBy=warmup 时应派生 guard_intercept 特殊设置", () => {
    const settings = buildUnifiedSpecialSettings({
      existing: null,
      blockedBy: "warmup",
      blockedReason: JSON.stringify({ reason: "anthropic_warmup_intercepted" }),
      statusCode: 200,
    });

    expect(settings).not.toBeNull();
    expect(settings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "guard_intercept",
          scope: "guard",
          hit: true,
          guard: "warmup",
          action: "intercept_response",
          statusCode: 200,
        }),
      ])
    );
  });

  test("blockedBy=sensitive_word 时应派生 guard_intercept 特殊设置", () => {
    const settings = buildUnifiedSpecialSettings({
      existing: null,
      blockedBy: "sensitive_word",
      blockedReason: JSON.stringify({ word: "x" }),
      statusCode: 400,
    });

    expect(settings).not.toBeNull();
    expect(settings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "guard_intercept",
          scope: "guard",
          hit: true,
          guard: "sensitive_word",
          action: "block_request",
          statusCode: 400,
        }),
      ])
    );
  });

  test("cacheTtlApplied 存在时应派生 anthropic_cache_ttl_header_override 特殊设置", () => {
    const settings = buildUnifiedSpecialSettings({
      existing: null,
      cacheTtlApplied: "1h",
    });

    expect(settings).not.toBeNull();
    expect(settings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "anthropic_cache_ttl_header_override",
          scope: "request_header",
          hit: true,
          ttl: "1h",
        }),
      ])
    );
  });

  test("context1mApplied=true 时应派生 anthropic_context_1m_header_override 特殊设置", () => {
    const settings = buildUnifiedSpecialSettings({
      existing: null,
      context1mApplied: true,
    });

    expect(settings).not.toBeNull();
    expect(settings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "anthropic_context_1m_header_override",
          scope: "request_header",
          hit: true,
          header: "anthropic-beta",
        }),
      ])
    );
  });

  test("应合并 existing specialSettings 与派生 specialSettings", () => {
    const existing: SpecialSetting[] = [
      {
        type: "provider_parameter_override",
        scope: "provider",
        providerId: 1,
        providerName: "p",
        providerType: "codex",
        hit: true,
        changed: true,
        changes: [{ path: "temperature", before: 1, after: 0.2, changed: true }],
      },
    ];

    const settings = buildUnifiedSpecialSettings({
      existing,
      blockedBy: "warmup",
      blockedReason: JSON.stringify({ reason: "anthropic_warmup_intercepted" }),
      statusCode: 200,
    });

    expect(settings).not.toBeNull();
    expect(settings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "provider_parameter_override" }),
        expect.objectContaining({ type: "guard_intercept", guard: "warmup" }),
      ])
    );
  });

  test("应对重复的派生项去重（例如 existing 已包含同类 guard_intercept）", () => {
    const existing: SpecialSetting[] = [
      {
        type: "guard_intercept",
        scope: "guard",
        hit: true,
        guard: "warmup",
        action: "intercept_response",
        statusCode: 200,
        reason: JSON.stringify({ reason: "anthropic_warmup_intercepted" }),
      },
    ];

    const settings = buildUnifiedSpecialSettings({
      existing,
      blockedBy: "warmup",
      blockedReason: JSON.stringify({ reason: "anthropic_warmup_intercepted" }),
      statusCode: 200,
    });

    expect(settings).not.toBeNull();
    expect(settings?.filter((s) => s.type === "guard_intercept").length).toBe(1);
  });

  test("guard_intercept 去重时不应受 reason 差异影响", () => {
    const existing: SpecialSetting[] = [
      {
        type: "guard_intercept",
        scope: "guard",
        hit: true,
        guard: "warmup",
        action: "intercept_response",
        statusCode: 200,
        reason: JSON.stringify({ reason: "a" }),
      },
    ];

    const settings = buildUnifiedSpecialSettings({
      existing,
      blockedBy: "warmup",
      blockedReason: JSON.stringify({ reason: "b" }),
      statusCode: 200,
    });

    expect(settings).not.toBeNull();
    expect(settings?.filter((s) => s.type === "guard_intercept").length).toBe(1);
  });
});
