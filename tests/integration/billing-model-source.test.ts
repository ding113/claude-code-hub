import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelPrice, ModelPriceData } from "@/types/model-price";
import type { SystemSettings } from "@/types/system-config";

const asyncTasks: Promise<void>[] = [];
const cloudPriceSyncRequests: Array<{ reason: string }> = [];

vi.mock("@/lib/async-task-manager", () => ({
  AsyncTaskManager: {
    register: (_taskId: string, promise: Promise<void>) => {
      asyncTasks.push(promise);
      return new AbortController();
    },
    cleanup: () => {},
    cancel: () => {},
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    trace: () => {},
  },
}));

vi.mock("@/lib/price-sync/cloud-price-updater", () => ({
  requestCloudPriceTableSync: (payload: { reason: string }) => {
    cloudPriceSyncRequests.push(payload);
  },
}));

vi.mock("@/repository/model-price", () => ({
  findLatestPriceByModel: vi.fn(),
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn(),
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestCostWithBreakdown: vi.fn(),
  updateMessageRequestDetails: vi.fn(),
  updateMessageRequestDuration: vi.fn(),
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    updateSessionUsage: vi.fn(),
    updateSessionProvider: vi.fn(),
    storeSessionResponse: vi.fn(),
    extractCodexPromptCacheKey: vi.fn(),
    updateSessionWithCodexCacheKey: vi.fn(),
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  RateLimitService: {
    trackCost: vi.fn(),
    trackUserDailyCost: vi.fn(),
  },
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    refreshSession: vi.fn(),
  },
}));

vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: {
    getInstance: () => ({
      endRequest: () => {},
    }),
  },
}));

import { ProxyResponseHandler } from "@/app/v1/_lib/proxy/response-handler";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import { getCachedSystemSettings, invalidateSystemSettingsCache } from "@/lib/config";
import { SessionManager } from "@/lib/session-manager";
import { RateLimitService } from "@/lib/rate-limit";
import { SessionTracker } from "@/lib/session-tracker";
import {
  updateMessageRequestCostWithBreakdown,
  updateMessageRequestDetails,
  updateMessageRequestDuration,
} from "@/repository/message";
import { findLatestPriceByModel } from "@/repository/model-price";
import { getSystemSettings } from "@/repository/system-config";

beforeEach(() => {
  vi.clearAllMocks();
  cloudPriceSyncRequests.splice(0, cloudPriceSyncRequests.length);
  invalidateSystemSettingsCache();
});

