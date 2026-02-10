import { createServer } from "node:http";
import type { Socket } from "node:net";
import { describe, expect, test, vi } from "vitest";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxyResponseHandler } from "@/app/v1/_lib/proxy/response-handler";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

const asyncTasks: Promise<void>[] = [];

const mocks = vi.hoisted(() => {
  return {
    isHttp2Enabled: vi.fn(async () => false),
  };
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
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestCost: vi.fn(),
  updateMessageRequestDetails: vi.fn(),
  updateMessageRequestDuration: vi.fn(),
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    storeSessionResponse: vi.fn(),
    updateSessionUsage: vi.fn(),
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
): Promise<{ ok: true; value: ReadableStreamReadResult<Uint8Array> } | { ok: false; reason: "timeout" }> {
  const result = await Promise.race([
    reader.read().then((value) => ({ ok: true as const, value })),
    new Promise<{ ok: false; reason: "timeout" }>((resolve) =>
      setTimeout(() => resolve({ ok: false as const, reason: "timeout" }), timeoutMs)
    ),
  ]);
  return result;
}

describe("ProxyResponseHandler - Gemini stream passthrough timeouts", () => {
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
      const session = createSession({ clientAbortSignal: clientAbortController.signal, messageId: 1, userId: 1 });
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

      const firstRead = await readWithTimeout(reader, 1500);
      if (!firstRead.ok) {
        clientAbortController.abort(new Error("test_timeout"));
        throw new Error("首字节超时未生效：读首块数据在 1.5s 内仍未返回（可能仍会卡死）");
      }
    } finally {
      clientAbortController.abort(new Error("test_cleanup"));
      await close();
      await Promise.allSettled(asyncTasks);
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
      res.write("data: {\"x\":1}\n\n");
      setTimeout(() => {
        try {
          res.write("data: {\"x\":2}\n\n");
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
      const session = createSession({ clientAbortSignal: clientAbortController.signal, messageId: 2, userId: 1 });
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
      expect(fullText).toContain("\"x\":2");
    } finally {
      clientAbortController.abort(new Error("test_cleanup"));
      await close();
      await Promise.allSettled(asyncTasks);
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
      res.write("data: {\"x\":1}\n\n");
      // 不再发送数据，也不结束连接
    });

    const clientAbortController = new AbortController();
    try {
      const provider = createProvider({
        url: baseUrl,
        firstByteTimeoutStreamingMs: 1000,
        streamingIdleTimeoutMs: 120,
      });
      const session = createSession({ clientAbortSignal: clientAbortController.signal, messageId: 3, userId: 1 });
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
      expect(first.ok && first.value.done).toBe(false);

      // 静默超时触发后，后续 read 应该在合理时间内结束（done=true 或抛错均可）
      const second = await readWithTimeout(reader, 1500);
      if (!second.ok) {
        clientAbortController.abort(new Error("test_timeout"));
        throw new Error("流式静默超时未生效：读后续数据在 1.5s 内仍未返回（可能仍会卡死）");
      }
    } finally {
      clientAbortController.abort(new Error("test_cleanup"));
      await close();
      await Promise.allSettled(asyncTasks);
    }
  });
});
