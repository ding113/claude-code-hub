import { createServer } from "node:http";
import type { Socket } from "node:net";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import { ProxyResponseHandler } from "@/app/v1/_lib/proxy/response-handler";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import { setDeferredStreamingFinalization } from "@/app/v1/_lib/proxy/stream-finalization";
import { AsyncTaskManager } from "@/lib/async-task-manager";
import { SessionManager } from "@/lib/session-manager";
import {
  updateMessageRequestDetails,
  updateMessageRequestDetailsDurably,
} from "@/repository/message";
import type { Provider } from "@/types/provider";

const asyncTasks: Promise<void>[] = [];

async function expectAllFulfilled(tasks: readonly Promise<unknown>[]): Promise<void> {
  const settlements = await Promise.allSettled(tasks);
  const rejections = settlements
    .filter((settlement): settlement is PromiseRejectedResult => settlement.status === "rejected")
    .map((settlement) => settlement.reason);
  if (rejections.length > 0) {
    throw new AggregateError(rejections, "Unexpected async task rejection");
  }
}

const mocks = vi.hoisted(() => {
  return {
    isHttp2Enabled: vi.fn(async () => false),
  };
});

beforeEach(() => {
  mocks.isHttp2Enabled.mockReset();
  mocks.isHttp2Enabled.mockResolvedValue(false);
});

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    isHttp2Enabled: mocks.isHttp2Enabled,
  };
});

vi.mock("@/app/v1/_lib/proxy/response-fixer", () => ({
  ResponseFixer: {
    process: async (_session: unknown, response: Response) => response,
  },
}));