function makeSystemSettings(
  billingModelSource: SystemSettings["billingModelSource"],
  codexPriorityBillingSource: SystemSettings["codexPriorityBillingSource"] = "requested",
  enableHighConcurrencyMode: boolean = false
): SystemSettings {
  const now = new Date();
  return {
    id: 1,
    siteTitle: "test",
    allowGlobalUsageView: false,
    currencyDisplay: "USD",
    billingModelSource,
    codexPriorityBillingSource,
    timezone: null,
    enableAutoCleanup: false,
    cleanupRetentionDays: 30,
    cleanupSchedule: "0 2 * * *",
    cleanupBatchSize: 10000,
    enableClientVersionCheck: false,
    verboseProviderError: false,
    enableHttp2: false,
    enableHighConcurrencyMode,
    interceptAnthropicWarmupRequests: false,
    enableThinkingSignatureRectifier: true,
    enableThinkingBudgetRectifier: true,
    enableBillingHeaderRectifier: true,
    enableResponseInputRectifier: true,
    enableCodexSessionIdCompletion: true,
    enableClaudeMetadataUserIdInjection: true,
    enableResponseFixer: true,
    responseFixerConfig: {
      fixTruncatedJson: true,
      fixSseFormat: true,
      fixEncoding: true,
      maxJsonDepth: 200,
      maxFixSize: 1024 * 1024,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function makePriceRecord(
  modelName: string,
  priceData: ModelPriceData,
  source: ModelPrice["source"] = "litellm"
): ModelPrice {
  const now = new Date();
  return {
    id: 1,
    modelName,
    priceData,
    source,
    createdAt: now,
    updatedAt: now,
  };
}

function createSession({
  originalModel,
  redirectedModel,
  sessionId,
  messageId,
  enableHighConcurrencyMode = false,
  providerOverrides,
  requestMessage,
  requestPath = "/v1/messages",
  groupCostMultiplier,
}: {
  originalModel: string;
  redirectedModel: string;
  sessionId: string;
  messageId: number;
  enableHighConcurrencyMode?: boolean;
  providerOverrides?: Record<string, unknown>;
  requestMessage?: Record<string, unknown>;
  requestPath?: string;
  groupCostMultiplier?: number;
}): ProxySession {
  const session = new (
    ProxySession as unknown as {
      new (init: {
        startTime: number;
        method: string;
        requestUrl: URL;
        headers: Headers;
        headerLog: string;
        request: { message: Record<string, unknown>; log: string; model: string | null };
        userAgent: string | null;
        context: unknown;
        clientAbortSignal: AbortSignal | null;
      }): ProxySession;
    }
  )({
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL(`http://localhost${requestPath}`),
    headers: new Headers(),
    headerLog: "",
    request: { message: requestMessage ?? {}, log: "(test)", model: redirectedModel },
    userAgent: null,
    context: {},
    clientAbortSignal: null,
  });

  session.setOriginalModel(originalModel);
  session.setSessionId(sessionId);
  session.setHighConcurrencyModeEnabled(enableHighConcurrencyMode);
  if (groupCostMultiplier !== undefined) {
    session.setGroupCostMultiplier(groupCostMultiplier);
  }

  const provider = {
    id: 99,
    name: "test-provider",
    url: "https://api.anthropic.com",
    providerType: "claude",
    costMultiplier: 1.0,
    streamingIdleTimeoutMs: 0,
    ...providerOverrides,
  } as any;

  const user = {
    id: 123,
    name: "test-user",
    dailyResetTime: "00:00",
    dailyResetMode: "fixed",
  } as any;

  const key = {
    id: 456,
    name: "test-key",
    dailyResetTime: "00:00",
    dailyResetMode: "fixed",
  } as any;

  session.setProvider(provider);
  session.setAuthState({
    user,
    key,
    apiKey: "sk-test",
    success: true,
  });
  session.setMessageContext({
    id: messageId,
    createdAt: new Date(),
    user,
    key,
    apiKey: "sk-test",
  });

  return session;
}

function createNonStreamResponse(
  usage: { input_tokens: number; output_tokens: number },
  extras?: Record<string, unknown>
): Response {
  return new Response(
    JSON.stringify({
      type: "message",
      usage,
      ...(extras ?? {}),
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

function createImageEditResponseWithoutUsage(): Response {
  return new Response(
    JSON.stringify({
      created: 1_776_729_600,
      data: [{ b64_json: "test-image-bytes" }],
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

function createStreamResponse(usage: { input_tokens: number; output_tokens: number }): Response {
  const sseText = `event: message_delta\ndata: ${JSON.stringify({ usage })}\n\n`;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sseText));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function drainAsyncTasks(): Promise<void> {
  const tasks = asyncTasks.splice(0, asyncTasks.length);
  await Promise.all(tasks);
}

function captureRateLimitCosts(): number[] {
  const rateLimitCosts: number[] = [];
  vi.mocked(RateLimitService.trackCost).mockImplementation(
    async (_keyId: number, _providerId: number, _sessionId: string, costUsd: number) => {
      rateLimitCosts.push(costUsd);
    }
  );
  return rateLimitCosts;
}

async function runScenario({
  billingModelSource,
  isStream,
  enableHighConcurrencyMode = false,
}: {
  billingModelSource: SystemSettings["billingModelSource"];
  isStream: boolean;
  enableHighConcurrencyMode?: boolean;
}): Promise<{ dbCostUsd: string; sessionCostUsd: string; rateLimitCost: number }> {
  invalidateSystemSettingsCache();

  const usage = { input_tokens: 2, output_tokens: 3 };
  const originalModel = "original-model";
  const redirectedModel = "redirected-model";

  const originalPriceData: ModelPriceData = { input_cost_per_token: 1, output_cost_per_token: 1 };
  const redirectedPriceData: ModelPriceData = {
    input_cost_per_token: 10,
    output_cost_per_token: 10,
  };

  vi.mocked(getSystemSettings).mockResolvedValue(
    makeSystemSettings(billingModelSource, "requested", enableHighConcurrencyMode)
  );
  vi.mocked(findLatestPriceByModel).mockImplementation(async (modelName: string) => {
    if (modelName === originalModel) {
      return makePriceRecord(modelName, originalPriceData);
    }
    if (modelName === redirectedModel) {
      return makePriceRecord(modelName, redirectedPriceData);
    }
    return null;
  });

  vi.mocked(updateMessageRequestDetails).mockResolvedValue(undefined);
  vi.mocked(updateMessageRequestDuration).mockResolvedValue(undefined);
  vi.mocked(SessionManager.storeSessionResponse).mockResolvedValue(undefined);
  vi.mocked(RateLimitService.trackUserDailyCost).mockResolvedValue(undefined);
  vi.mocked(SessionTracker.refreshSession).mockResolvedValue(undefined);

  const dbCosts: string[] = [];
  vi.mocked(updateMessageRequestCostWithBreakdown).mockImplementation(
    async (_id: number, costUsd: unknown) => {
      dbCosts.push(String(costUsd));
    }
  );

  const sessionCosts: string[] = [];
  vi.mocked(SessionManager.updateSessionUsage).mockImplementation(
    async (_sessionId: string, payload: Record<string, unknown>) => {
      if (typeof payload.costUsd === "string") {
        sessionCosts.push(payload.costUsd);
      }
    }
  );

  const rateLimitCosts: number[] = [];
  vi.mocked(RateLimitService.trackCost).mockImplementation(
    async (_keyId: number, _providerId: number, _sessionId: string, costUsd: number) => {
      rateLimitCosts.push(costUsd);
    }
  );

  const session = createSession({
    originalModel,
    redirectedModel,
    sessionId: `sess-${billingModelSource}-${isStream ? "s" : "n"}`,
    messageId: isStream ? 2001 : 2000,
    enableHighConcurrencyMode,
  });

  const response = isStream ? createStreamResponse(usage) : createNonStreamResponse(usage);
  const clientResponse = await ProxyResponseHandler.dispatch(session, response);

  if (isStream) {
    await clientResponse.text();
  }

  await drainAsyncTasks();

  const dbCostUsd = dbCosts[0] ?? "";
  const sessionCostUsd = sessionCosts[0] ?? "";
  const rateLimitCost = rateLimitCosts[0] ?? Number.NaN;

  return { dbCostUsd, sessionCostUsd, rateLimitCost };
}

describe("Billing model source - Redis session cost vs DB cost", () => {
  it("非流式响应：配置 = original 时 Session 成本与数据库一致", async () => {
    const result = await runScenario({ billingModelSource: "original", isStream: false });

    expect(result.dbCostUsd).toBe("5");
    expect(result.sessionCostUsd).toBe("5");
    expect(result.rateLimitCost).toBe(5);
  });

  it("非流式响应：配置 = redirected 时 Session 成本与数据库一致", async () => {
    const result = await runScenario({ billingModelSource: "redirected", isStream: false });

    expect(result.dbCostUsd).toBe("50");
    expect(result.sessionCostUsd).toBe("50");
    expect(result.rateLimitCost).toBe(50);
  });

  it("流式响应：配置 = original 时 Session 成本与数据库一致", async () => {
    const result = await runScenario({ billingModelSource: "original", isStream: true });

    expect(result.dbCostUsd).toBe("5");
    expect(result.sessionCostUsd).toBe("5");
    expect(result.rateLimitCost).toBe(5);
  });

  it("流式响应：配置 = redirected 时 Session 成本与数据库一致", async () => {
    const result = await runScenario({ billingModelSource: "redirected", isStream: true });

    expect(result.dbCostUsd).toBe("50");
    expect(result.sessionCostUsd).toBe("50");
    expect(result.rateLimitCost).toBe(50);
  });

  it("从 original 切换到 redirected 后应生效", async () => {
    const original = await runScenario({ billingModelSource: "original", isStream: false });
    const redirected = await runScenario({ billingModelSource: "redirected", isStream: false });

    expect(original.sessionCostUsd).toBe("5");
    expect(redirected.sessionCostUsd).toBe("50");
    expect(original.sessionCostUsd).not.toBe(redirected.sessionCostUsd);
  });

  it("高并发模式：仍更新 DB cost 与限流 cost，但跳过 session usage / session refresh 观测写入", async () => {
    const result = await runScenario({
      billingModelSource: "redirected",
      enableHighConcurrencyMode: true,
      isStream: false,
    });

    expect(result.dbCostUsd).toBe("50");
    expect(result.rateLimitCost).toBe(50);
    expect(result.sessionCostUsd).toBe("");
    expect(vi.mocked(SessionManager.storeSessionResponse)).not.toHaveBeenCalled();
    expect(vi.mocked(SessionManager.updateSessionUsage)).not.toHaveBeenCalled();
    expect(vi.mocked(SessionTracker.refreshSession)).not.toHaveBeenCalled();
  });

  it("高并发模式：流式成功收尾时不应更新 session provider 观测信息", async () => {
    const result = await runScenario({
      billingModelSource: "redirected",
      enableHighConcurrencyMode: true,
      isStream: true,
    });

    expect(result.dbCostUsd).toBe("50");
    expect(result.rateLimitCost).toBe(50);
    expect(vi.mocked(SessionManager.updateSessionProvider)).not.toHaveBeenCalled();
  });

  it("nested pricing: gpt-5.4 alias model should bill from pricing.openai when provider is chatgpt", async () => {
    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("redirected"));
    vi.mocked(updateMessageRequestDetails).mockResolvedValue(undefined);
    vi.mocked(updateMessageRequestDuration).mockResolvedValue(undefined);
    vi.mocked(SessionManager.storeSessionResponse).mockResolvedValue(undefined);
    vi.mocked(RateLimitService.trackUserDailyCost).mockResolvedValue(undefined);
    vi.mocked(SessionTracker.refreshSession).mockResolvedValue(undefined);

    vi.mocked(findLatestPriceByModel).mockImplementation(async (modelName: string) => {
      if (modelName === "gpt-5.4") {
        return makePriceRecord(modelName, {
          mode: "responses",
          model_family: "gpt",
          litellm_provider: "chatgpt",
          pricing: {
            openai: {
              input_cost_per_token: 2.5,
              output_cost_per_token: 15,
            },
          },
        });
      }
      return null;
    });

    const dbCosts: string[] = [];
    vi.mocked(updateMessageRequestCostWithBreakdown).mockImplementation(
      async (_id: number, costUsd: unknown) => {
        dbCosts.push(String(costUsd));
      }
    );
    const rateLimitCosts = captureRateLimitCosts();

    const sessionCosts: string[] = [];
    vi.mocked(SessionManager.updateSessionUsage).mockImplementation(
      async (_sessionId: string, payload: Record<string, unknown>) => {
        if (typeof payload.costUsd === "string") {
          sessionCosts.push(payload.costUsd);
        }
      }
    );

    const session = createSession({
      originalModel: "gpt-5.4",
      redirectedModel: "gpt-5.4",
      sessionId: "sess-gpt54-chatgpt",
      messageId: 3100,
      providerOverrides: {
        name: "ChatGPT",
        url: "https://chatgpt.com/backend-api/codex",
        providerType: "codex",
      },
    });

    const response = createNonStreamResponse({ input_tokens: 2, output_tokens: 3 });
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(dbCosts[0]).toBe("50");
    expect(sessionCosts[0]).toBe("50");
  });

  it("codex fast: requested mode ignores actual priority when request tier is default", async () => {
    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("redirected"));
    vi.mocked(updateMessageRequestDetails).mockResolvedValue(undefined);
    vi.mocked(updateMessageRequestDuration).mockResolvedValue(undefined);
    vi.mocked(SessionManager.storeSessionResponse).mockResolvedValue(undefined);
    vi.mocked(RateLimitService.trackUserDailyCost).mockResolvedValue(undefined);
    vi.mocked(SessionTracker.refreshSession).mockResolvedValue(undefined);

    vi.mocked(findLatestPriceByModel).mockImplementation(async (modelName: string) => {
      if (modelName === "gpt-5.4") {
        return makePriceRecord(modelName, {
          mode: "responses",
          model_family: "gpt",
          litellm_provider: "chatgpt",
          pricing: {
            openai: {
              input_cost_per_token: 1,
              output_cost_per_token: 10,
              input_cost_per_token_priority: 2,
              output_cost_per_token_priority: 20,
            },
          },
        });
      }
      return null;
    });

    const dbCosts: string[] = [];
    vi.mocked(updateMessageRequestCostWithBreakdown).mockImplementation(
      async (_id: number, costUsd: unknown) => {
        dbCosts.push(String(costUsd));
      }
    );
    const rateLimitCosts = captureRateLimitCosts();

    const sessionCosts: string[] = [];
    vi.mocked(SessionManager.updateSessionUsage).mockImplementation(
      async (_sessionId: string, payload: Record<string, unknown>) => {
        if (typeof payload.costUsd === "string") {
          sessionCosts.push(payload.costUsd);
        }
      }
    );

    const session = createSession({
      originalModel: "gpt-5.4",
      redirectedModel: "gpt-5.4",
      sessionId: "sess-gpt54-priority-actual",
      messageId: 3200,
      providerOverrides: {
        name: "ChatGPT",
        url: "https://chatgpt.com/backend-api/codex",
        providerType: "codex",
      },
      requestMessage: { service_tier: "default" },
    });

    const response = createNonStreamResponse(
      { input_tokens: 2, output_tokens: 3 },
      { service_tier: "priority" }
    );
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(dbCosts[0]).toBe("32");
    expect(sessionCosts[0]).toBe("32");
    expect(rateLimitCosts[0]).toBe(32);
  });

  it("codex fast: falls back to requested priority pricing when response omits service_tier", async () => {
    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("redirected"));
    vi.mocked(updateMessageRequestDetails).mockResolvedValue(undefined);
    vi.mocked(updateMessageRequestDuration).mockResolvedValue(undefined);
    vi.mocked(SessionManager.storeSessionResponse).mockResolvedValue(undefined);
    vi.mocked(RateLimitService.trackUserDailyCost).mockResolvedValue(undefined);
    vi.mocked(SessionTracker.refreshSession).mockResolvedValue(undefined);

    vi.mocked(findLatestPriceByModel).mockImplementation(async (modelName: string) => {
      if (modelName === "gpt-5.4") {
        return makePriceRecord(modelName, {
          mode: "responses",
          model_family: "gpt",
          litellm_provider: "chatgpt",
          pricing: {
            openai: {
              input_cost_per_token: 1,
              output_cost_per_token: 10,
              input_cost_per_token_priority: 2,
              output_cost_per_token_priority: 20,
            },
          },
        });
      }
      return null;
    });

    const dbCosts: string[] = [];
    vi.mocked(updateMessageRequestCostWithBreakdown).mockImplementation(
      async (_id: number, costUsd: unknown) => {
        dbCosts.push(String(costUsd));
      }
    );
    const rateLimitCosts = captureRateLimitCosts();

    const session = createSession({
      originalModel: "gpt-5.4",
      redirectedModel: "gpt-5.4",
      sessionId: "sess-gpt54-priority-requested",
      messageId: 3201,
      providerOverrides: {
        name: "ChatGPT",
        url: "https://chatgpt.com/backend-api/codex",
        providerType: "codex",
      },
      requestMessage: { service_tier: "priority" },
    });

    const response = createNonStreamResponse({ input_tokens: 2, output_tokens: 3 });
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(dbCosts[0]).toBe("64");
    expect(rateLimitCosts[0]).toBe(64);
  });

  it("codex fast: uses long-context priority pricing when request is priority and response omits service_tier", async () => {
    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("redirected"));
    vi.mocked(updateMessageRequestDetails).mockResolvedValue(undefined);
    vi.mocked(updateMessageRequestDuration).mockResolvedValue(undefined);
    vi.mocked(SessionManager.storeSessionResponse).mockResolvedValue(undefined);
    vi.mocked(RateLimitService.trackUserDailyCost).mockResolvedValue(undefined);
    vi.mocked(SessionTracker.refreshSession).mockResolvedValue(undefined);

    vi.mocked(findLatestPriceByModel).mockImplementation(async (modelName: string) => {
      if (modelName === "gpt-5.4") {
        return makePriceRecord(modelName, {
          mode: "responses",
          model_family: "gpt",
          litellm_provider: "chatgpt",
          pricing: {
            openai: {
              input_cost_per_token: 1,
              output_cost_per_token: 10,
              input_cost_per_token_priority: 2,
              output_cost_per_token_priority: 20,
              input_cost_per_token_above_272k_tokens: 5,
              output_cost_per_token_above_272k_tokens: 50,
              input_cost_per_token_above_272k_tokens_priority: 7,
              output_cost_per_token_above_272k_tokens_priority: 70,
            },
          },
        });
      }
      return null;
    });

    const dbCosts: string[] = [];
    vi.mocked(updateMessageRequestCostWithBreakdown).mockImplementation(
      async (_id: number, costUsd: unknown) => {
        dbCosts.push(String(costUsd));
      }
    );
    const rateLimitCosts = captureRateLimitCosts();

    const sessionCosts: string[] = [];
    vi.mocked(SessionManager.updateSessionUsage).mockImplementation(
      async (_sessionId: string, payload: Record<string, unknown>) => {
        if (typeof payload.costUsd === "string") {
          sessionCosts.push(payload.costUsd);
        }
      }
    );

    const session = createSession({
      originalModel: "gpt-5.4",
      redirectedModel: "gpt-5.4",
      sessionId: "sess-gpt54-priority-requested-long-context",
      messageId: 3203,
      providerOverrides: {
        name: "ChatGPT",
        url: "https://chatgpt.com/backend-api/codex",
        providerType: "codex",
      },
      requestMessage: { service_tier: "priority" },
    });

    const response = createNonStreamResponse({ input_tokens: 272001, output_tokens: 2 });
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(dbCosts[0]).toBe("1904147");
    expect(sessionCosts[0]).toBe("1904147");
    expect(rateLimitCosts[0]).toBe(1904147);
  });

  it("codex fast: requested mode keeps priority pricing even when actual tier is downgraded", async () => {
    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("redirected"));
    vi.mocked(updateMessageRequestDetails).mockResolvedValue(undefined);
    vi.mocked(updateMessageRequestDuration).mockResolvedValue(undefined);
    vi.mocked(SessionManager.storeSessionResponse).mockResolvedValue(undefined);
    vi.mocked(RateLimitService.trackUserDailyCost).mockResolvedValue(undefined);
    vi.mocked(SessionTracker.refreshSession).mockResolvedValue(undefined);

    vi.mocked(findLatestPriceByModel).mockImplementation(async (modelName: string) => {
      if (modelName === "gpt-5.4") {
        return makePriceRecord(modelName, {
          mode: "responses",
          model_family: "gpt",
          litellm_provider: "chatgpt",
          pricing: {
            openai: {
              input_cost_per_token: 1,
              output_cost_per_token: 10,
              input_cost_per_token_priority: 2,
              output_cost_per_token_priority: 20,
            },
          },
        });
      }
      return null;
    });

    const dbCosts: string[] = [];
    vi.mocked(updateMessageRequestCostWithBreakdown).mockImplementation(
      async (_id: number, costUsd: unknown) => {
        dbCosts.push(String(costUsd));
      }
    );
    const rateLimitCosts = captureRateLimitCosts();

    const session = createSession({
      originalModel: "gpt-5.4",
      redirectedModel: "gpt-5.4",
      sessionId: "sess-gpt54-priority-downgraded",
      messageId: 3202,
      providerOverrides: {
        name: "ChatGPT",
        url: "https://chatgpt.com/backend-api/codex",
        providerType: "codex",
      },
      requestMessage: { service_tier: "priority" },
    });

    const response = createNonStreamResponse(
      { input_tokens: 2, output_tokens: 3 },
      { service_tier: "default" }
    );
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(dbCosts[0]).toBe("64");
    expect(rateLimitCosts[0]).toBe(64);
  });

  it("codex fast: actual mode uses priority pricing when response reports service_tier=priority", async () => {
    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("redirected", "actual"));
    vi.mocked(updateMessageRequestDetails).mockResolvedValue(undefined);
    vi.mocked(updateMessageRequestDuration).mockResolvedValue(undefined);
    vi.mocked(SessionManager.storeSessionResponse).mockResolvedValue(undefined);
    vi.mocked(RateLimitService.trackUserDailyCost).mockResolvedValue(undefined);
    vi.mocked(SessionTracker.refreshSession).mockResolvedValue(undefined);

    vi.mocked(findLatestPriceByModel).mockImplementation(async (modelName: string) => {
      if (modelName === "gpt-5.4") {
        return makePriceRecord(modelName, {
          mode: "responses",
          model_family: "gpt",
          litellm_provider: "chatgpt",
          pricing: {
            openai: {
              input_cost_per_token: 1,
              output_cost_per_token: 10,
              input_cost_per_token_priority: 2,
              output_cost_per_token_priority: 20,
            },
          },
        });
      }
      return null;
    });

    const dbCosts: string[] = [];
    vi.mocked(updateMessageRequestCostWithBreakdown).mockImplementation(
      async (_id: number, costUsd: unknown) => {
        dbCosts.push(String(costUsd));
      }
    );
    const rateLimitCosts = captureRateLimitCosts();

    const session = createSession({
      originalModel: "gpt-5.4",
      redirectedModel: "gpt-5.4",
      sessionId: "sess-gpt54-priority-actual-mode-upgrade",
      messageId: 3204,
      providerOverrides: {
        name: "ChatGPT",
        url: "https://chatgpt.com/backend-api/codex",
        providerType: "codex",
      },
      requestMessage: { service_tier: "default" },
    });

    const response = createNonStreamResponse(
      { input_tokens: 2, output_tokens: 3 },
      { service_tier: "priority" }
    );
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(dbCosts[0]).toBe("64");
    expect(rateLimitCosts[0]).toBe(64);
  });

  it("codex fast: actual mode does not use priority pricing when response explicitly reports non-priority tier", async () => {
    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("redirected", "actual"));
    vi.mocked(updateMessageRequestDetails).mockResolvedValue(undefined);
    vi.mocked(updateMessageRequestDuration).mockResolvedValue(undefined);
    vi.mocked(SessionManager.storeSessionResponse).mockResolvedValue(undefined);
    vi.mocked(RateLimitService.trackUserDailyCost).mockResolvedValue(undefined);
    vi.mocked(SessionTracker.refreshSession).mockResolvedValue(undefined);

    vi.mocked(findLatestPriceByModel).mockImplementation(async (modelName: string) => {
      if (modelName === "gpt-5.4") {
        return makePriceRecord(modelName, {
          mode: "responses",
          model_family: "gpt",
          litellm_provider: "chatgpt",
          pricing: {
            openai: {
              input_cost_per_token: 1,
              output_cost_per_token: 10,
              input_cost_per_token_priority: 2,
              output_cost_per_token_priority: 20,
            },
          },
        });
      }
      return null;
    });

    const dbCosts: string[] = [];
    vi.mocked(updateMessageRequestCostWithBreakdown).mockImplementation(
      async (_id: number, costUsd: unknown) => {
        dbCosts.push(String(costUsd));
      }
    );
    const rateLimitCosts = captureRateLimitCosts();

    const session = createSession({
      originalModel: "gpt-5.4",
      redirectedModel: "gpt-5.4",
      sessionId: "sess-gpt54-priority-actual-mode-downgrade",
      messageId: 3205,
      providerOverrides: {
        name: "ChatGPT",
        url: "https://chatgpt.com/backend-api/codex",
        providerType: "codex",
      },
      requestMessage: { service_tier: "priority" },
    });

    const response = createNonStreamResponse(
      { input_tokens: 2, output_tokens: 3 },
      { service_tier: "default" }
    );
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(dbCosts[0]).toBe("32");
    expect(rateLimitCosts[0]).toBe(32);
  });

  it("codex fast: actual mode falls back to requested priority pricing when response omits service_tier", async () => {
    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("redirected", "actual"));
    vi.mocked(updateMessageRequestDetails).mockResolvedValue(undefined);
    vi.mocked(updateMessageRequestDuration).mockResolvedValue(undefined);
    vi.mocked(SessionManager.storeSessionResponse).mockResolvedValue(undefined);
    vi.mocked(RateLimitService.trackUserDailyCost).mockResolvedValue(undefined);
    vi.mocked(SessionTracker.refreshSession).mockResolvedValue(undefined);

    vi.mocked(findLatestPriceByModel).mockImplementation(async (modelName: string) => {
      if (modelName === "gpt-5.4") {
        return makePriceRecord(modelName, {
          mode: "responses",
          model_family: "gpt",
          litellm_provider: "chatgpt",
          pricing: {
            openai: {
              input_cost_per_token: 1,
              output_cost_per_token: 10,
              input_cost_per_token_priority: 2,
              output_cost_per_token_priority: 20,
            },
          },
        });
      }
      return null;
    });

    const dbCosts: string[] = [];
    vi.mocked(updateMessageRequestCostWithBreakdown).mockImplementation(
      async (_id: number, costUsd: unknown) => {
        dbCosts.push(String(costUsd));
      }
    );
    const rateLimitCosts = captureRateLimitCosts();

    const session = createSession({
      originalModel: "gpt-5.4",
      redirectedModel: "gpt-5.4",
      sessionId: "sess-gpt54-priority-actual-mode-fallback",
      messageId: 3206,
      providerOverrides: {
        name: "ChatGPT",
        url: "https://chatgpt.com/backend-api/codex",
        providerType: "codex",
      },
      requestMessage: { service_tier: "priority" },
    });

    const response = createNonStreamResponse({ input_tokens: 2, output_tokens: 3 });
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(dbCosts[0]).toBe("64");
    expect(rateLimitCosts[0]).toBe(64);
  });

  it("codex fast: actual mode reuses cached system setting when direct settings read fails", async () => {
    vi.mocked(getSystemSettings).mockResolvedValueOnce(makeSystemSettings("redirected", "actual"));
    await getCachedSystemSettings();

    vi.mocked(getSystemSettings).mockRejectedValueOnce(new Error("db down"));
    vi.mocked(updateMessageRequestDetails).mockResolvedValue(undefined);
    vi.mocked(updateMessageRequestDuration).mockResolvedValue(undefined);
    vi.mocked(SessionManager.storeSessionResponse).mockResolvedValue(undefined);
    vi.mocked(RateLimitService.trackUserDailyCost).mockResolvedValue(undefined);
    vi.mocked(SessionTracker.refreshSession).mockResolvedValue(undefined);

    vi.mocked(findLatestPriceByModel).mockImplementation(async (modelName: string) => {
      if (modelName === "gpt-5.4") {
        return makePriceRecord(modelName, {
          mode: "responses",
          model_family: "gpt",
          litellm_provider: "chatgpt",
          pricing: {
            openai: {
              input_cost_per_token: 1,
              output_cost_per_token: 10,
              input_cost_per_token_priority: 2,
              output_cost_per_token_priority: 20,
            },
          },
        });
      }
      return null;
    });

    const dbCosts: string[] = [];
    vi.mocked(updateMessageRequestCostWithBreakdown).mockImplementation(
      async (_id: number, costUsd: unknown) => {
        dbCosts.push(String(costUsd));
      }
    );
    const rateLimitCosts = captureRateLimitCosts();

    const session = createSession({
      originalModel: "gpt-5.4",
      redirectedModel: "gpt-5.4",
      sessionId: "sess-gpt54-priority-actual-mode-cached-settings",
      messageId: 3207,
      providerOverrides: {
        name: "ChatGPT",
        url: "https://chatgpt.com/backend-api/codex",
        providerType: "codex",
      },
      requestMessage: { service_tier: "priority" },
    });

    const response = createNonStreamResponse(
      { input_tokens: 2, output_tokens: 3 },
      { service_tier: "default" }
    );
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(dbCosts[0]).toBe("32");
    expect(rateLimitCosts[0]).toBe(32);
  });
});

describe("模型重定向后的图片按次计费", () => {
  async function runImageEditPerRequestScenario(
    billingModelSource: SystemSettings["billingModelSource"]
  ): Promise<{
    dbCostUsd: string;
    storedBreakdown: Record<string, unknown> | undefined;
    sessionCostUsd: string;
    rateLimitCost: number;
  }> {
    invalidateSystemSettingsCache();

    const originalModel = "gpt-image-2";
    const redirectedModel = "gpt-image-2-all";
    const providerMultiplier = 2;
    const groupCostMultiplier = 3;

    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings(billingModelSource));
    vi.mocked(findLatestPriceByModel).mockImplementation(async (modelName: string) => {
      if (modelName === originalModel) {
        return makePriceRecord(modelName, { input_cost_per_request: 0.01 }, "manual");
      }
      if (modelName === redirectedModel) {
        return makePriceRecord(modelName, { input_cost_per_request: 0.02 }, "manual");
      }
      return null;
    });

    vi.mocked(updateMessageRequestDetails).mockResolvedValue(undefined);
    vi.mocked(updateMessageRequestDuration).mockResolvedValue(undefined);
    vi.mocked(SessionManager.storeSessionResponse).mockResolvedValue(undefined);
    vi.mocked(RateLimitService.trackUserDailyCost).mockResolvedValue(undefined);
    vi.mocked(SessionTracker.refreshSession).mockResolvedValue(undefined);

    const dbCosts: string[] = [];
    let storedBreakdown: Record<string, unknown> | undefined;
    vi.mocked(updateMessageRequestCostWithBreakdown).mockImplementation(
      async (_id: number, costUsd: unknown, breakdown?: Record<string, unknown>) => {
        dbCosts.push(String(costUsd));
        storedBreakdown = breakdown;
      }
    );

    const sessionCosts: string[] = [];
    vi.mocked(SessionManager.updateSessionUsage).mockImplementation(
      async (_sessionId: string, payload: Record<string, unknown>) => {
        if (typeof payload.costUsd === "string") {
          sessionCosts.push(payload.costUsd);
        }
      }
    );

    const rateLimitCosts: number[] = [];
    vi.mocked(RateLimitService.trackCost).mockImplementation(
      async (_keyId: number, _providerId: number, _sessionId: string, costUsd: number) => {
        rateLimitCosts.push(costUsd);
      }
    );

    const session = createSession({
      originalModel,
      redirectedModel,
      sessionId: `sess-image-edit-${billingModelSource}`,
      messageId: billingModelSource === "original" ? 4000 : 4001,
      requestPath: "/v1/images/edits",
      providerOverrides: {
        providerType: "openai",
        url: "https://api.openai.com/v1",
        costMultiplier: providerMultiplier,
      },
      groupCostMultiplier,
    });

    const clientResponse = await ProxyResponseHandler.dispatch(
      session,
      createImageEditResponseWithoutUsage()
    );
    await clientResponse.text();
    await drainAsyncTasks();

    return {
      dbCostUsd: dbCosts[0] ?? "",
      storedBreakdown,
      sessionCostUsd: sessionCosts[0] ?? "",
      rateLimitCost: rateLimitCosts[0] ?? Number.NaN,
    };
  }

  it("配置 = original 时命中重定向前模型的本地按次价格并应用倍率", async () => {
    const result = await runImageEditPerRequestScenario("original");

    expect(result.dbCostUsd).toBe("0.06");
    expect(result.sessionCostUsd).toBe("0.06");
    expect(result.rateLimitCost).toBe(0.06);
    expect(result.storedBreakdown).toMatchObject({
      input: "0.01",
      base_total: "0.01",
      provider_multiplier: 2,
      group_multiplier: 3,
      total: "0.06",
    });
  });

  it("配置 = redirected 时命中重定向后模型的本地按次价格并应用倍率", async () => {
    const result = await runImageEditPerRequestScenario("redirected");

    expect(result.dbCostUsd).toBe("0.12");
    expect(result.sessionCostUsd).toBe("0.12");
    expect(result.rateLimitCost).toBe(0.12);
    expect(result.storedBreakdown).toMatchObject({
      input: "0.02",
      base_total: "0.02",
      provider_multiplier: 2,
      group_multiplier: 3,
      total: "0.12",
    });
  });
});

describe("价格表缺失/查询失败：不计费放行", () => {
  async function runNoPriceScenario(options: {
    billingModelSource: SystemSettings["billingModelSource"];
    isStream: boolean;
    priceLookup: "none" | "throws";
  }): Promise<{ dbCostCalls: number; rateLimitCalls: number }> {
    const usage = { input_tokens: 2, output_tokens: 3 };
    const originalModel = "original-model";
    const redirectedModel = "redirected-model";

    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings(options.billingModelSource));
    if (options.priceLookup === "none") {
      vi.mocked(findLatestPriceByModel).mockResolvedValue(null);
    } else {
      vi.mocked(findLatestPriceByModel).mockImplementation(async () => {
        throw new Error("db query failed");
      });
    }

    vi.mocked(updateMessageRequestDetails).mockResolvedValue(undefined);
    vi.mocked(updateMessageRequestDuration).mockResolvedValue(undefined);
    vi.mocked(SessionManager.storeSessionResponse).mockResolvedValue(undefined);
    vi.mocked(RateLimitService.trackUserDailyCost).mockResolvedValue(undefined);
    vi.mocked(SessionTracker.refreshSession).mockResolvedValue(undefined);

    vi.mocked(updateMessageRequestCostWithBreakdown).mockResolvedValue(undefined);
    vi.mocked(RateLimitService.trackCost).mockResolvedValue(undefined);
    vi.mocked(SessionManager.updateSessionUsage).mockResolvedValue(undefined);

    const session = createSession({
      originalModel,
      redirectedModel,
      sessionId: `sess-no-price-${options.billingModelSource}-${options.isStream ? "s" : "n"}`,
      messageId: options.isStream ? 3001 : 3000,
    });

    const response = options.isStream
      ? createStreamResponse(usage)
      : createNonStreamResponse(usage);
    const clientResponse = await ProxyResponseHandler.dispatch(session, response);
    await clientResponse.text();

    await drainAsyncTasks();

    return {
      dbCostCalls: vi.mocked(updateMessageRequestCostWithBreakdown).mock.calls.length,
      rateLimitCalls: vi.mocked(RateLimitService.trackCost).mock.calls.length,
    };
  }

  it("无价格：不写入 DB cost，不追踪限流 cost，并触发一次异步同步", async () => {
    const result = await runNoPriceScenario({
      billingModelSource: "redirected",
      isStream: false,
      priceLookup: "none",
    });

    expect(result.dbCostCalls).toBe(0);
    expect(result.rateLimitCalls).toBe(0);
    expect(cloudPriceSyncRequests).toEqual([{ reason: "missing-model" }]);
  });

  it("价格查询抛错：不应影响响应，不写入 DB cost，不追踪限流 cost", async () => {
    const result = await runNoPriceScenario({
      billingModelSource: "original",
      isStream: true,
      priceLookup: "throws",
    });

    expect(result.dbCostCalls).toBe(0);
    expect(result.rateLimitCalls).toBe(0);
  });
});
