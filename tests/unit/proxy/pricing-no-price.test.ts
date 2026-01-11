import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemSettings } from "@/types/system-config";

const { cloudSyncRequests, requestCloudPriceTableSyncMock } = vi.hoisted(() => {
  const cloudSyncRequests: Array<{ reason: string }> = [];
  const requestCloudPriceTableSyncMock = vi.fn((payload: { reason: string }) => {
    cloudSyncRequests.push(payload);
  });
  return { cloudSyncRequests, requestCloudPriceTableSyncMock };
});

vi.mock("@/lib/price-sync/cloud-price-updater", () => ({
  requestCloudPriceTableSync: requestCloudPriceTableSyncMock,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
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
    updateSessionUsage: vi.fn(async () => {}),
    storeSessionResponse: vi.fn(async () => {}),
    extractCodexPromptCacheKey: vi.fn(),
    updateSessionWithCodexCacheKey: vi.fn(async () => {}),
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  RateLimitService: {
    trackCost: vi.fn(),
    trackUserDailyCost: vi.fn(),
  },
}));

vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: {
    getInstance: () => ({
      endRequest: vi.fn(),
    }),
  },
}));

import { finalizeRequestStats } from "@/app/v1/_lib/proxy/response-handler";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import { RateLimitService } from "@/lib/rate-limit";
import { updateMessageRequestCost } from "@/repository/message";
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
    interceptAnthropicWarmupRequests: false,
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

function createSession({
  originalModel,
  redirectedModel,
}: {
  originalModel: string;
  redirectedModel: string;
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
  session.setSessionId("sess-test");

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
    id: 2000,
    createdAt: new Date(),
    user,
    key,
    apiKey: "sk-test",
  });

  return session;
}

describe("价格表缺失/查询失败：请求不计费且不报错", () => {
  beforeEach(() => {
    cloudSyncRequests.splice(0, cloudSyncRequests.length);
    vi.clearAllMocks();
  });

  it("无价格：应跳过 DB cost 更新与限流 cost 追踪，并触发异步同步", async () => {
    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("redirected"));
    vi.mocked(findLatestPriceByModel).mockResolvedValue(null);

    const session = createSession({ originalModel: "m1", redirectedModel: "m2" });
    const responseText = JSON.stringify({
      type: "message",
      usage: { input_tokens: 2, output_tokens: 3 },
    });
    await finalizeRequestStats(session, responseText, 200, 5);

    expect(updateMessageRequestCost).not.toHaveBeenCalled();
    expect(RateLimitService.trackCost).not.toHaveBeenCalled();
    expect(findLatestPriceByModel).toHaveBeenCalled();
    expect(cloudSyncRequests).toEqual([{ reason: "missing-model" }]);
  });

  it("价格数据为空对象：应视为无价格并触发异步同步", async () => {
    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("redirected"));
    vi.mocked(findLatestPriceByModel).mockImplementation(async (modelName: string) => {
      if (modelName === "m2") {
        return {
          id: 1,
          modelName: "m2",
          priceData: {},
          source: "litellm",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any;
      }
      return null;
    });

    const session = createSession({ originalModel: "m1", redirectedModel: "m2" });
    const responseText = JSON.stringify({
      type: "message",
      usage: { input_tokens: 2, output_tokens: 3 },
    });
    await finalizeRequestStats(session, responseText, 200, 5);

    expect(updateMessageRequestCost).not.toHaveBeenCalled();
    expect(RateLimitService.trackCost).not.toHaveBeenCalled();
    expect(cloudSyncRequests).toEqual([{ reason: "missing-model" }]);
  });

  it("价格查询抛错：应跳过计费且不影响响应", async () => {
    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("original"));
    vi.mocked(findLatestPriceByModel).mockImplementation(async () => {
      throw new Error("db query failed");
    });

    const session = createSession({ originalModel: "m1", redirectedModel: "m2" });
    const responseText = JSON.stringify({
      type: "message",
      usage: { input_tokens: 2, output_tokens: 3 },
    });
    await finalizeRequestStats(session, responseText, 200, 5);

    expect(updateMessageRequestCost).not.toHaveBeenCalled();
    expect(RateLimitService.trackCost).not.toHaveBeenCalled();
  });
});
