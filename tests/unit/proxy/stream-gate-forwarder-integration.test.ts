import { beforeEach, describe, expect, test, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";

/**
 * F1 流式内容门控（stream content gate）在 ProxyForwarder 顺序路径中的接线集成测试。
 *
 * 顺序路径进入条件：provider.firstByteTimeoutStreamingMs = 0（关闭 first-byte hedge），
 * shouldUseStreamingHedge() 返回 false，ProxyForwarder.send() 走顺序重试循环，
 * 在 isSSE 分支对 response.body 执行真实的 runStreamContentGate（本文件不 mock 门控本体）。
 *
 * STREAM_GATE_MODE 由 getEnvConfig() 读取（模块级缓存 _envConfig，首次调用即固化），
 * 因此这里 mock "@/lib/config/env.schema"，通过 vi.hoisted 的 envControl 注入模式值：
 * - 绕开缓存后，同一测试文件内即可分别驱动 enforce 与 off 两种模式；
 * - 其余 env 字段取 EnvSchema.parse({}) 的默认值，不依赖本机/CI 的 process.env。
 *
 * mock 前置结构复刻自 tests/unit/proxy/proxy-forwarder-hedge-first-byte.test.ts，
 * 避免触碰真实 DB/Redis/熔断器。
 */

const envControl = vi.hoisted(() => ({
  streamGateMode: "enforce" as "off" | "shadow" | "enforce",
}));

const mocks = vi.hoisted(() => ({
  pickRandomProviderWithExclusion: vi.fn(),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(async () => {}),
  getCircuitState: vi.fn(() => "closed"),
  getProviderHealthInfo: vi.fn(async () => ({
    health: { failureCount: 0 },
    config: { failureThreshold: 3 },
  })),
  updateSessionBindingSmart: vi.fn(async () => ({ updated: true, reason: "test" })),
  updateSessionProvider: vi.fn(async () => {}),
  clearSessionProvider: vi.fn(async () => {}),
  isHttp2Enabled: vi.fn(async () => false),
  getPreferredProviderEndpoints: vi.fn(async () => []),
  getEndpointFilterStats: vi.fn(async () => null),
  recordEndpointSuccess: vi.fn(async () => {}),
  recordEndpointFailure: vi.fn(async () => {}),
  isVendorTypeCircuitOpen: vi.fn(async () => false),
  recordVendorTypeAllEndpointsTimeout: vi.fn(async () => {}),
  checkAndTrackProviderSession: vi.fn(async () => ({
    allowed: true,
    count: 1,
    tracked: true,
    referenced: true,
  })),
  releaseProviderSession: vi.fn(async (_providerId: number, _sessionId: string) => {}),
  categorizeErrorAsync: vi.fn(async () => 0),
  getErrorDetectionResultAsync: vi.fn(async () => ({ matched: false })),
  getCachedSystemSettings: vi.fn(async () => ({
    enableThinkingSignatureRectifier: true,
    enableThinkingBudgetRectifier: true,
  })),
  storeSessionSpecialSettings: vi.fn(async () => {}),
  storeSessionRequestPhaseSnapshot: vi.fn(async () => {}),
  storeSessionResponsePhaseSnapshot: vi.fn(async () => {}),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("@/lib/config/env.schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config/env.schema")>();
  // 全字段均有 default/optional，parse({}) 恒成功；STREAM_GATE_MODE 由 envControl 动态注入
  const baseEnv = actual.EnvSchema.parse({});
  return {
    ...actual,
    getEnvConfig: () => ({ ...baseEnv, STREAM_GATE_MODE: envControl.streamGateMode }),
  };
});

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    getCachedSystemSettings: mocks.getCachedSystemSettings,
    isHttp2Enabled: mocks.isHttp2Enabled,
  };
});

vi.mock("@/lib/provider-endpoints/endpoint-selector", () => ({
  getPreferredProviderEndpoints: mocks.getPreferredProviderEndpoints,
  getEndpointFilterStats: mocks.getEndpointFilterStats,
}));

vi.mock("@/lib/endpoint-circuit-breaker", () => ({
  recordEndpointSuccess: mocks.recordEndpointSuccess,
  recordEndpointFailure: mocks.recordEndpointFailure,
}));

