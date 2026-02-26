import { describe, expect, it } from "vitest";
import {
  buildProviderBatchApplyUpdates,
  hasProviderBatchPatchChanges,
  normalizeProviderBatchPatchDraft,
  prepareProviderBatchApplyUpdates,
  PROVIDER_PATCH_ERROR_CODES,
} from "@/lib/provider-patch-contract";

describe("provider patch contract", () => {
  it("normalizes undefined fields as no_change and omits them from apply payload", () => {
    const normalized = normalizeProviderBatchPatchDraft({});

    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    expect(normalized.data.group_tag.mode).toBe("no_change");
    expect(hasProviderBatchPatchChanges(normalized.data)).toBe(false);

    const applyPayload = buildProviderBatchApplyUpdates(normalized.data);
    expect(applyPayload.ok).toBe(true);
    if (!applyPayload.ok) return;

    expect(applyPayload.data).toEqual({});
  });

  it("serializes set and clear with distinct payload shapes", () => {
    const setResult = prepareProviderBatchApplyUpdates({
      group_tag: { set: "primary" },
      allowed_models: { set: ["claude-3-7-sonnet"] },
    });
    const clearResult = prepareProviderBatchApplyUpdates({
      group_tag: { clear: true },
      allowed_models: { clear: true },
    });

    expect(setResult.ok).toBe(true);
    if (!setResult.ok) return;

    expect(clearResult.ok).toBe(true);
    if (!clearResult.ok) return;

    expect(setResult.data.group_tag).toBe("primary");
    expect(clearResult.data.group_tag).toBeNull();
    expect(setResult.data.allowed_models).toEqual(["claude-3-7-sonnet"]);
    expect(clearResult.data.allowed_models).toBeNull();
  });

  it("maps empty allowed_models set payload to null", () => {
    const result = prepareProviderBatchApplyUpdates({
      allowed_models: { set: [] },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.allowed_models).toBeNull();
  });

  it("maps thinking budget clear to inherit", () => {
    const result = prepareProviderBatchApplyUpdates({
      anthropic_thinking_budget_preference: { clear: true },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.anthropic_thinking_budget_preference).toBe("inherit");
  });

  it("rejects conflicting set and clear modes", () => {
    const result = normalizeProviderBatchPatchDraft({
      group_tag: {
        set: "ops",
        clear: true,
      } as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE);
    expect(result.error.field).toBe("group_tag");
  });

  it("rejects clear on non-clearable fields", () => {
    const result = normalizeProviderBatchPatchDraft({
      priority: {
        clear: true,
      } as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE);
    expect(result.error.field).toBe("priority");
  });

  it("rejects invalid set runtime shape", () => {
    const result = normalizeProviderBatchPatchDraft({
      weight: {
        set: null,
      } as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE);
    expect(result.error.field).toBe("weight");
  });

  it("rejects model_redirects arrays", () => {
    const result = normalizeProviderBatchPatchDraft({
      model_redirects: {
        set: ["not-a-record"],
      } as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE);
    expect(result.error.field).toBe("model_redirects");
  });

  it("accepts allowed_clients with string array", () => {
    const result = normalizeProviderBatchPatchDraft({
      allowed_clients: { set: ["client-a", "client-b"] },
    });

    expect(result.ok).toBe(true);
  });

  it("rejects allowed_clients with non-string array", () => {
    const result = normalizeProviderBatchPatchDraft({
      allowed_clients: { set: [123] } as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE);
    expect(result.error.field).toBe("allowed_clients");
  });

  it("accepts blocked_clients with string array", () => {
    const result = normalizeProviderBatchPatchDraft({
      blocked_clients: { set: ["bad-client"] },
    });

    expect(result.ok).toBe(true);
  });

  it("rejects blocked_clients with non-string array", () => {
    const result = normalizeProviderBatchPatchDraft({
      blocked_clients: { set: { not: "array" } } as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE);
    expect(result.error.field).toBe("blocked_clients");
  });

  it("rejects invalid thinking budget string values", () => {
    const result = normalizeProviderBatchPatchDraft({
      anthropic_thinking_budget_preference: {
        set: "abc",
      } as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE);
    expect(result.error.field).toBe("anthropic_thinking_budget_preference");
  });

  it("rejects adaptive thinking specific mode with empty models", () => {
    const result = normalizeProviderBatchPatchDraft({
      anthropic_adaptive_thinking: {
        set: {
          effort: "high",
          modelMatchMode: "specific",
          models: [],
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE);
    expect(result.error.field).toBe("anthropic_adaptive_thinking");
  });

  it("supports explicit no_change mode", () => {
    const result = normalizeProviderBatchPatchDraft({
      model_redirects: { no_change: true },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.model_redirects.mode).toBe("no_change");
  });

  it("rejects unknown top-level fields", () => {
    const result = normalizeProviderBatchPatchDraft({
      unknown_field: { set: 1 },
    } as never);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE);
    expect(result.error.field).toBe("__root__");
  });

  it("rejects non-object draft payloads", () => {
    const result = normalizeProviderBatchPatchDraft(null as never);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE);
    expect(result.error.field).toBe("__root__");
  });

  describe("routing fields", () => {
    it("accepts boolean set for preserve_client_ip and swap_cache_ttl_billing", () => {
      const result = prepareProviderBatchApplyUpdates({
        preserve_client_ip: { set: true },
        swap_cache_ttl_billing: { set: false },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.preserve_client_ip).toBe(true);
      expect(result.data.swap_cache_ttl_billing).toBe(false);
    });

    it("accepts group_priorities as Record<string, number>", () => {
      const result = prepareProviderBatchApplyUpdates({
        group_priorities: { set: { us: 10, eu: 5 } },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.group_priorities).toEqual({ us: 10, eu: 5 });
    });

    it("rejects group_priorities with non-number values", () => {
      const result = normalizeProviderBatchPatchDraft({
        group_priorities: { set: { us: "high" } } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.field).toBe("group_priorities");
    });

    it("rejects group_priorities when array", () => {
      const result = normalizeProviderBatchPatchDraft({
        group_priorities: { set: [1, 2, 3] } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.field).toBe("group_priorities");
    });

    it("clears group_priorities to null", () => {
      const result = prepareProviderBatchApplyUpdates({
        group_priorities: { clear: true },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.group_priorities).toBeNull();
    });

    it.each([
      ["cache_ttl_preference", "inherit"],
      ["cache_ttl_preference", "5m"],
      ["cache_ttl_preference", "1h"],
    ] as const)("accepts valid %s value: %s", (field, value) => {
      const result = prepareProviderBatchApplyUpdates({
        [field]: { set: value },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data[field]).toBe(value);
    });

    it("rejects invalid cache_ttl_preference value", () => {
      const result = normalizeProviderBatchPatchDraft({
        cache_ttl_preference: { set: "30m" } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.field).toBe("cache_ttl_preference");
    });

    it.each([
      ["context_1m_preference", "inherit"],
      ["context_1m_preference", "force_enable"],
      ["context_1m_preference", "disabled"],
    ] as const)("accepts valid %s value: %s", (field, value) => {
      const result = prepareProviderBatchApplyUpdates({
        [field]: { set: value },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data[field]).toBe(value);
    });

    it.each([
      ["codex_reasoning_effort_preference", "inherit"],
      ["codex_reasoning_effort_preference", "none"],
      ["codex_reasoning_effort_preference", "minimal"],
      ["codex_reasoning_effort_preference", "low"],
      ["codex_reasoning_effort_preference", "medium"],
      ["codex_reasoning_effort_preference", "high"],
      ["codex_reasoning_effort_preference", "xhigh"],
    ] as const)("accepts valid %s value: %s", (field, value) => {
      const result = prepareProviderBatchApplyUpdates({
        [field]: { set: value },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data[field]).toBe(value);
    });

    it("rejects invalid codex_reasoning_effort_preference value", () => {
      const result = normalizeProviderBatchPatchDraft({
        codex_reasoning_effort_preference: { set: "ultra" } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.field).toBe("codex_reasoning_effort_preference");
    });

    it.each([
      ["codex_reasoning_summary_preference", "inherit"],
      ["codex_reasoning_summary_preference", "auto"],
      ["codex_reasoning_summary_preference", "detailed"],
    ] as const)("accepts valid %s value: %s", (field, value) => {
      const result = prepareProviderBatchApplyUpdates({
        [field]: { set: value },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data[field]).toBe(value);
    });

    it.each([
      ["codex_text_verbosity_preference", "inherit"],
      ["codex_text_verbosity_preference", "low"],
      ["codex_text_verbosity_preference", "medium"],
      ["codex_text_verbosity_preference", "high"],
    ] as const)("accepts valid %s value: %s", (field, value) => {
      const result = prepareProviderBatchApplyUpdates({
        [field]: { set: value },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data[field]).toBe(value);
    });

    it.each([
      ["codex_parallel_tool_calls_preference", "inherit"],
      ["codex_parallel_tool_calls_preference", "true"],
      ["codex_parallel_tool_calls_preference", "false"],
    ] as const)("accepts valid %s value: %s", (field, value) => {
      const result = prepareProviderBatchApplyUpdates({
        [field]: { set: value },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data[field]).toBe(value);
    });

    it.each([
      ["gemini_google_search_preference", "inherit"],
      ["gemini_google_search_preference", "enabled"],
      ["gemini_google_search_preference", "disabled"],
    ] as const)("accepts valid %s value: %s", (field, value) => {
      const result = prepareProviderBatchApplyUpdates({
        [field]: { set: value },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data[field]).toBe(value);
    });

    it("rejects invalid gemini_google_search_preference value", () => {
      const result = normalizeProviderBatchPatchDraft({
        gemini_google_search_preference: { set: "auto" } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.field).toBe("gemini_google_search_preference");
    });
  });

  describe("anthropic_max_tokens_preference", () => {
    it("accepts inherit", () => {
      const result = prepareProviderBatchApplyUpdates({
        anthropic_max_tokens_preference: { set: "inherit" },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.anthropic_max_tokens_preference).toBe("inherit");
    });

    it("accepts positive numeric string", () => {
      const result = prepareProviderBatchApplyUpdates({
        anthropic_max_tokens_preference: { set: "8192" },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.anthropic_max_tokens_preference).toBe("8192");
    });

    it("accepts small positive numeric string (no range restriction)", () => {
      const result = prepareProviderBatchApplyUpdates({
        anthropic_max_tokens_preference: { set: "1" },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.anthropic_max_tokens_preference).toBe("1");
    });

    it("rejects non-numeric string", () => {
      const result = normalizeProviderBatchPatchDraft({
        anthropic_max_tokens_preference: { set: "abc" } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.field).toBe("anthropic_max_tokens_preference");
    });

    it("rejects zero", () => {
      const result = normalizeProviderBatchPatchDraft({
        anthropic_max_tokens_preference: { set: "0" } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.field).toBe("anthropic_max_tokens_preference");
    });

    it("clears to inherit", () => {
      const result = prepareProviderBatchApplyUpdates({
        anthropic_max_tokens_preference: { clear: true },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.anthropic_max_tokens_preference).toBe("inherit");
    });
  });

  describe("rate limit fields", () => {
    it.each([
      "limit_5h_usd",
      "limit_daily_usd",
      "limit_weekly_usd",
      "limit_monthly_usd",
      "limit_total_usd",
    ] as const)("accepts number set and clears to null for %s", (field) => {
      const setResult = prepareProviderBatchApplyUpdates({
        [field]: { set: 100.5 },
      });

      expect(setResult.ok).toBe(true);
      if (!setResult.ok) return;

      expect(setResult.data[field]).toBe(100.5);

      const clearResult = prepareProviderBatchApplyUpdates({
        [field]: { clear: true },
      });

      expect(clearResult.ok).toBe(true);
      if (!clearResult.ok) return;

      expect(clearResult.data[field]).toBeNull();
    });

    it("rejects non-number for limit_5h_usd", () => {
      const result = normalizeProviderBatchPatchDraft({
        limit_5h_usd: { set: "100" } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.field).toBe("limit_5h_usd");
    });

    it("rejects NaN for number fields", () => {
      const result = normalizeProviderBatchPatchDraft({
        limit_daily_usd: { set: Number.NaN } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.field).toBe("limit_daily_usd");
    });

    it("rejects Infinity for number fields", () => {
      const result = normalizeProviderBatchPatchDraft({
        limit_weekly_usd: { set: Number.POSITIVE_INFINITY } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.field).toBe("limit_weekly_usd");
    });

    it("accepts limit_concurrent_sessions as number (non-clearable)", () => {
      const result = prepareProviderBatchApplyUpdates({
        limit_concurrent_sessions: { set: 5 },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.limit_concurrent_sessions).toBe(5);
    });

    it("rejects clear on limit_concurrent_sessions", () => {
      const result = normalizeProviderBatchPatchDraft({
        limit_concurrent_sessions: { clear: true } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.field).toBe("limit_concurrent_sessions");
    });

    it.each(["fixed", "rolling"] as const)("accepts daily_reset_mode value: %s", (value) => {
      const result = prepareProviderBatchApplyUpdates({
        daily_reset_mode: { set: value },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.daily_reset_mode).toBe(value);
    });

    it("rejects invalid daily_reset_mode value", () => {
      const result = normalizeProviderBatchPatchDraft({
        daily_reset_mode: { set: "hourly" } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.field).toBe("daily_reset_mode");
    });

    it("rejects clear on daily_reset_mode", () => {
      const result = normalizeProviderBatchPatchDraft({
        daily_reset_mode: { clear: true } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.field).toBe("daily_reset_mode");
    });

    it("accepts daily_reset_time as string (non-clearable)", () => {
      const result = prepareProviderBatchApplyUpdates({
        daily_reset_time: { set: "00:00" },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.daily_reset_time).toBe("00:00");
    });

    it("rejects clear on daily_reset_time", () => {
      const result = normalizeProviderBatchPatchDraft({
        daily_reset_time: { clear: true } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.field).toBe("daily_reset_time");
    });
  });

  describe("circuit breaker fields", () => {
    it.each([
      "circuit_breaker_failure_threshold",
      "circuit_breaker_open_duration",
      "circuit_breaker_half_open_success_threshold",
    ] as const)("accepts number set for %s (non-clearable)", (field) => {
      const result = prepareProviderBatchApplyUpdates({
        [field]: { set: 10 },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data[field]).toBe(10);
    });

    it.each([
      "circuit_breaker_failure_threshold",
      "circuit_breaker_open_duration",
      "circuit_breaker_half_open_success_threshold",
    ] as const)("rejects clear on %s", (field) => {
      const result = normalizeProviderBatchPatchDraft({
        [field]: { clear: true } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.field).toBe(field);
    });

    it("accepts max_retry_attempts and clears to null", () => {
      const setResult = prepareProviderBatchApplyUpdates({
        max_retry_attempts: { set: 3 },
      });

      expect(setResult.ok).toBe(true);
      if (!setResult.ok) return;

      expect(setResult.data.max_retry_attempts).toBe(3);

      const clearResult = prepareProviderBatchApplyUpdates({
        max_retry_attempts: { clear: true },
      });

      expect(clearResult.ok).toBe(true);
      if (!clearResult.ok) return;

      expect(clearResult.data.max_retry_attempts).toBeNull();
    });
  });

  describe("network fields", () => {
    it("accepts proxy_url as string and clears to null", () => {
      const setResult = prepareProviderBatchApplyUpdates({
        proxy_url: { set: "socks5://proxy.example.com:1080" },
      });

      expect(setResult.ok).toBe(true);
      if (!setResult.ok) return;

      expect(setResult.data.proxy_url).toBe("socks5://proxy.example.com:1080");

      const clearResult = prepareProviderBatchApplyUpdates({
        proxy_url: { clear: true },
      });

      expect(clearResult.ok).toBe(true);
      if (!clearResult.ok) return;

      expect(clearResult.data.proxy_url).toBeNull();
    });

    it("accepts boolean set for proxy_fallback_to_direct (non-clearable)", () => {
      const result = prepareProviderBatchApplyUpdates({
        proxy_fallback_to_direct: { set: true },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.proxy_fallback_to_direct).toBe(true);
    });

    it("rejects clear on proxy_fallback_to_direct", () => {
      const result = normalizeProviderBatchPatchDraft({
        proxy_fallback_to_direct: { clear: true } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.field).toBe("proxy_fallback_to_direct");
    });

    it.each([
      "first_byte_timeout_streaming_ms",
      "streaming_idle_timeout_ms",
      "request_timeout_non_streaming_ms",
    ] as const)("accepts number set for %s (non-clearable)", (field) => {
      const result = prepareProviderBatchApplyUpdates({
        [field]: { set: 30000 },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data[field]).toBe(30000);
    });

    it.each([
      "first_byte_timeout_streaming_ms",
      "streaming_idle_timeout_ms",
      "request_timeout_non_streaming_ms",
    ] as const)("rejects clear on %s", (field) => {
      const result = normalizeProviderBatchPatchDraft({
        [field]: { clear: true } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.field).toBe(field);
    });
  });

  describe("MCP fields", () => {
    it.each([
      "none",
      "minimax",
      "glm",
      "custom",
    ] as const)("accepts mcp_passthrough_type value: %s", (value) => {
      const result = prepareProviderBatchApplyUpdates({
        mcp_passthrough_type: { set: value },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.mcp_passthrough_type).toBe(value);
    });

    it("rejects invalid mcp_passthrough_type value", () => {
      const result = normalizeProviderBatchPatchDraft({
        mcp_passthrough_type: { set: "openai" } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.field).toBe("mcp_passthrough_type");
    });

    it("rejects clear on mcp_passthrough_type", () => {
      const result = normalizeProviderBatchPatchDraft({
        mcp_passthrough_type: { clear: true } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.field).toBe("mcp_passthrough_type");
    });

    it("accepts mcp_passthrough_url as string and clears to null", () => {
      const setResult = prepareProviderBatchApplyUpdates({
        mcp_passthrough_url: { set: "https://api.minimaxi.com" },
      });

      expect(setResult.ok).toBe(true);
      if (!setResult.ok) return;

      expect(setResult.data.mcp_passthrough_url).toBe("https://api.minimaxi.com");

      const clearResult = prepareProviderBatchApplyUpdates({
        mcp_passthrough_url: { clear: true },
      });

      expect(clearResult.ok).toBe(true);
      if (!clearResult.ok) return;

      expect(clearResult.data.mcp_passthrough_url).toBeNull();
    });
  });

  describe("preference fields clear to inherit", () => {
    it.each([
      "cache_ttl_preference",
      "context_1m_preference",
      "codex_reasoning_effort_preference",
      "codex_reasoning_summary_preference",
      "codex_text_verbosity_preference",
      "codex_parallel_tool_calls_preference",
      "anthropic_max_tokens_preference",
      "gemini_google_search_preference",
    ] as const)("clears %s to inherit", (field) => {
      const result = prepareProviderBatchApplyUpdates({
        [field]: { clear: true },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data[field]).toBe("inherit");
    });
  });

  describe("non-clearable field rejection", () => {
    it.each([
      "preserve_client_ip",
      "swap_cache_ttl_billing",
      "daily_reset_mode",
      "daily_reset_time",
      "limit_concurrent_sessions",
      "circuit_breaker_failure_threshold",
      "circuit_breaker_open_duration",
      "circuit_breaker_half_open_success_threshold",
      "proxy_fallback_to_direct",
      "first_byte_timeout_streaming_ms",
      "streaming_idle_timeout_ms",
      "request_timeout_non_streaming_ms",
      "mcp_passthrough_type",
    ] as const)("rejects clear on non-clearable field: %s", (field) => {
      const result = normalizeProviderBatchPatchDraft({
        [field]: { clear: true } as never,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe(PROVIDER_PATCH_ERROR_CODES.INVALID_PATCH_SHAPE);
      expect(result.error.field).toBe(field);
    });
  });

  describe("hasProviderBatchPatchChanges for new fields", () => {
    it("detects change on a single new field", () => {
      const normalized = normalizeProviderBatchPatchDraft({
        preserve_client_ip: { set: true },
      });

      expect(normalized.ok).toBe(true);
      if (!normalized.ok) return;

      expect(hasProviderBatchPatchChanges(normalized.data)).toBe(true);
    });

    it("detects change on mcp_passthrough_url (last field)", () => {
      const normalized = normalizeProviderBatchPatchDraft({
        mcp_passthrough_url: { set: "https://example.com" },
      });

      expect(normalized.ok).toBe(true);
      if (!normalized.ok) return;

      expect(hasProviderBatchPatchChanges(normalized.data)).toBe(true);
    });

    it("reports no change when all new fields are no_change", () => {
      const normalized = normalizeProviderBatchPatchDraft({
        preserve_client_ip: { no_change: true },
        limit_5h_usd: { no_change: true },
        proxy_url: { no_change: true },
      });

      expect(normalized.ok).toBe(true);
      if (!normalized.ok) return;

      expect(hasProviderBatchPatchChanges(normalized.data)).toBe(false);
    });
  });

  describe("combined set across all categories", () => {
    it("handles a batch patch touching all field categories at once", () => {
      const result = prepareProviderBatchApplyUpdates({
        // existing
        is_enabled: { set: true },
        group_tag: { set: "batch-test" },
        // routing
        preserve_client_ip: { set: false },
        cache_ttl_preference: { set: "1h" },
        codex_reasoning_effort_preference: { set: "high" },
        anthropic_max_tokens_preference: { set: "16384" },
        // rate limit
        limit_5h_usd: { set: 50 },
        daily_reset_mode: { set: "rolling" },
        daily_reset_time: { set: "08:00" },
        // circuit breaker
        circuit_breaker_failure_threshold: { set: 5 },
        max_retry_attempts: { set: 2 },
        // network
        proxy_url: { set: "https://proxy.local" },
        proxy_fallback_to_direct: { set: true },
        first_byte_timeout_streaming_ms: { set: 15000 },
        // mcp
        mcp_passthrough_type: { set: "minimax" },
        mcp_passthrough_url: { set: "https://api.minimaxi.com" },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.is_enabled).toBe(true);
      expect(result.data.group_tag).toBe("batch-test");
      expect(result.data.preserve_client_ip).toBe(false);
      expect(result.data.cache_ttl_preference).toBe("1h");
      expect(result.data.codex_reasoning_effort_preference).toBe("high");
      expect(result.data.anthropic_max_tokens_preference).toBe("16384");
      expect(result.data.limit_5h_usd).toBe(50);
      expect(result.data.daily_reset_mode).toBe("rolling");
      expect(result.data.daily_reset_time).toBe("08:00");
      expect(result.data.circuit_breaker_failure_threshold).toBe(5);
      expect(result.data.max_retry_attempts).toBe(2);
      expect(result.data.proxy_url).toBe("https://proxy.local");
      expect(result.data.proxy_fallback_to_direct).toBe(true);
      expect(result.data.first_byte_timeout_streaming_ms).toBe(15000);
      expect(result.data.mcp_passthrough_type).toBe("minimax");
      expect(result.data.mcp_passthrough_url).toBe("https://api.minimaxi.com");
    });
  });
});
