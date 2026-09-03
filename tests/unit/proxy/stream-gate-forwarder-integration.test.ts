import { beforeEach, describe, expect, test, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import { ProxyError } from "@/app/v1/_lib/proxy/errors";

/**
 * F1 流式内容门控（stream content gate）在 ProxyForwarder 中的接线集成测试。
 *
 * 默认顺序路径进入条件：provider.firstByteTimeoutStreamingMs = 0（关闭 first-byte hedge），
 * shouldUseStreamingHedge() 返回 false，ProxyForwarder.send() 走顺序重试循环，
 * 在 isSSE 分支对 response.body 执行真实的 runStreamContentGate（本文件不 mock 门控本体）。
 * 专用回归用例会将该值设为正数，以覆盖 Legacy Hedge 的同一门控接线。
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
  tombstoneAffinityOnFailure: vi.fn(async () => {}),
  recordAffinityWinner: vi.fn(async () => {}),
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

vi.mock("@/app/v1/_lib/proxy/affinity/affinity-recorder", () => ({
  tombstoneAffinityOnFailure: mocks.tombstoneAffinityOnFailure,
  recordAffinityWinner: mocks.recordAffinityWinner,
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

function createOpenAiResponsesOverloadFrames(): string[] {
  const requestEcho = "x".repeat(500_000);
  const error = {
    type: "server_error",
    code: "server_is_overloaded",
    message: "Our servers are currently overloaded. Please try again later.",
  };

  return [
    sseFrame("response.created", {
      type: "response.created",
      response: { id: "resp_failed", status: "in_progress", instructions: requestEcho },
    }),
    sseFrame("response.in_progress", {
      type: "response.in_progress",
      response: { id: "resp_failed", status: "in_progress", instructions: requestEcho },
    }),
    sseFrame("error", { type: "error", ...error }),
    sseFrame("response.failed", {
      type: "response.failed",
      response: { id: "resp_failed", status: "failed", error },
    }),
  ];
}

const OPENAI_RESPONSES_WINNER_FRAMES = [
  sseFrame("response.output_text.delta", {
    type: "response.output_text.delta",
    delta: "winner",
  }),
  sseFrame("response.completed", {
    type: "response.completed",
    response: { id: "resp_winner", status: "completed" },
  }),
];

/**
 * 上游返回语法完整、语义为空的 Responses 流（实测形态）：
 * output_text.done 的 text 为 ""，output_item.done 的 content[0].text 为 ""，
 * completed 的 output 为 []。所有帧按 isNonEmptyValue 判定均非内容 -> empty_stream。
 */
const OPENAI_RESPONSES_EMPTY_TEXT_FRAMES = [
  sseFrame("response.created", {
    type: "response.created",
    response: { id: "resp_empty", status: "in_progress", output: [] },
  }),
  sseFrame("response.output_item.added", {
    type: "response.output_item.added",
    item: {
      id: "msg_empty",
      type: "message",
      status: "in_progress",
      content: [],
      role: "assistant",
    },
    output_index: 0,
  }),
  sseFrame("response.content_part.added", {
    type: "response.content_part.added",
    content_index: 0,
    item_id: "msg_empty",
    output_index: 0,
    part: { type: "output_text", annotations: [], logprobs: [], text: "" },
  }),
  sseFrame("response.output_text.done", {
    type: "response.output_text.done",
    content_index: 0,
    item_id: "msg_empty",
    output_index: 0,
    text: "",
  }),
  sseFrame("response.content_part.done", {
    type: "response.content_part.done",
    content_index: 0,
    item_id: "msg_empty",
    output_index: 0,
    part: { type: "output_text", annotations: [], logprobs: [], text: "" },
  }),
  sseFrame("response.output_item.done", {
    type: "response.output_item.done",
    item: {
      id: "msg_empty",
      type: "message",
      status: "completed",
      content: [{ type: "output_text", annotations: [], logprobs: [], text: "" }],
      role: "assistant",
    },
    output_index: 0,
  }),
  sseFrame("response.completed", {
    type: "response.completed",
    response: {
      id: "resp_empty",
      status: "completed",
      output: [],
      usage: {
        input_tokens: 32,
        output_tokens: 4,
        output_tokens_details: { reasoning_tokens: 0 },
      },
    },
  }),
];

const VALID_OPENAI_RESPONSES_STREAMS = [
  {
    name: "terminal compaction output",
    frames: [
      sseFrame("response.completed", {
        type: "response.completed",
        response: {
          id: "resp_compaction",
          status: "completed",
          output: [{ id: "cmp_1", type: "compaction", encrypted_content: "opaque-state" }],
        },
      }),
    ],
  },
  {
    name: "custom tool-call input deltas",
    frames: [
      sseFrame("response.custom_tool_call_input.delta", {
        type: "response.custom_tool_call_input.delta",
        delta: '{"path":"README.md"}',
      }),
      sseFrame("response.completed", {
        type: "response.completed",
        response: { id: "resp_tool", status: "completed" },
      }),
    ],
  },
] as const;

type ReplayGateCase = {
  name: string;
  providerType: Provider["providerType"];
  endpoint: "/v1/messages" | "/v1/responses";
  format: "claude" | "response";
  failedFrames: () => string[];
  winnerFrames: string[];
  failedMarkers: string[];
};

const REPLAY_GATE_CASES: ReplayGateCase[] = [
  {
    name: "OpenAI Responses server overload",
    providerType: "codex",
    endpoint: "/v1/responses",
    format: "response",
    failedFrames: createOpenAiResponsesOverloadFrames,
    winnerFrames: OPENAI_RESPONSES_WINNER_FRAMES,
    failedMarkers: ["server_is_overloaded", "resp_failed"],
  },
  {
    name: "Anthropic overloaded_error",
    providerType: "claude",
    endpoint: "/v1/messages",
    format: "claude",
    failedFrames: () => [PING_FRAME, ERROR_FRAME],
    winnerFrames: WINNER_FRAMES,
    failedMarkers: ["overloaded_error"],
  },
];

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

function configureCodexResponsesRequest(session: ProxySession): void {
  session.requestUrl = new URL("https://example.com/v1/responses");
  session.originalFormat = "response";
  session.endpointPolicy = resolveEndpointPolicy("/v1/responses");
  session.request.message = {
    model: "gpt-5.5",
    stream: true,
    input: "hi",
  };
}

function attachReplayOwner(session: ProxySession, testCase: ReplayGateCase): void {
  Object.assign(session, {
    requestUrl: new URL(`https://example.com${testCase.endpoint}`),
    originalFormat: testCase.format,
    endpointPolicy: resolveEndpointPolicy(testCase.endpoint),
  });
  session.replayState = {
    role: "owner",
    ownerToken: "owner-token",
    identity: {
      replayId: "replay-id",
      verifier: "verifier",
      scopeTag: "scope-tag",
      keyId: 1,
      userId: 1,
      format: testCase.format,
      model: "claude-test",
      endpoint: testCase.endpoint,
    },
  };
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

describe("F1 stream content gate x ProxyForwarder paths", () => {
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
      const clearResponseTimeout2 = vi.fn();
      const releaseAgent2 = vi.fn();
      doForward.mockImplementationOnce(async (attemptSession) => {
        attachAttemptRuntime(attemptSession, {
          clearResponseTimeout: clearResponseTimeout2,
          releaseAgent: releaseAgent2,
        });
        return createSseResponse(WINNER_FRAMES);
      });

      const response = await ProxyForwarder.send(session);
      const text = await response.text();

      expect(doForward).toHaveBeenCalledTimes(2);
      expect((doForward.mock.calls[1] as unknown[])[1]).toMatchObject({ id: provider2.id });

      // 客户端只能读到第二个供应商的帧：失败供应商已缓冲的 ping 前缀整段丢弃
      expect(text).toBe(WINNER_FRAMES.join(""));
      expect(text).not.toContain("ping");
      expect(text).not.toContain("overloaded_error");

      // precommit 失败按 PROVIDER_ERROR 结算：计入熔断器并清理计时器 / agent 引用
      // 首字节到达即清一次（onFirstByte 保持首字节超时语义），失败清理再兜底一次
      expect(mocks.recordFailure).toHaveBeenCalledWith(provider1.id, expect.any(Error));
      expect(clearResponseTimeout1).toHaveBeenCalledTimes(2);
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

    test("Responses terminal compaction 在 enforce 模式下直接提交且不计入熔断", async () => {
      const provider = createProvider({ id: 1, name: "compaction", providerType: "codex" });
      const session = createSession();
      session.setProvider(provider);
      Object.assign(session, {
        requestUrl: new URL("https://example.com/v1/responses"),
        originalFormat: "response",
        endpointPolicy: resolveEndpointPolicy("/v1/responses"),
      });

      const frames = VALID_OPENAI_RESPONSES_STREAMS[0].frames.slice();
      const doForward = spyOnDoForward();
      doForward.mockImplementationOnce(async () => createSseResponse(frames));

      const response = await ProxyForwarder.send(session);
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(text).toBe(frames.join(""));
      expect(doForward).toHaveBeenCalledTimes(1);
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
      // anthropic 家族只吐终止帧属畸形流，仍按供应商故障计入熔断并写亲和墓碑
      expect(mocks.recordFailure).toHaveBeenCalledWith(provider1.id, expect.any(Error));
      expect(mocks.tombstoneAffinityOnFailure).toHaveBeenCalledWith(session, provider1.id);
      expect(session.provider?.id).toBe(provider2.id);

      const emptyStreamEntry = session
        .getProviderChain()
        .find((item) => item.id === provider1.id && item.reason === "retry_failed");
      expect(emptyStreamEntry?.statusCode).toBe(502);
      expect(emptyStreamEntry?.errorMessage).toContain("empty_stream");
    });

    test('Responses 空文本响应（output_text.done text=""）直接透传，不 failover', async () => {
      const provider1 = createProvider({ id: 1, name: "empty-p1", providerType: "codex" });
      const session = createSession();
      session.setProvider(provider1);
      Object.assign(session, {
        requestUrl: new URL("https://example.com/v1/responses"),
        originalFormat: "response",
        endpointPolicy: resolveEndpointPolicy("/v1/responses"),
      });

      const doForward = spyOnDoForward();
      doForward.mockImplementationOnce(async () =>
        createSseResponse(OPENAI_RESPONSES_EMPTY_TEXT_FRAMES)
      );

      const response = await ProxyForwarder.send(session);
      const text = await response.text();

      // 干净完成（status=completed）即成功响应：空回复是合法结果（如 watchdog 的预期沉默），
      // 一次即回，不得放大成同供应商重试 + 跨供应商 failover
      expect(response.status).toBe(200);
      expect(doForward).toHaveBeenCalledTimes(1);
      expect(text).toBe(OPENAI_RESPONSES_EMPTY_TEXT_FRAMES.join(""));
      expect(mocks.pickRandomProviderWithExclusion).not.toHaveBeenCalled();
      expect(mocks.recordFailure).not.toHaveBeenCalled();
      expect(mocks.tombstoneAffinityOnFailure).not.toHaveBeenCalled();
      expect(session.provider?.id).toBe(provider1.id);
    });

    test("Responses 断流（无终止帧的 EOF）仍按供应商故障计入熔断", async () => {
      const provider1 = createProvider({ id: 1, name: "eof-p1", providerType: "codex" });
      const provider2 = createProvider({ id: 2, name: "eof-p2", providerType: "codex" });
      const session = createSession();
      session.setProvider(provider1);
      Object.assign(session, {
        requestUrl: new URL("https://example.com/v1/responses"),
        originalFormat: "response",
        endpointPolicy: resolveEndpointPolicy("/v1/responses"),
      });

      mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);

      const doForward = spyOnDoForward();
      // 只发生命周期帧就断开：没有 response.completed，属真实上游异常
      doForward.mockImplementationOnce(async () =>
        createSseResponse([
          sseFrame("response.created", {
            type: "response.created",
            response: { id: "resp_eof", status: "in_progress", output: [] },
          }),
        ])
      );
      doForward.mockImplementationOnce(async () =>
        createSseResponse(OPENAI_RESPONSES_WINNER_FRAMES)
      );

      const response = await ProxyForwarder.send(session);
      const text = await response.text();

      expect(doForward).toHaveBeenCalledTimes(2);
      expect(text).toBe(OPENAI_RESPONSES_WINNER_FRAMES.join(""));
      expect(mocks.recordFailure).toHaveBeenCalledWith(provider1.id, expect.any(Error));
      expect(mocks.tombstoneAffinityOnFailure).toHaveBeenCalledWith(session, provider1.id);
      expect(session.provider?.id).toBe(provider2.id);
    });

    test("上游返回 4xx / cyber_policy 错误帧时不触发切商重试，按不可重试客户端错误退出", async () => {
      const provider1 = createProvider({ id: 1, name: "gate-p1", providerType: "codex" });
      const session = createSession();
      session.setProvider(provider1);
      Object.assign(session, {
        requestUrl: new URL("https://example.com/v1/responses"),
        originalFormat: "response",
        endpointPolicy: resolveEndpointPolicy("/v1/responses"),
      });

      mocks.categorizeErrorAsync.mockImplementationOnce(async (err: Error) => {
        if (err instanceof ProxyError && err.statusCode === 400) {
          return 3; // NON_RETRYABLE_CLIENT_ERROR
        }
        return 0;
      });

      const cyberPolicyFrame = `event: error\ndata: ${JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          code: "cyber_policy",
          message: "This content was flagged for possible cybersecurity risk.",
        },
      })}\n\n`;

      const doForward = spyOnDoForward();
      doForward.mockImplementationOnce(async () => createSseResponse([cyberPolicyFrame]));

      await expect(ProxyForwarder.send(session)).rejects.toThrow(
        /Stream content gate rejected upstream before first valid content/
      );

      expect(doForward).toHaveBeenCalledTimes(1);
      expect(mocks.pickRandomProviderWithExclusion).not.toHaveBeenCalled();

      const chainEntries = session.getProviderChain();
      const failureEntry = chainEntries.find((item) => item.id === provider1.id);
      expect(failureEntry?.statusCode).toBe(400);
      expect(failureEntry?.reason).toBe("client_error_non_retryable");
    });

    test("缺少 Content-Type 的 JSON 假 200 在 enforce 下被拦截并切换供应商", async () => {
      const provider1 = createProvider({ id: 1, name: "codex-json-1", providerType: "codex" });
      const provider2 = createProvider({ id: 2, name: "codex-json-2", providerType: "codex" });
      const session = createSession();
      configureCodexResponsesRequest(session);
      session.setProvider(provider1);

      mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);
      const doForward = spyOnDoForward();
      const headerlessJsonError = new Response(
        new TextEncoder().encode(
          JSON.stringify({ error: { type: "server_error", message: "upstream failed" } })
        )
      );
      expect(headerlessJsonError.headers.get("content-type")).toBeNull();
      doForward.mockResolvedValueOnce(headerlessJsonError);
      doForward.mockImplementationOnce(async () =>
        createSseResponse(OPENAI_RESPONSES_WINNER_FRAMES)
      );

      const response = await ProxyForwarder.send(session);

      expect(await response.text()).toBe(OPENAI_RESPONSES_WINNER_FRAMES.join(""));
      expect(doForward).toHaveBeenCalledTimes(2);
      expect(mocks.recordFailure).toHaveBeenCalledWith(provider1.id, expect.any(Error));
      expect(mocks.recordSuccess).not.toHaveBeenCalledWith(provider1.id);
      expect(session.provider?.id).toBe(provider2.id);
    });

    test("Legacy Hedge 在 enforce 下拒绝缺头 JSON 并选择有效 Codex Responses 流", async () => {
      const provider1 = createProvider({
        id: 1,
        name: "codex-hedge-json",
        providerType: "codex",
        firstByteTimeoutStreamingMs: 100,
      });
      const provider2 = createProvider({
        id: 2,
        name: "codex-hedge-sse",
        providerType: "codex",
        firstByteTimeoutStreamingMs: 100,
      });
      const session = createSession();
      configureCodexResponsesRequest(session);
      session.setProvider(provider1);

      mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);
      const doForward = spyOnDoForward();
      doForward.mockImplementationOnce(async (attemptSession) => {
        attachAttemptRuntime(attemptSession, {
          clearResponseTimeout: vi.fn(),
          releaseAgent: vi.fn(),
        });
        return new Response(
          new TextEncoder().encode(
            JSON.stringify({ error: { type: "server_error", message: "upstream failed" } })
          )
        );
      });
      doForward.mockImplementationOnce(async (attemptSession) => {
        attachAttemptRuntime(attemptSession, {
          clearResponseTimeout: vi.fn(),
          releaseAgent: vi.fn(),
        });
        return createSseResponse(OPENAI_RESPONSES_WINNER_FRAMES);
      });

      const response = await ProxyForwarder.send(session);

      expect(await response.text()).toBe(OPENAI_RESPONSES_WINNER_FRAMES.join(""));
      expect(doForward).toHaveBeenCalledTimes(2);
      expect(mocks.recordFailure).toHaveBeenCalledWith(provider1.id, expect.any(Error));
      expect(session.provider?.id).toBe(provider2.id);
    });

    test.each(REPLAY_GATE_CASES)(
      "enforce 下 Replay owner 拦截首内容前的 $name，并切换到成功供应商",
      async (testCase) => {
        const provider1 = createProvider({
          id: 1,
          name: "replay-p1",
          providerType: testCase.providerType,
        });
        const provider2 = createProvider({
          id: 2,
          name: "replay-p2",
          providerType: testCase.providerType,
        });
        const session = createSession();
        session.setProvider(provider1);
        attachReplayOwner(session, testCase);

        mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);
        const doForward = spyOnDoForward();
        doForward.mockImplementationOnce(async () => createSseResponse(testCase.failedFrames()));
        doForward.mockImplementationOnce(async () => createSseResponse(testCase.winnerFrames));

        const response = await ProxyForwarder.send(session);
        const text = await response.text();

        expect(doForward).toHaveBeenCalledTimes(2);
        expect((doForward.mock.calls[1] as unknown[])[1]).toMatchObject({ id: provider2.id });
        expect(text).toBe(testCase.winnerFrames.join(""));
        for (const marker of testCase.failedMarkers) {
          expect(text).not.toContain(marker);
        }
        expect(mocks.recordFailure).toHaveBeenCalledWith(provider1.id, expect.any(Error));
        expect(session.provider?.id).toBe(provider2.id);
      }
    );

    test("Replay owner 在所有 precommit attempt 失败后立即释放所有权", async () => {
      const provider = createProvider({ id: 1, name: "replay-only", providerType: "codex" });
      const session = createSession();
      session.setProvider(provider);
      attachReplayOwner(session, REPLAY_GATE_CASES[0]);

      mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(null);
      const doForward = spyOnDoForward();
      doForward.mockImplementationOnce(async () =>
        createSseResponse(createOpenAiResponsesOverloadFrames())
      );

      await expect(ProxyForwarder.send(session)).rejects.toThrow();

      expect(doForward).toHaveBeenCalledTimes(1);
      expect(session.replayState).toBeNull();
    });
    test("Replay owner 将 OpenAI-compatible DeepSeek reasoning_content 视为首个有效内容", async () => {
      const provider = createProvider({
        id: 1,
        name: "deepseek-reasoning",
        providerType: "openai-compatible",
      });
      const session = createSession();
      session.setProvider(provider);
      attachReplayOwner(session, REPLAY_GATE_CASES[1]);

      const reasoningFrames = Array.from({ length: 65 }, (_, index) =>
        sseFrame(null, { choices: [{ delta: { reasoning_content: `reasoning step ${index}` } }] })
      );
      const doForward = spyOnDoForward();
      doForward.mockImplementationOnce(async () => createSseResponse(reasoningFrames));

      const response = await ProxyForwarder.send(session);
      const text = await response.text();

      expect(doForward).toHaveBeenCalledTimes(1);
      expect(text).toBe(reasoningFrames.join(""));
      expect(mocks.pickRandomProviderWithExclusion).not.toHaveBeenCalled();
      expect(mocks.recordFailure).not.toHaveBeenCalled();
    });

    test.each(VALID_OPENAI_RESPONSES_STREAMS)(
      "Replay owner 将 $name 视为有效内容，不触发 502/failover/熔断",
      async ({ frames }) => {
        const provider = createProvider({ id: 1, name: "responses-valid", providerType: "codex" });
        const session = createSession();
        session.setProvider(provider);
        attachReplayOwner(session, REPLAY_GATE_CASES[0]);

        const streamFrames = frames.slice();
        const doForward = spyOnDoForward();
        doForward.mockImplementationOnce(async () => createSseResponse(streamFrames));

        const response = await ProxyForwarder.send(session);
        const text = await response.text();

        expect(response.status).toBe(200);
        expect(text).toBe(streamFrames.join(""));
        expect(doForward).toHaveBeenCalledTimes(1);
        expect(mocks.pickRandomProviderWithExclusion).not.toHaveBeenCalled();
        expect(mocks.recordFailure).not.toHaveBeenCalled();
      }
    );

    test("enforce + 高并发模式：门控让位于 TTFB，内容帧到达前即向客户端提交", async () => {
      const provider = createProvider({ id: 1, name: "high-concurrency" });
      const session = createSession();
      session.setProvider(provider);
      session.setHighConcurrencyModeEnabled(true);

      const encoder = new TextEncoder();
      let releaseContent: () => void = () => {};
      const contentHeld = new Promise<void>((resolve) => {
        releaseContent = resolve;
      });
      const upstream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(MESSAGE_START_FRAME));
          await contentHeld;
          controller.enqueue(encoder.encode(CONTENT_DELTA_FRAME));
          controller.enqueue(encoder.encode(MESSAGE_STOP_FRAME));
          controller.close();
        },
      });
      const doForward = spyOnDoForward();
      doForward.mockImplementationOnce(
        async () =>
          new Response(upstream, { status: 200, headers: { "content-type": "text/event-stream" } })
      );

      const sendPromise = ProxyForwarder.send(session);
      const settledBeforeContent = await Promise.race([
        sendPromise.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
      ]);

      releaseContent();
      const response = await sendPromise;
      const text = await response.text();

      expect(settledBeforeContent).toBe(true);
      expect(text).toBe([MESSAGE_START_FRAME, CONTENT_DELTA_FRAME, MESSAGE_STOP_FRAME].join(""));
      expect(doForward).toHaveBeenCalledTimes(1);
    });

    test("高并发模式下缺少 Content-Type 的 Codex Responses 流也不等待首个内容帧", async () => {
      const provider = createProvider({
        id: 1,
        name: "high-concurrency-codex",
        providerType: "codex",
      });
      const session = createSession();
      configureCodexResponsesRequest(session);
      session.setProvider(provider);
      session.setHighConcurrencyModeEnabled(true);

      const encoder = new TextEncoder();
      let releaseContent: () => void = () => {};
      const contentHeld = new Promise<void>((resolve) => {
        releaseContent = resolve;
      });
      const frames = [
        sseFrame("response.created", {
          type: "response.created",
          response: { id: "resp_high_concurrency", status: "in_progress" },
        }),
        sseFrame("response.output_text.delta", {
          type: "response.output_text.delta",
          delta: "Hello",
        }),
        sseFrame("response.completed", {
          type: "response.completed",
          response: { id: "resp_high_concurrency", status: "completed" },
        }),
      ];
      const upstream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(frames[0]));
          await contentHeld;
          controller.enqueue(encoder.encode(frames[1]));
          controller.enqueue(encoder.encode(frames[2]));
          controller.close();
        },
      });
      const doForward = spyOnDoForward();
      doForward.mockImplementationOnce(async () => new Response(upstream, { status: 200 }));

      const sendPromise = ProxyForwarder.send(session);
      const response = await Promise.race([
        sendPromise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("high-concurrency Codex stream waited for content")),
            1_000
          )
        ),
      ]).finally(() => {
        releaseContent();
      });

      expect(await response.text()).toBe(frames.join(""));
      expect(doForward).toHaveBeenCalledTimes(1);
      expect(mocks.pickRandomProviderWithExclusion).not.toHaveBeenCalled();
    });

    test("高并发 Legacy Hedge 下缺少 Content-Type 的 Codex Responses 流也立即提交首字节", async () => {
      const provider = createProvider({
        id: 1,
        name: "high-concurrency-codex-hedge",
        providerType: "codex",
        firstByteTimeoutStreamingMs: 50,
      });
      const session = createSession();
      configureCodexResponsesRequest(session);
      session.setProvider(provider);
      session.setHighConcurrencyModeEnabled(true);

      const encoder = new TextEncoder();
      let releaseContent: () => void = () => {};
      const contentHeld = new Promise<void>((resolve) => {
        releaseContent = resolve;
      });
      const frames = [
        sseFrame("response.created", {
          type: "response.created",
          response: { id: "resp_high_concurrency_hedge", status: "in_progress" },
        }),
        sseFrame("response.output_text.delta", {
          type: "response.output_text.delta",
          delta: "Hello",
        }),
        sseFrame("response.completed", {
          type: "response.completed",
          response: { id: "resp_high_concurrency_hedge", status: "completed" },
        }),
      ];
      const upstream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(frames[0]));
          await contentHeld;
          controller.enqueue(encoder.encode(frames[1]));
          controller.enqueue(encoder.encode(frames[2]));
          controller.close();
        },
      });
      const doForward = spyOnDoForward();
      doForward.mockImplementationOnce(async (attemptSession) => {
        attachAttemptRuntime(attemptSession, {
          clearResponseTimeout: vi.fn(),
          releaseAgent: vi.fn(),
        });
        return new Response(upstream, { status: 200 });
      });

      const sendPromise = ProxyForwarder.send(session);
      const response = await Promise.race([
        sendPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("high-concurrency hedge waited for content")), 1_000)
        ),
      ]).finally(() => {
        releaseContent();
      });

      expect(await response.text()).toBe(frames.join(""));
      expect(doForward).toHaveBeenCalledTimes(1);
      expect(mocks.pickRandomProviderWithExclusion).not.toHaveBeenCalled();
    });
  });

  describe("STREAM_GATE_MODE=off", () => {
    beforeEach(() => {
      envControl.streamGateMode = "off";
    });

    test("缺少 Content-Type 的 Codex Responses 流在首个内容帧前返回且不被克隆检查", async () => {
      const provider = createProvider({ id: 1, name: "codex-headerless", providerType: "codex" });
      const session = createSession();
      configureCodexResponsesRequest(session);
      session.setProvider(provider);

      const encoder = new TextEncoder();
      const firstFrame = sseFrame("response.created", {
        type: "response.created",
        response: { id: "resp_headerless", status: "in_progress" },
      });
      const contentFrame = sseFrame("response.output_text.delta", {
        type: "response.output_text.delta",
        delta: "hello",
      });
      const completedFrame = sseFrame("response.completed", {
        type: "response.completed",
        response: { id: "resp_headerless", status: "completed" },
      });
      let upstreamController: ReadableStreamDefaultController<Uint8Array> | undefined;
      const upstreamResponse = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            upstreamController = controller;
            controller.enqueue(encoder.encode(firstFrame));
          },
        })
      );
      const cloneSpy = vi.spyOn(upstreamResponse, "clone");
      const doForward = spyOnDoForward();
      doForward.mockResolvedValueOnce(upstreamResponse);

      let timeout: ReturnType<typeof setTimeout> | undefined;
      const response = await Promise.race([
        ProxyForwarder.send(session),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("ProxyForwarder.send waited for headerless stream content")),
            1_000
          );
        }),
      ]).finally(() => {
        if (timeout) clearTimeout(timeout);
        upstreamController?.enqueue(encoder.encode(contentFrame));
        upstreamController?.enqueue(encoder.encode(completedFrame));
        upstreamController?.close();
      });

      expect(upstreamResponse.headers.get("content-type")).toBeNull();
      expect(cloneSpy).not.toHaveBeenCalled();
      expect(await response.text()).toBe(firstFrame + contentFrame + completedFrame);
      expect(mocks.recordSuccess).not.toHaveBeenCalled();
    });

    test("raw passthrough 的缺头 Remote Compaction v2 流在 EOF 前提交且完整透传", async () => {
      const provider = createProvider({ id: 1, name: "codex-compact", providerType: "codex" });
      const session = createSession();
      configureCodexResponsesRequest(session);
      session.request.message.input = [{ type: "compaction_trigger" }];
      session.endpointPolicy = resolveEndpointPolicy("/v1/responses/compact");
      session.setProvider(provider);

      const encoder = new TextEncoder();
      const compactionFrame = sseFrame("response.output_item.done", {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "compaction",
          encrypted_content: "opaque-state",
        },
      });
      const completedFrame = sseFrame("response.completed", {
        type: "response.completed",
        response: {
          id: "resp_compact",
          status: "completed",
          output: [{ type: "compaction", encrypted_content: "opaque-state" }],
        },
      });
      let upstreamController: ReadableStreamDefaultController<Uint8Array> | undefined;
      const upstreamResponse = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            upstreamController = controller;
            controller.enqueue(encoder.encode(compactionFrame));
          },
        })
      );
      const cloneSpy = vi.spyOn(upstreamResponse, "clone");
      const doForward = spyOnDoForward();
      doForward.mockResolvedValueOnce(upstreamResponse);

      let timeout: ReturnType<typeof setTimeout> | undefined;
      const response = await Promise.race([
        ProxyForwarder.send(session),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("ProxyForwarder.send waited for raw compaction stream EOF")),
            1_000
          );
        }),
      ]).finally(() => {
        if (timeout) clearTimeout(timeout);
        upstreamController?.enqueue(encoder.encode(completedFrame));
        upstreamController?.close();
      });

      expect(session.getEndpointPolicy().kind).toBe("raw_passthrough");
      expect(upstreamResponse.headers.get("content-type")).toBeNull();
      expect(cloneSpy).not.toHaveBeenCalled();
      expect(await response.text()).toBe(compactionFrame + completedFrame);
      expect(mocks.recordSuccess).not.toHaveBeenCalled();
      expect(mocks.pickRandomProviderWithExclusion).not.toHaveBeenCalled();
    });

    test("门控关闭时缺少 Content-Type 的 JSON 假 200 立即透传，不再等待预提交嗅探", async () => {
      const provider = createProvider({ id: 1, name: "codex-json", providerType: "codex" });
      const session = createSession();
      configureCodexResponsesRequest(session);
      session.setProvider(provider);

      const doForward = spyOnDoForward();
      const body = JSON.stringify({ error: { type: "server_error", message: "upstream failed" } });
      const headerlessJsonError = new Response(new TextEncoder().encode(body));
      expect(headerlessJsonError.headers.get("content-type")).toBeNull();
      doForward.mockResolvedValueOnce(headerlessJsonError);

      const response = await ProxyForwarder.send(session);

      expect(await response.text()).toBe(body);
      expect(doForward).toHaveBeenCalledTimes(1);
      expect(mocks.recordFailure).not.toHaveBeenCalled();
      expect(mocks.pickRandomProviderWithExclusion).not.toHaveBeenCalled();
      expect(session.provider?.id).toBe(provider.id);
    });

    test("raw passthrough 的缺头 JSON 在门控关闭时立即透传", async () => {
      const provider = createProvider({ id: 1, name: "codex-compact", providerType: "codex" });
      const session = createSession();
      configureCodexResponsesRequest(session);
      session.endpointPolicy = resolveEndpointPolicy("/v1/responses/compact");
      session.setProvider(provider);

      const doForward = spyOnDoForward();
      const body = JSON.stringify({ error: { type: "server_error", message: "upstream failed" } });
      const headerlessJson = new Response(new TextEncoder().encode(body));
      expect(headerlessJson.headers.get("content-type")).toBeNull();
      doForward.mockResolvedValueOnce(headerlessJson);

      const response = await ProxyForwarder.send(session);

      expect(await response.text()).toBe(body);
      expect(doForward).toHaveBeenCalledTimes(1);
      expect(mocks.pickRandomProviderWithExclusion).not.toHaveBeenCalled();
      expect(mocks.recordSuccess).not.toHaveBeenCalled();
    });

    test("Legacy Hedge 在门控关闭时让缺头 JSON 以首字节成为赢家", async () => {
      const provider = createProvider({
        id: 1,
        name: "codex-hedge-json",
        providerType: "codex",
        firstByteTimeoutStreamingMs: 100,
      });
      const session = createSession();
      configureCodexResponsesRequest(session);
      session.setProvider(provider);

      const doForward = spyOnDoForward();
      doForward.mockImplementationOnce(async (attemptSession) => {
        attachAttemptRuntime(attemptSession, {
          clearResponseTimeout: vi.fn(),
          releaseAgent: vi.fn(),
        });
        return new Response(
          new TextEncoder().encode(
            JSON.stringify({ error: { type: "server_error", message: "upstream failed" } })
          )
        );
      });
      const body = JSON.stringify({ error: { type: "server_error", message: "upstream failed" } });
      const response = await ProxyForwarder.send(session);

      expect(await response.text()).toBe(body);
      expect(doForward).toHaveBeenCalledTimes(1);
      expect(mocks.recordFailure).not.toHaveBeenCalled();
      expect(mocks.pickRandomProviderWithExclusion).not.toHaveBeenCalled();
      expect(session.provider?.id).toBe(provider.id);
    });

    test.each(["text/html", "application/xhtml+xml"])(
      "Codex Responses 流的 %s 网关页保留 fake-200 检测和供应商切换",
      async (contentType) => {
        const provider1 = createProvider({ id: 1, name: "codex-html-1", providerType: "codex" });
        const provider2 = createProvider({ id: 2, name: "codex-html-2", providerType: "codex" });
        const session = createSession();
        configureCodexResponsesRequest(session);
        session.setProvider(provider1);

        mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);
        const doForward = spyOnDoForward();
        const htmlBody = "<!doctype html><html><body>blocked</body></html>";
        const jsonBody = JSON.stringify({ id: "resp_ok", status: "completed", output: [] });
        doForward.mockResolvedValueOnce(
          new Response(htmlBody, {
            status: 200,
            headers: {
              "content-type": `${contentType}; charset=utf-8`,
              "content-length": String(htmlBody.length),
            },
          })
        );
        doForward.mockResolvedValueOnce(
          new Response(jsonBody, {
            status: 200,
            headers: {
              "content-type": "application/json",
              "content-length": String(jsonBody.length),
            },
          })
        );

        const response = await ProxyForwarder.send(session);

        expect(await response.text()).toBe(jsonBody);
        expect(doForward).toHaveBeenCalledTimes(2);
        expect(mocks.recordFailure).toHaveBeenCalledWith(
          provider1.id,
          expect.objectContaining({ message: "FAKE_200_HTML_BODY" })
        );
        expect(mocks.recordSuccess).not.toHaveBeenCalledWith(provider1.id);
        expect(mocks.recordSuccess).toHaveBeenCalledWith(provider2.id);
      }
    );

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

    test.each(REPLAY_GATE_CASES)(
      "门控关闭时 Replay owner 与普通请求一致：$name 原样透传，不 failover",
      async (testCase) => {
        const provider = createProvider({
          id: 1,
          name: "replay-p1",
          providerType: testCase.providerType,
        });
        const session = createSession();
        session.setProvider(provider);
        attachReplayOwner(session, testCase);

        const failedFrames = testCase.failedFrames();
        const doForward = spyOnDoForward();
        doForward.mockImplementationOnce(async () => createSseResponse(failedFrames));

        const response = await ProxyForwarder.send(session);
        const text = await response.text();

        // 坏流由 response-handler 的协议观察器事后 abort spool（条目不发布），
        // 门控关闭时不再用「零字节 failover」换取首字节延迟。
        expect(doForward).toHaveBeenCalledTimes(1);
        expect(text).toBe(failedFrames.join(""));
        expect(mocks.pickRandomProviderWithExclusion).not.toHaveBeenCalled();
        expect(mocks.recordFailure).not.toHaveBeenCalled();
      }
    );

    test("Legacy Hedge 的 Replay owner 在门控关闭时同样以首字节判定赢家", async () => {
      const provider = createProvider({
        id: 1,
        name: "replay-hedge-ttfb",
        firstByteTimeoutStreamingMs: 50,
      });
      const session = createSession();
      session.setProvider(provider);
      attachReplayOwner(session, REPLAY_GATE_CASES[1]);

      const encoder = new TextEncoder();
      let releaseContent: () => void = () => {};
      const contentHeld = new Promise<void>((resolve) => {
        releaseContent = resolve;
      });
      const doForward = spyOnDoForward();
      doForward.mockImplementationOnce(async (attemptSession) => {
        attachAttemptRuntime(attemptSession, {
          clearResponseTimeout: vi.fn(),
          releaseAgent: vi.fn(),
        });
        return new Response(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              controller.enqueue(encoder.encode(MESSAGE_START_FRAME));
              await contentHeld;
              controller.enqueue(encoder.encode(CONTENT_DELTA_FRAME));
              controller.enqueue(encoder.encode(MESSAGE_STOP_FRAME));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } }
        );
      });

      const sendPromise = ProxyForwarder.send(session);
      const settledBeforeContent = await Promise.race([
        sendPromise.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
      ]);

      releaseContent();
      const response = await sendPromise;
      const text = await response.text();

      expect(settledBeforeContent).toBe(true);
      expect(text).toBe([MESSAGE_START_FRAME, CONTENT_DELTA_FRAME, MESSAGE_STOP_FRAME].join(""));
      expect(doForward).toHaveBeenCalledTimes(1);
    });

    test("Replay owner 在门控关闭时不扣留首字节：内容帧到达前即向客户端提交", async () => {
      const provider = createProvider({ id: 1, name: "replay-ttfb" });
      const session = createSession();
      session.setProvider(provider);
      attachReplayOwner(session, REPLAY_GATE_CASES[1]);

      const encoder = new TextEncoder();
      let releaseContent: () => void = () => {};
      const contentHeld = new Promise<void>((resolve) => {
        releaseContent = resolve;
      });
      const upstream = new ReadableStream<Uint8Array>({
        async start(controller) {
          // 上游立刻吐出中性前缀帧，首个内容帧被人为推迟
          controller.enqueue(encoder.encode(MESSAGE_START_FRAME));
          await contentHeld;
          controller.enqueue(encoder.encode(CONTENT_DELTA_FRAME));
          controller.enqueue(encoder.encode(MESSAGE_STOP_FRAME));
          controller.close();
        },
      });
      const doForward = spyOnDoForward();
      doForward.mockImplementationOnce(
        async () =>
          new Response(upstream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })
      );

      const sendPromise = ProxyForwarder.send(session);
      const settledBeforeContent = await Promise.race([
        sendPromise.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
      ]);

      releaseContent();
      const response = await sendPromise;
      const text = await response.text();

      expect(settledBeforeContent).toBe(true);
      expect(text).toBe([MESSAGE_START_FRAME, CONTENT_DELTA_FRAME, MESSAGE_STOP_FRAME].join(""));
      expect(doForward).toHaveBeenCalledTimes(1);
    });
  });

  describe("STREAM_GATE_MODE=shadow", () => {
    beforeEach(() => {
      envControl.streamGateMode = "shadow";
    });

    test("普通 SSE 在 shadow 模式下内容帧到达前即向客户端提交", async () => {
      const provider = createProvider({ id: 1, name: "shadow-ttfb" });
      const session = createSession();
      session.setProvider(provider);

      const encoder = new TextEncoder();
      let releaseContent: () => void = () => {};
      const contentHeld = new Promise<void>((resolve) => {
        releaseContent = resolve;
      });
      const frames = [MESSAGE_START_FRAME, CONTENT_DELTA_FRAME, MESSAGE_STOP_FRAME];
      const upstream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(frames[0]));
          await contentHeld;
          controller.enqueue(encoder.encode(frames[1]));
          controller.enqueue(encoder.encode(frames[2]));
          controller.close();
        },
      });
      const doForward = spyOnDoForward();
      doForward.mockImplementationOnce(
        async () =>
          new Response(upstream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })
      );

      const sendPromise = ProxyForwarder.send(session);
      const response = await Promise.race([
        sendPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("shadow stream waited for content")), 1_000)
        ),
      ]).finally(() => {
        releaseContent();
      });

      expect(await response.text()).toBe(frames.join(""));
      expect(doForward).toHaveBeenCalledTimes(1);
      expect(mocks.pickRandomProviderWithExclusion).not.toHaveBeenCalled();
    });
  });
});