vi.mock("@/lib/circuit-breaker", () => ({
  getCircuitState: mocks.getCircuitState,
  getProviderHealthInfo: mocks.getProviderHealthInfo,
  recordFailure: mocks.recordFailure,
  recordSuccess: mocks.recordSuccess,
}));

vi.mock("@/lib/vendor-type-circuit-breaker", () => ({
  isVendorTypeCircuitOpen: mocks.isVendorTypeCircuitOpen,
  recordVendorTypeAllEndpointsTimeout: mocks.recordVendorTypeAllEndpointsTimeout,
}));

vi.mock("@/lib/rate-limit/service", () => ({
  RateLimitService: {
    checkAndTrackProviderSession: mocks.checkAndTrackProviderSession,
    releaseProviderSession: mocks.releaseProviderSession,
  },
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    updateSessionBindingSmart: mocks.updateSessionBindingSmart,
    updateSessionProvider: mocks.updateSessionProvider,
    clearSessionProvider: mocks.clearSessionProvider,
    storeSessionSpecialSettings: mocks.storeSessionSpecialSettings,
    storeSessionRequestPhaseSnapshot: mocks.storeSessionRequestPhaseSnapshot,
    storeSessionResponsePhaseSnapshot: mocks.storeSessionResponsePhaseSnapshot,
  },
}));

vi.mock("@/app/v1/_lib/proxy/provider-selector", () => ({
  ProxyProviderResolver: {
    pickRandomProviderWithExclusion: mocks.pickRandomProviderWithExclusion,
  },
}));

vi.mock("@/app/v1/_lib/proxy/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/v1/_lib/proxy/errors")>();
  return {
    ...actual,
    categorizeErrorAsync: mocks.categorizeErrorAsync,
    getErrorDetectionResultAsync: mocks.getErrorDetectionResultAsync,
  };
});

import { ErrorCategory as ProxyErrorCategory } from "@/app/v1/_lib/proxy/errors";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

type AttemptRuntime = {
  clearResponseTimeout?: () => void;
  responseController?: AbortController;
  releaseAgent?: () => void;
};

function sseFrame(eventName: string | null, data: Record<string, unknown>): string {
  const dataLine = `data: ${JSON.stringify(data)}\n\n`;
  return eventName ? `event: ${eventName}\n${dataLine}` : dataLine;
}

// 仅使用 anthropic 家族的真实帧格式（providerType "claude" -> family "anthropic"）
const PING_FRAME = sseFrame("ping", { type: "ping" });
const ERROR_FRAME = sseFrame(null, {
  type: "error",
  error: { type: "overloaded_error", message: "x" },
});
const MESSAGE_START_FRAME = sseFrame("message_start", {
  type: "message_start",
  message: {
    id: "msg_01",
    type: "message",
    role: "assistant",
    model: "claude-test",
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 3, output_tokens: 1 },
  },
});
const CONTENT_DELTA_FRAME = sseFrame("content_block_delta", {
  type: "content_block_delta",
  index: 0,
  delta: { type: "text_delta", text: "Hello" },
});
const MESSAGE_STOP_FRAME = sseFrame("message_stop", { type: "message_stop" });

