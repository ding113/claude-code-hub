import { describe, expect, it } from "vitest";
import {
  buildNewApiAccessTokenEditPayload,
  parseNewApiUserIdInput,
} from "@/app/[locale]/settings/providers/_components/forms/provider-form/new-api-access";
import {
  createInitialState,
  providerFormReducer,
} from "@/app/[locale]/settings/providers/_components/forms/provider-form/provider-form-context";
import type { ProviderDisplay } from "@/types/provider";

function makeProvider(overrides: Partial<ProviderDisplay> = {}): ProviderDisplay {
  return {
    id: 1,
    name: "relay",
    url: "https://relay.example.com",
    maskedKey: "sk-****1234",
    maskedNewApiAccessToken: "pat-****wxyz",
    newApiUserId: 7,
    isEnabled: true,
    weight: 1,
    priority: 0,
    groupPriorities: null,
    costMultiplier: 1,
    groupTag: null,
    providerType: "claude",
    providerVendorId: null,
    preserveClientIp: false,
    disableSessionReuse: false,
    modelRedirects: null,
    activeTimeStart: null,
    activeTimeEnd: null,
    allowedModels: null,
    allowedClients: [],
    blockedClients: [],
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
    limit5hUsd: null,
    limit5hResetMode: "rolling",
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    limitConcurrentSessions: 0,
    maxRetryAttempts: null,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerOpenDuration: 1_800_000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    customHeaders: null,
    firstByteTimeoutStreamingMs: 0,
    streamingIdleTimeoutMs: 0,
    requestTimeoutNonStreamingMs: 0,
    websiteUrl: null,
    faviconUrl: null,
    cacheTtlPreference: null,
    swapCacheTtlBilling: false,
    context1mPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexTextVerbosityPreference: null,
    codexParallelToolCallsPreference: null,
    codexImageGenerationPreference: null,
    codexServiceTierPreference: null,
    anthropicMaxTokensPreference: null,
    anthropicThinkingBudgetPreference: null,
    anthropicAdaptiveThinking: null,
    geminiGoogleSearchPreference: null,
    tpm: null,
    rpm: null,
    rpd: null,
    cc: null,
    createdAt: "2026-09-25",
    updatedAt: "2026-09-25",
    ...overrides,
  };
}

describe("parseNewApiUserIdInput", () => {
  it("空白输入表示不配置", () => {
    expect(parseNewApiUserIdInput("")).toBeNull();
    expect(parseNewApiUserIdInput("   ")).toBeNull();
  });

  it("正整数返回数值，允许两端空白", () => {
    expect(parseNewApiUserIdInput("7")).toBe(7);
    expect(parseNewApiUserIdInput(" 42 ")).toBe(42);
    expect(parseNewApiUserIdInput("2147483647")).toBe(2_147_483_647);
  });

  it("零、负数、小数、非数字与超出整数范围的输入都不合法", () => {
    for (const input of ["0", "-1", "1.5", "1e3", "abc", "7a", "2147483648"]) {
      expect(parseNewApiUserIdInput(input)).toBeUndefined();
    }
  });
});

describe("buildNewApiAccessTokenEditPayload", () => {
  it("选择清除时提交 null，即使同时有输入", () => {
    expect(buildNewApiAccessTokenEditPayload("", true)).toEqual({ new_api_access_token: null });
    expect(buildNewApiAccessTokenEditPayload("pat-new", true)).toEqual({
      new_api_access_token: null,
    });
  });

  it("填写了新令牌时提交新令牌", () => {
    expect(buildNewApiAccessTokenEditPayload("pat-new", false)).toEqual({
      new_api_access_token: "pat-new",
    });
  });

  it("既没有填写也没有清除时不提交该字段", () => {
    expect(buildNewApiAccessTokenEditPayload("", false)).toEqual({});
  });
});

describe("createInitialState 的余额查询字段", () => {
  it("新建时全部为空", () => {
    const state = createInitialState("create");

    expect(state.basic.newApiAccessToken).toBe("");
    expect(state.basic.clearNewApiAccessToken).toBe(false);
    expect(state.basic.newApiUserId).toBe("");
  });

  it("编辑时带出用户 ID，令牌输入框保持为空", () => {
    const state = createInitialState("edit", makeProvider());

    expect(state.basic.newApiAccessToken).toBe("");
    expect(state.basic.clearNewApiAccessToken).toBe(false);
    expect(state.basic.newApiUserId).toBe("7");
  });

  it("编辑未配置用户 ID 的供应商时用户 ID 为空", () => {
    const state = createInitialState("edit", makeProvider({ newApiUserId: null }));

    expect(state.basic.newApiUserId).toBe("");
  });

  it("复制供应商时带出用户 ID，令牌需要重新填写", () => {
    const state = createInitialState("create", undefined, makeProvider());

    expect(state.basic.newApiAccessToken).toBe("");
    expect(state.basic.newApiUserId).toBe("7");
  });

  it("批量编辑不涉及余额查询字段", () => {
    const state = createInitialState("batch", undefined, undefined, undefined, [makeProvider()]);

    expect(state.basic.newApiAccessToken).toBe("");
    expect(state.basic.newApiUserId).toBe("");
  });
});

describe("providerFormReducer 的余额查询字段", () => {
  const editState = createInitialState("edit", makeProvider());

  it("填写新令牌时取消清除", () => {
    const cleared = providerFormReducer(editState, {
      type: "SET_CLEAR_NEW_API_ACCESS_TOKEN",
      payload: true,
    });
    const next = providerFormReducer(cleared, {
      type: "SET_NEW_API_ACCESS_TOKEN",
      payload: "pat-new",
    });

    expect(next.basic.newApiAccessToken).toBe("pat-new");
    expect(next.basic.clearNewApiAccessToken).toBe(false);
  });

  it("选择清除时丢弃尚未保存的新令牌", () => {
    const typed = providerFormReducer(editState, {
      type: "SET_NEW_API_ACCESS_TOKEN",
      payload: "pat-new",
    });
    const cleared = providerFormReducer(typed, {
      type: "SET_CLEAR_NEW_API_ACCESS_TOKEN",
      payload: true,
    });

    expect(cleared.basic.clearNewApiAccessToken).toBe(true);
    expect(cleared.basic.newApiAccessToken).toBe("");
  });

  it("取消清除时保留当前输入", () => {
    const next = providerFormReducer(editState, {
      type: "SET_CLEAR_NEW_API_ACCESS_TOKEN",
      payload: false,
    });

    expect(next.basic.clearNewApiAccessToken).toBe(false);
    expect(next.basic.newApiAccessToken).toBe("");
  });

  it("更新用户 ID 输入", () => {
    const next = providerFormReducer(editState, { type: "SET_NEW_API_USER_ID", payload: "12" });

    expect(next.basic.newApiUserId).toBe("12");
  });
});