vi.mock("@/lib/async-task-manager", () => ({
  AsyncTaskManager: {
    register: vi.fn(
      (
        _taskId: string,
        factory: (signal: AbortSignal) => Promise<void>,
        options?: string | { abortController?: AbortController }
      ) => {
        const controller =
          typeof options === "object" && options.abortController
            ? options.abortController
            : new AbortController();
        let promise: Promise<void>;
        try {
          promise = Promise.resolve(factory(controller.signal));
        } catch (error) {
          promise = Promise.reject(error);
        }
        asyncTasks.push(promise);
        return controller;
      }
    ),
    touch: () => true,
    cleanup: () => {},
    cancel: () => {},
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/circuit-breaker", () => ({
  recordFailure: vi.fn(async () => undefined),
  recordSuccess: vi.fn(async () => undefined),
}));

vi.mock("@/lib/endpoint-circuit-breaker", () => ({
  recordEndpointFailure: vi.fn(async () => undefined),
  recordEndpointSuccess: vi.fn(async () => undefined),
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestCost: vi.fn(),
  updateMessageRequestDetails: vi.fn(),
  updateMessageRequestDetailsDurably: vi.fn(),
  updateMessageRequestDuration: vi.fn(),
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn(async () => ({ billingModelSource: "original" })),
}));

vi.mock("@/repository/model-price", () => ({
  findLatestPriceByModel: vi.fn(async () => ({
    priceData: { input_cost_per_token: 0, output_cost_per_token: 0 },
  })),
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    storeSessionResponse: vi.fn(),
    updateSessionUsage: vi.fn(async () => undefined),
    clearSessionProvider: vi.fn(),
    updateSessionBindingSmart: vi.fn(async () => ({ updated: false, reason: "test" })),
    updateSessionProvider: vi.fn(async () => undefined),
    storeSessionRequestPhaseSnapshot: vi.fn(async () => undefined),
    storeSessionResponsePhaseSnapshot: vi.fn(async () => undefined),
    storeSessionUpstreamRequestMeta: vi.fn(async () => undefined),
    storeSessionSpecialSettings: vi.fn(async () => undefined),
    storeSessionRequestHeaders: vi.fn(async () => undefined),
    storeSessionResponseHeaders: vi.fn(async () => undefined),
    storeSessionUpstreamResponseMeta: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: {
    getInstance: () => ({
      endRequest: () => {},
    }),
  },
}));

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 1,
    name: "p1",
    url: "http://127.0.0.1:1",
    key: "k",
    providerVendorId: null,
    isEnabled: true,
    weight: 1,
    priority: 0,
    groupPriorities: null,
    costMultiplier: 1,
    groupTag: null,
    providerType: "gemini",
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
    maxRetryAttempts: null,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerOpenDuration: 1_800_000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingMs: 100,
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
    anthropicMaxTokensPreference: null,
    anthropicThinkingBudgetPreference: null,
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

function createSession(params: {
  clientAbortSignal: AbortSignal;
  messageId: number;
  userId: number;
}): ProxySession {
  const headers = new Headers();
  const session = Object.create(ProxySession.prototype);

  Object.assign(session, {
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("https://example.com/v1/chat/completions"),
    headers,
    originalHeaders: new Headers(headers),
    headerLog: JSON.stringify(Object.fromEntries(headers.entries())),
    request: {
      model: "gemini-2.0-flash",
      log: "(test)",
      message: {
        model: "gemini-2.0-flash",
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      },
    },
    userAgent: null,
    context: null,
    clientAbortSignal: params.clientAbortSignal,
    userName: "test-user",
    authState: { success: true, user: null, key: null, apiKey: null },
    provider: null,
    messageContext: {
      id: params.messageId,
      createdAt: new Date(),
      user: { id: params.userId, name: "u1" },
    },
    sessionId: null,
    requestSequence: 1,
    originalFormat: "gemini",
    providerType: null,
    originalModelName: null,
    originalUrlPathname: null,
    providerChain: [],
    cacheTtlResolved: null,
    context1mApplied: false,
    specialSettings: [],
    cachedPriceData: undefined,
    cachedBillingModelSource: undefined,
    endpointPolicy: resolveEndpointPolicy("/v1/chat/completions"),
    isHeaderModified: () => false,
  });

  return session as ProxySession;
}

async function startSseServer(handler: Parameters<typeof createServer>[0]): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const sockets = new Set<Socket>();
  const server = createServer(handler);

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  const baseUrl = await new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });

  const close = async () => {
    for (const socket of sockets) {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    }
    sockets.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { baseUrl, close };
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<
  | { ok: true; value: ReadableStreamReadResult<Uint8Array> }
  | { ok: true; error: unknown }
  | { ok: false; reason: "timeout" }
> {
  const result = await Promise.race([
    reader
      .read()
      .then((value) => ({ ok: true as const, value }))
      .catch((error) => ({ ok: true as const, error })),
    new Promise<{ ok: false; reason: "timeout" }>((resolve) =>
      setTimeout(() => resolve({ ok: false as const, reason: "timeout" }), timeoutMs)
    ),
  ]);
  return result;
}

describe("ProxyResponseHandler - Gemini stream passthrough timeouts", () => {
  test("非流式早退时应丢弃未消费的 before-snapshot 响应分支", async () => {
    const cancel = vi.fn(async () => undefined);
    const session = createSession({
      clientAbortSignal: new AbortController().signal,
      messageId: 11,
      userId: 22,
    });
    (
      session as ProxySession & {
        detailSnapshotResponseBeforeSource?: { body?: { cancel: typeof cancel } | null } | null;
      }
    ).detailSnapshotResponseBeforeSource = {
      body: { cancel },
    };

    const response = new Response('{"ok":true}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const returned = await (
      ProxyResponseHandler as unknown as {
        handleNonStream: (session: ProxySession, response: Response) => Promise<Response>;
      }
    ).handleNonStream(session, response);

    expect(returned).toBe(response);
    expect(cancel).toHaveBeenCalledOnce();
    expect(
      (session as ProxySession & { detailSnapshotResponseBeforeSource?: unknown })
        .detailSnapshotResponseBeforeSource
    ).toBeNull();
  });

  test("流式早退时应丢弃未消费的 before-snapshot 响应分支", async () => {
    const cancel = vi.fn(async () => undefined);
    const session = createSession({
      clientAbortSignal: new AbortController().signal,
      messageId: 33,
      userId: 44,
    });
    session.setProvider(createProvider());
    session.messageContext = null;
    (
      session as ProxySession & {
        detailSnapshotResponseBeforeSource?: { body?: { cancel: typeof cancel } | null } | null;
      }
    ).detailSnapshotResponseBeforeSource = {
      body: { cancel },
    };

    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"x":1}\n\n'));
          controller.close();
        },
      }),
      {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }
    );

    const returned = await (
      ProxyResponseHandler as unknown as {
        handleStream: (session: ProxySession, response: Response) => Promise<Response>;
      }
    ).handleStream(session, response);

    expect(returned).toBe(response);
    expect(cancel).toHaveBeenCalledOnce();
    expect(
      (session as ProxySession & { detailSnapshotResponseBeforeSource?: unknown })
        .detailSnapshotResponseBeforeSource
    ).toBeNull();
  });

  test("Gemini 流式透传应在泵读取前丢弃 before-snapshot 并保留返回正文", async () => {
    asyncTasks.length = 0;
    const cancel = vi.fn(async () => undefined);
    const session = createSession({
      clientAbortSignal: new AbortController().signal,
      messageId: 55,
      userId: 66,
    });
    const provider = createProvider();
    session.setProvider(provider);
    session.sessionId = null;
    (
      session as ProxySession & {
        detailSnapshotResponseBeforeSource?: { body?: { cancel: typeof cancel } | null } | null;
      }
    ).detailSnapshotResponseBeforeSource = {
      body: { cancel },
    };

    const expectedBody = 'data: {"provider":"gemini"}\n\n';
    const upstreamResponse = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(expectedBody));
          controller.close();
        },
      }),
      {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }
    );

    const returned = await (
      ProxyResponseHandler as unknown as {
        handleStream: (session: ProxySession, response: Response) => Promise<Response>;
      }
    ).handleStream(session, upstreamResponse);

    await expect(returned.text()).resolves.toBe(expectedBody);
    expect(cancel).toHaveBeenCalledOnce();
    expect(
      (session as ProxySession & { detailSnapshotResponseBeforeSource?: unknown })
        .detailSnapshotResponseBeforeSource
    ).toBeNull();

    await expectAllFulfilled(asyncTasks);
  });

  test("Gemini 流式透传禁用 idle timeout 时不应回落到默认 stale cleanup", async () => {
    asyncTasks.length = 0;
    vi.mocked(AsyncTaskManager.register).mockClear();

    const provider = createProvider({
      firstByteTimeoutStreamingMs: 1000,
      streamingIdleTimeoutMs: 0,
    });
    const session = createSession({
      clientAbortSignal: new AbortController().signal,
      messageId: 12,
      userId: 22,
    });
    session.setProvider(provider);

    const upstreamResponse = new Response('data: {"usageMetadata":{"promptTokenCount":1}}\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const returned = await (
      ProxyResponseHandler as unknown as {
        handleStream: (session: ProxySession, response: Response) => Promise<Response>;
      }
    ).handleStream(session, upstreamResponse);

    await returned.text();
    await expectAllFulfilled(asyncTasks);

    const statsRegisterCall = vi.mocked(AsyncTaskManager.register).mock.calls.find((call) => {
      const options = call[2] as { taskType?: string } | undefined;
      return options?.taskType === "stream-passthrough-stats";
    });

    expect(statsRegisterCall).toBeDefined();
    expect(statsRegisterCall?.[2]).toEqual(
      expect.objectContaining({
        staleTimeoutMs: Number.POSITIVE_INFINITY,
      })
    );
  });

  test("不应在仅收到 headers 时清除首字节超时：无首块数据时应在窗口内中断避免悬挂", async () => {
    asyncTasks.length = 0;
    const { baseUrl, close } = await startSseServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.flushHeaders();
      // 不发送任何 body，保持连接不结束
    });

    const clientAbortController = new AbortController();
    try {
      const provider = createProvider({
        url: baseUrl,
        firstByteTimeoutStreamingMs: 200,
      });
      const session = createSession({
        clientAbortSignal: clientAbortController.signal,
        messageId: 1,
        userId: 1,
      });
      session.setProvider(provider);

      const doForward = (
        ProxyForwarder as unknown as {
          doForward: (this: typeof ProxyForwarder, ...args: unknown[]) => unknown;
        }
      ).doForward;

      const upstreamResponse = (await doForward.call(
        ProxyForwarder,
        session,
        provider,
        baseUrl
      )) as Response;

      const clientResponse = await ProxyResponseHandler.dispatch(session, upstreamResponse);
      const reader = clientResponse.body?.getReader();
      expect(reader).toBeTruthy();
      if (!reader) throw new Error("Missing body reader");

      const startedAt = Date.now();
      const firstRead = await readWithTimeout(reader, 1500);
      if (!firstRead.ok) {
        clientAbortController.abort(new Error("test_timeout"));
        throw new Error("首字节超时未生效：读首块数据在 1.5s 内仍未返回（可能仍会卡死）");
      }

      // 断言：应由超时/中断导致读取结束（done=true 或抛错均可）
      const ended = ("value" in firstRead && firstRead.value.done === true) || "error" in firstRead;
      expect(ended).toBe(true);

      // 断言：responseController 应已触发 abort（即首字节超时生效）
      const sessionWithController = session as unknown as { responseController?: AbortController };
      expect(sessionWithController.responseController?.signal.aborted).toBe(true);

      // 粗略时间断言：不应立即返回（避免“无关早退”导致假阳性）
      const elapsed = Date.now() - startedAt;
      expect(elapsed).toBeGreaterThanOrEqual(120);
    } finally {
      clientAbortController.abort(new Error("test_cleanup"));
      await close();
      await expectAllFulfilled(asyncTasks);
    }
  });

  test("收到首块数据后应清除首字节超时：后续 chunk 即使晚于 firstByteTimeout 也不应被误中断", async () => {
    asyncTasks.length = 0;
    const { baseUrl, close } = await startSseServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.flushHeaders();
      res.write('data: {"x":1}\n\n');
      setTimeout(() => {
        try {
          res.write('data: {"x":2}\n\n');
          res.end();
        } catch {
          // ignore
        }
      }, 150);
    });

    const clientAbortController = new AbortController();
    try {
      const provider = createProvider({
        url: baseUrl,
        firstByteTimeoutStreamingMs: 100,
        streamingIdleTimeoutMs: 0,
      });
      const session = createSession({
        clientAbortSignal: clientAbortController.signal,
        messageId: 2,
        userId: 1,
      });
      session.setProvider(provider);

      const doForward = (
        ProxyForwarder as unknown as {
          doForward: (this: typeof ProxyForwarder, ...args: unknown[]) => unknown;
        }
      ).doForward;

      const upstreamResponse = (await doForward.call(
        ProxyForwarder,
        session,
        provider,
        baseUrl
      )) as Response;

      const clientResponse = await ProxyResponseHandler.dispatch(session, upstreamResponse);
      const fullText = await Promise.race([
        clientResponse.text(),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 1500)),
      ]);
      if (fullText === "timeout") {
        clientAbortController.abort(new Error("test_timeout"));
        throw new Error("读取透传响应超时（可能仍会卡死）");
      }

      // 第二块数据在 150ms 发送，若首字节超时未被清除，则 100ms 左右就会被中断拿不到第二块
      expect(fullText).toContain('"x":2');
    } finally {
      clientAbortController.abort(new Error("test_cleanup"));
      await close();
      await expectAllFulfilled(asyncTasks);
    }
  });

  test("中途静默超过 streamingIdleTimeoutMs 时应中断，避免 200 跑到一半卡死", async () => {
    asyncTasks.length = 0;
    const { baseUrl, close } = await startSseServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.flushHeaders();
      res.write('data: {"x":1}\n\n');
      // 不再发送数据，也不结束连接
    });

    const clientAbortController = new AbortController();
    try {
      const provider = createProvider({
        url: baseUrl,
        firstByteTimeoutStreamingMs: 1000,
        streamingIdleTimeoutMs: 120,
      });
      const session = createSession({
        clientAbortSignal: clientAbortController.signal,
        messageId: 3,
        userId: 1,
      });
      session.setProvider(provider);

      const doForward = (
        ProxyForwarder as unknown as {
          doForward: (this: typeof ProxyForwarder, ...args: unknown[]) => unknown;
        }
      ).doForward;

      const upstreamResponse = (await doForward.call(
        ProxyForwarder,
        session,
        provider,
        baseUrl
      )) as Response;

      const clientResponse = await ProxyResponseHandler.dispatch(session, upstreamResponse);
      const reader = clientResponse.body?.getReader();
      expect(reader).toBeTruthy();
      if (!reader) throw new Error("Missing body reader");

      const first = await readWithTimeout(reader, 1000);
      expect(first.ok).toBe(true);
      if (!("value" in first)) {
        throw new Error("首块数据读取异常：预期拿到 value，但得到 error");
      }
      expect(first.value.done).toBe(false);

      // 静默超时触发后，后续 read 应该在合理时间内结束（done=true 或抛错均可）
      const second = await readWithTimeout(reader, 1500);
      if (!second.ok) {
        clientAbortController.abort(new Error("test_timeout"));
        throw new Error("流式静默超时未生效：读后续数据在 1.5s 内仍未返回（可能仍会卡死）");
      }
    } finally {
      clientAbortController.abort(new Error("test_cleanup"));
      await close();
      await expectAllFulfilled(asyncTasks);
    }
  });

  test("客户端中断流式透传后应清理 session provider 绑定，避免下次继续复用旧供应商", async () => {
    asyncTasks.length = 0;
    const { baseUrl, close } = await startSseServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.flushHeaders();
      res.write('data: {"x":1}\n\n');
      setTimeout(() => {
        try {
          res.write('data: {"x":2}\n\n');
        } catch {
          // ignore
        }
      }, 1000);
    });

    const clientAbortController = new AbortController();
    vi.mocked(SessionManager.clearSessionProvider).mockResolvedValue(undefined);

    try {
      const provider = createProvider({
        url: baseUrl,
        firstByteTimeoutStreamingMs: 1000,
        streamingIdleTimeoutMs: 0,
      });
      const session = createSession({
        clientAbortSignal: clientAbortController.signal,
        messageId: 4,
        userId: 1,
      });
      session.setProvider(provider);
      session.setSessionId("gemini-abort-session");

      const doForward = (
        ProxyForwarder as unknown as {
          doForward: (this: typeof ProxyForwarder, ...args: unknown[]) => unknown;
        }
      ).doForward;

      const upstreamResponse = (await doForward.call(
        ProxyForwarder,
        session,
        provider,
        baseUrl
      )) as Response;

      const clientResponse = await ProxyResponseHandler.dispatch(session, upstreamResponse);
      const reader = clientResponse.body?.getReader();
      expect(reader).toBeTruthy();
      if (!reader) throw new Error("Missing body reader");

      const first = await reader.read();
      expect(first.done).toBe(false);

      clientAbortController.abort(new Error("client_cancelled"));
      await expectAllFulfilled(asyncTasks);

      expect(vi.mocked(SessionManager.clearSessionProvider)).toHaveBeenCalledWith(
        "gemini-abort-session"
      );
    } finally {
      clientAbortController.abort(new Error("test_cleanup"));
      await close();
      await expectAllFulfilled(asyncTasks);
    }
  });

  test("Gemini 流式透传超大单 chunk 应保留尾部 usage 且不把截断快照作为完整正文存储", async () => {
    asyncTasks.length = 0;
    vi.mocked(SessionManager.storeSessionResponse).mockClear();
    vi.mocked(updateMessageRequestDetailsDurably).mockClear();

    const clientAbortController = new AbortController();
    const provider = createProvider({
      firstByteTimeoutStreamingMs: 1000,
      streamingIdleTimeoutMs: 0,
    });
    const session = createSession({
      clientAbortSignal: clientAbortController.signal,
      messageId: 77,
      userId: 1,
    });
    session.setProvider(provider);
    session.setSessionId("gemini-large-single-chunk");
    (
      session as ProxySession & {
        shouldPersistSessionDebugArtifacts?: () => boolean;
      }
    ).shouldPersistSessionDebugArtifacts = () => true;

    const hugeText = "x".repeat(11 * 1024 * 1024);
    const bodyText = `data: {"text":"${hugeText}"}\n\ndata: {"usageMetadata":{"promptTokenCount":463,"candidatesTokenCount":11}}\n\n`;
    const bodyBytes = new TextEncoder().encode(bodyText);

    const upstreamResponse = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bodyBytes);
          controller.close();
        },
      }),
      {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }
    );

    const returned = await (
      ProxyResponseHandler as unknown as {
        handleStream: (session: ProxySession, response: Response) => Promise<Response>;
      }
    ).handleStream(session, upstreamResponse);

    await returned.text();
    await expectAllFulfilled(asyncTasks);

    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      77,
      expect.objectContaining({
        statusCode: 200,
        inputTokens: 463,
        outputTokens: 11,
      })
    );
    expect(SessionManager.storeSessionResponse).not.toHaveBeenCalled();
  });

  test("Gemini 终态副作用挂起时应先释放传输资源并在共享 deadline 后收敛", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    asyncTasks.length = 0;
    vi.mocked(updateMessageRequestDetailsDurably).mockClear();
    vi.mocked(SessionManager.clearSessionProvider).mockClear();
    const releaseAgent = vi.fn();
    vi.mocked(SessionManager.clearSessionProvider).mockImplementationOnce(() => {
      return new Promise(() => {});
    });

    try {
      const session = createSession({
        clientAbortSignal: new AbortController().signal,
        messageId: 88,
        userId: 1,
      });
      const provider = createProvider({
        firstByteTimeoutStreamingMs: 1000,
        streamingIdleTimeoutMs: 0,
      });
      session.setProvider(provider);
      session.setSessionId("gemini-post-terminal-deadline");
      Object.assign(session, { releaseAgent });
      setDeferredStreamingFinalization(session, {
        providerId: provider.id,
        providerName: provider.name,
        providerPriority: provider.priority,
        attemptNumber: 1,
        totalProvidersAttempted: 1,
        isFirstAttempt: true,
        isFailoverSuccess: false,
        endpointId: 42,
        endpointUrl: "https://api.test.invalid/v1",
        upstreamStatusCode: 500,
      });

      const bodyText =
        'data: {"usageMetadata":{"promptTokenCount":463,"candidatesTokenCount":11}}\n\n';
      const response = new Response(bodyText, {
        status: 500,
        headers: { "content-type": "text/event-stream" },
      });
      const returned = await (
        ProxyResponseHandler as unknown as {
          handleStream: (session: ProxySession, response: Response) => Promise<Response>;
        }
      ).handleStream(session, response);

      await returned.text();
      for (
        let attempt = 0;
        attempt < 20 && vi.mocked(SessionManager.clearSessionProvider).mock.calls.length === 0;
        attempt++
      ) {
        await vi.advanceTimersByTimeAsync(1);
      }
      expect(updateMessageRequestDetailsDurably).toHaveBeenCalledTimes(1);
      expect(SessionManager.clearSessionProvider).toHaveBeenCalledTimes(1);
      expect(releaseAgent).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(120_000);
      await expectAllFulfilled(asyncTasks.splice(0, asyncTasks.length));

      expect(releaseAgent).toHaveBeenCalledTimes(1);
      expect(updateMessageRequestDetailsDurably).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