// failover 后获胜供应商的正常内容流
const WINNER_FRAMES = [MESSAGE_START_FRAME, CONTENT_DELTA_FRAME, MESSAGE_STOP_FRAME];

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 1,
    name: "p1",
    url: "https://provider.example.com",
    key: "k",
    providerVendorId: null,
    isEnabled: true,
    weight: 1,
    priority: 0,
    groupPriorities: null,
    costMultiplier: 1,
    groupTag: null,
    providerType: "claude",
    preserveClientIp: false,
    modelRedirects: null,
    allowedModels: null,
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    totalCostResetAt: null,
    limitConcurrentSessions: 0,
    maxRetryAttempts: 1,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerOpenDuration: 1_800_000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    // 0 = 关闭 first-byte hedge，强制 ProxyForwarder.send() 走顺序路径
    firstByteTimeoutStreamingMs: 0,
    streamingIdleTimeoutMs: 0,
    requestTimeoutNonStreamingMs: 0,
    websiteUrl: null,
    faviconUrl: null,
    cacheTtlPreference: null,
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
    tpm: 0,
    rpm: 0,
    rpd: 0,
    cc: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function createSession(clientAbortSignal: AbortSignal | null = null): ProxySession {
  const headers = new Headers();
  const session = Object.create(ProxySession.prototype);

  Object.assign(session, {
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("https://example.com/v1/messages"),
    headers,
    originalHeaders: new Headers(headers),
    headerLog: JSON.stringify(Object.fromEntries(headers.entries())),
    request: {
      model: "claude-test",
      log: "(test)",
      message: {
        model: "claude-test",
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      },
    },
    userAgent: null,
    context: null,
    clientAbortSignal,
    userName: "test-user",
    authState: { success: true, user: null, key: null, apiKey: null },
    provider: null,
    messageContext: null,
    sessionId: "sess-stream-gate",
    requestSequence: 1,
    originalFormat: "claude",
    providerType: null,
    originalModelName: null,
    originalUrlPathname: null,
    providerChain: [],
    cacheTtlResolved: null,
    context1mApplied: false,
    specialSettings: [],
    cachedPriceData: undefined,
    cachedBillingModelSource: undefined,
    endpointPolicy: resolveEndpointPolicy("/v1/messages"),
    isHeaderModified: () => false,
  });

  return session as ProxySession;
}

function createSseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // 每帧一个 chunk：门控 commit 时前缀 chunk 与帧一一对应
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function spyOnDoForward() {
  const doForward = vi.spyOn(
    ProxyForwarder as unknown as {
      doForward: (...args: unknown[]) => Promise<Response>;
    },
    "doForward"
  );
  // 兜底：脚本之外的额外调用直接失败，避免落回真实 doForward 触发网络请求
  doForward.mockImplementation(async () => {
    throw new Error("unexpected doForward call beyond scripted attempts");
  });
  return doForward;
}

function attachAttemptRuntime(
  attemptSession: unknown,
  cleanup: { clearResponseTimeout: () => void; releaseAgent: () => void }
): void {
  const runtime = attemptSession as ProxySession & AttemptRuntime;
  runtime.responseController = new AbortController();
  runtime.clearResponseTimeout = cleanup.clearResponseTimeout;
  runtime.releaseAgent = cleanup.releaseAgent;
}

