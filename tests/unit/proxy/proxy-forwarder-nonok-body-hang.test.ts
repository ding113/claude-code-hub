import { createServer } from "node:http";
import type { Socket } from "node:net";
import { describe, expect, test, vi } from "vitest";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxyError } from "@/app/v1/_lib/proxy/errors";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

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
    providerType: "openai-compatible",
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
    firstByteTimeoutStreamingMs: 30_000,
    streamingIdleTimeoutMs: 10_000,
    requestTimeoutNonStreamingMs: 1_000,
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

function createSession(params?: { clientAbortSignal?: AbortSignal | null }): ProxySession {
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
      model: "gpt-5.2",
      log: "(test)",
      message: {
        model: "gpt-5.2",
        messages: [{ role: "user", content: "hi" }],
      },
    },
    userAgent: null,
    context: null,
    clientAbortSignal: params?.clientAbortSignal ?? null,
    userName: "test-user",
    authState: { success: true, user: null, key: null, apiKey: null },
    provider: null,
    messageContext: null,
    sessionId: null,
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
    isHeaderModified: () => false,
  });

  return session as ProxySession;
}

async function startServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    // 模拟上游异常：返回 403，但永远不结束 body（导致 response.text() 无限等待）
    res.writeHead(403, { "content-type": "application/json" });
    res.write(JSON.stringify({ error: { message: "forbidden" } }));

    // 连接/请求关闭时，主动销毁响应，避免测试进程残留挂起连接（降低 flakiness）
    const cleanup = () => {
      try {
        res.destroy();
      } catch {
        // ignore
      }
    };

    req.on("aborted", cleanup);
    req.on("close", cleanup);
  });

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
    // server.close 只停止接收新连接；这里显式销毁已有 socket，避免挂死/跑飞
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

describe("ProxyForwarder - non-ok response body hang", () => {
  test("HTTP 4xx/5xx 在 body 不结束时也应被超时中断，避免请求悬挂", async () => {
    const { baseUrl, close } = await startServer();
    const clientAbortController = new AbortController();

    try {
      const provider = createProvider({
        url: baseUrl,
        requestTimeoutNonStreamingMs: 200,
      });

      const session = createSession({ clientAbortSignal: clientAbortController.signal });
      session.setProvider(provider);

      // 直接测试 doForward 以隔离单次转发行为，避免 send() 的重试/供应商切换逻辑干扰。
      const doForward = (
        ProxyForwarder as unknown as {
          doForward: (this: typeof ProxyForwarder, ...args: unknown[]) => unknown;
        }
      ).doForward;

      const forwardPromise = doForward.call(
        ProxyForwarder,
        session,
        provider,
        baseUrl
      ) as Promise<Response>;

      const result = await Promise.race([
        forwardPromise.then(
          () => ({ type: "resolved" as const }),
          (error) => ({ type: "rejected" as const, error })
        ),
        new Promise<{ type: "timeout" }>((resolve) =>
          setTimeout(() => resolve({ type: "timeout" as const }), 2_000)
        ),
      ]);

      if (result.type === "timeout") {
        // 兜底：避免回归时测试套件整体挂死
        clientAbortController.abort(new Error("test_timeout"));
        throw new Error("doForward 超时未返回：可能存在非 ok 响应体读取悬挂问题");
      }

      expect(result.type).toBe("rejected");
      expect(result.type === "rejected" ? result.error : null).toBeInstanceOf(ProxyError);

      const err = (result as { type: "rejected"; error: unknown }).error as ProxyError;
      expect(err.statusCode).toBe(403);
    } finally {
      await close();
    }
  });

  test("代理失败降级到直连后也必须恢复 response timeout，避免非 ok 响应体读取悬挂", async () => {
    const { baseUrl, close } = await startServer();
    const clientAbortController = new AbortController();

    try {
      const provider = createProvider({
        url: baseUrl,
        proxyUrl: "http://127.0.0.1:1", // 不可用的代理，触发 fallbackToDirect
        proxyFallbackToDirect: true,
        requestTimeoutNonStreamingMs: 200,
      });

      const session = createSession({ clientAbortSignal: clientAbortController.signal });
      session.setProvider(provider);

      // 直接测试 doForward 以隔离单次转发行为，避免 send() 的重试/供应商切换逻辑干扰。
      const doForward = (
        ProxyForwarder as unknown as {
          doForward: (this: typeof ProxyForwarder, ...args: unknown[]) => unknown;
        }
      ).doForward;

      const forwardPromise = doForward.call(
        ProxyForwarder,
        session,
        provider,
        baseUrl
      ) as Promise<Response>;

      const result = await Promise.race([
        forwardPromise.then(
          () => ({ type: "resolved" as const }),
          (error) => ({ type: "rejected" as const, error })
        ),
        new Promise<{ type: "timeout" }>((resolve) =>
          setTimeout(() => resolve({ type: "timeout" as const }), 2_000)
        ),
      ]);

      if (result.type === "timeout") {
        // 兜底：避免回归时测试套件整体挂死
        clientAbortController.abort(new Error("test_timeout"));
        throw new Error("doForward 超时未返回：可能存在代理降级后 response timeout 未恢复的问题");
      }

      expect(result.type).toBe("rejected");
      expect(result.type === "rejected" ? result.error : null).toBeInstanceOf(ProxyError);

      const err = (result as { type: "rejected"; error: unknown }).error as ProxyError;
      expect(err.statusCode).toBe(403);
    } finally {
      await close();
    }
  });
});
