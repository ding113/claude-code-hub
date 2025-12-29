import { describe, expect, it, vi } from "vitest";
import type { ModelPrice, ModelPriceData } from "@/types/model-price";
import type { SystemSettings } from "@/types/system-config";

const asyncTasks: Promise<void>[] = [];

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

vi.mock("@/repository/model-price", () => ({
  findLatestPriceByModel: vi.fn(),
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn(),
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestCost: vi.fn(),
  updateMessageRequestDetails: vi.fn(),
  updateMessageRequestDuration: vi.fn(),
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    updateSessionUsage: vi.fn(),
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
import { SessionManager } from "@/lib/session-manager";
import { RateLimitService } from "@/lib/rate-limit";
import { SessionTracker } from "@/lib/session-tracker";
import {
  updateMessageRequestCost,
  updateMessageRequestDetails,
  updateMessageRequestDuration,
} from "@/repository/message";
import { findLatestPriceByModel } from "@/repository/model-price";
import { getSystemSettings } from "@/repository/system-config";

function makeSystemSettings(
  billingModelSource: SystemSettings["billingModelSource"]
): SystemSettings {
  const now = new Date();
  return {
    id: 1,
    siteTitle: "test",
    allowGlobalUsageView: false,
    currencyDisplay: "USD",
    billingModelSource,
    enableAutoCleanup: false,
    cleanupRetentionDays: 30,
    cleanupSchedule: "0 2 * * *",
    cleanupBatchSize: 10000,
    enableClientVersionCheck: false,
    verboseProviderError: false,
    enableHttp2: false,
    createdAt: now,
    updatedAt: now,
  };
}

function makePriceRecord(modelName: string, priceData: ModelPriceData): ModelPrice {
  const now = new Date();
  return {
    id: 1,
    modelName,
    priceData,
    createdAt: now,
    updatedAt: now,
  };
}

function createSession({
  originalModel,
  redirectedModel,
  sessionId,
  messageId,
}: {
  originalModel: string;
  redirectedModel: string;
  sessionId: string;
  messageId: number;
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
    requestUrl: new URL("http://localhost/v1/messages"),
    headers: new Headers(),
    headerLog: "",
    request: { message: {}, log: "(test)", model: redirectedModel },
    userAgent: null,
    context: {},
    clientAbortSignal: null,
  });

  session.setOriginalModel(originalModel);
  session.setSessionId(sessionId);

  const provider = {
    id: 99,
    name: "test-provider",
    providerType: "claude",
    costMultiplier: 1.0,
    streamingIdleTimeoutMs: 0,
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

function createNonStreamResponse(usage: { input_tokens: number; output_tokens: number }): Response {
  return new Response(
    JSON.stringify({
      type: "message",
      usage,
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

async function runScenario({
  billingModelSource,
  isStream,
}: {
  billingModelSource: SystemSettings["billingModelSource"];
  isStream: boolean;
}): Promise<{ dbCostUsd: string; sessionCostUsd: string; rateLimitCost: number }> {
  const usage = { input_tokens: 2, output_tokens: 3 };
  const originalModel = "original-model";
  const redirectedModel = "redirected-model";

  const originalPriceData: ModelPriceData = { input_cost_per_token: 1, output_cost_per_token: 1 };
  const redirectedPriceData: ModelPriceData = {
    input_cost_per_token: 10,
    output_cost_per_token: 10,
  };

  vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings(billingModelSource));
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
  vi.mocked(updateMessageRequestCost).mockImplementation(async (_id: number, costUsd: unknown) => {
    dbCosts.push(String(costUsd));
  });

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
});