describe("F1 stream content gate x ProxyForwarder sequential path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.categorizeErrorAsync.mockResolvedValue(ProxyErrorCategory.PROVIDER_ERROR);
  });

  describe("STREAM_GATE_MODE=enforce", () => {
    beforeEach(() => {
      envControl.streamGateMode = "enforce";
    });

    test("上游 error 帧先于内容：precommit 失败触发供应商切换，失败供应商零字节泄漏", async () => {
      const provider1 = createProvider({ id: 1, name: "gate-p1" });
      const provider2 = createProvider({ id: 2, name: "gate-p2" });
      const session = createSession();
      session.setProvider(provider1);

      mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);

      const clearResponseTimeout1 = vi.fn();
      const releaseAgent1 = vi.fn();
      const doForward = spyOnDoForward();

      doForward.mockImplementationOnce(async (attemptSession) => {
        attachAttemptRuntime(attemptSession, {
          clearResponseTimeout: clearResponseTimeout1,
          releaseAgent: releaseAgent1,
        });
        return createSseResponse([PING_FRAME, ERROR_FRAME]);
      });
      doForward.mockImplementationOnce(async () => createSseResponse(WINNER_FRAMES));

      const response = await ProxyForwarder.send(session);
      const text = await response.text();

      expect(doForward).toHaveBeenCalledTimes(2);
      expect((doForward.mock.calls[1] as unknown[])[1]).toMatchObject({ id: provider2.id });

      // 客户端只能读到第二个供应商的帧：失败供应商已缓冲的 ping 前缀整段丢弃
      expect(text).toBe(WINNER_FRAMES.join(""));
      expect(text).not.toContain("ping");
      expect(text).not.toContain("overloaded_error");

      // precommit 失败按 PROVIDER_ERROR 结算：计入熔断器并清理计时器 / agent 引用
      expect(mocks.recordFailure).toHaveBeenCalledWith(provider1.id, expect.any(Error));
      expect(clearResponseTimeout1).toHaveBeenCalledTimes(1);
      expect(releaseAgent1).toHaveBeenCalledTimes(1);
      expect(session.provider?.id).toBe(provider2.id);

      // 决策链保留 502 gate_error 审计，upstreamBody 携带上游错误帧原文
      const gateFailureEntry = session
        .getProviderChain()
        .find((item) => item.id === provider1.id && item.reason === "retry_failed");
      expect(gateFailureEntry?.statusCode).toBe(502);
      expect(gateFailureEntry?.errorDetails?.provider?.upstreamBody).toContain("overloaded_error");
    });

    test("中性前缀（ping/message_start）在首个内容帧提交时完整冲刷，无丢失无重复", async () => {
      const provider1 = createProvider({ id: 1, name: "gate-p1" });
      const session = createSession();
      session.setProvider(provider1);

      const frames = [PING_FRAME, MESSAGE_START_FRAME, CONTENT_DELTA_FRAME, MESSAGE_STOP_FRAME];
      const doForward = spyOnDoForward();
      doForward.mockImplementationOnce(async () => createSseResponse(frames));

      const response = await ProxyForwarder.send(session);
      const text = await response.text();

      expect(doForward).toHaveBeenCalledTimes(1);
      // 缓冲前缀（ping + message_start + 触发提交的 content_block_delta）与
      // 提交后仍留在 reader 上的 message_stop 拼接后与原始四帧一字节不差
      expect(text).toBe(frames.join(""));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      expect(mocks.pickRandomProviderWithExclusion).not.toHaveBeenCalled();
      expect(mocks.recordFailure).not.toHaveBeenCalled();
    });

    test("terminal-only 流（message_stop 即终止）按 empty_stream 失败并切换供应商", async () => {
      const provider1 = createProvider({ id: 1, name: "gate-p1" });
      const provider2 = createProvider({ id: 2, name: "gate-p2" });
      const session = createSession();
      session.setProvider(provider1);

      mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);

      const doForward = spyOnDoForward();
      doForward.mockImplementationOnce(async () => createSseResponse([MESSAGE_STOP_FRAME]));
      doForward.mockImplementationOnce(async () => createSseResponse(WINNER_FRAMES));

      const response = await ProxyForwarder.send(session);
      const text = await response.text();

      expect(doForward).toHaveBeenCalledTimes(2);
      expect(text).toBe(WINNER_FRAMES.join(""));
      expect(text).toContain('"text":"Hello"');
      expect(mocks.recordFailure).toHaveBeenCalledWith(provider1.id, expect.any(Error));
      expect(session.provider?.id).toBe(provider2.id);

      const emptyStreamEntry = session
        .getProviderChain()
        .find((item) => item.id === provider1.id && item.reason === "retry_failed");
      expect(emptyStreamEntry?.statusCode).toBe(502);
      expect(emptyStreamEntry?.errorMessage).toContain("empty_stream");
    });
  });

  describe("STREAM_GATE_MODE=off", () => {
    beforeEach(() => {
      envControl.streamGateMode = "off";
    });

    test("默认 off：含 error 帧的 200 SSE 原样透传，不触发 failover", async () => {
      const provider1 = createProvider({ id: 1, name: "gate-p1" });
      const session = createSession();
      session.setProvider(provider1);

      const frames = [PING_FRAME, ERROR_FRAME];
      const doForward = spyOnDoForward();
      doForward.mockImplementationOnce(async () => createSseResponse(frames));

      const response = await ProxyForwarder.send(session);
      const text = await response.text();

      // 与现状一致：门控关闭时错误帧照常透传给客户端，由既有事后检测兜底
      expect(doForward).toHaveBeenCalledTimes(1);
      expect(text).toBe(frames.join(""));
      expect(text).toContain("overloaded_error");
      expect(mocks.pickRandomProviderWithExclusion).not.toHaveBeenCalled();
      expect(mocks.recordFailure).not.toHaveBeenCalled();
    });
  });
});
