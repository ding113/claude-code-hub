import { createServer } from "node:http";
import type { Socket } from "node:net";
import { describe, expect, test, vi } from "vitest";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
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
    name: "test-chunked",
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
    endpointPolicy: resolveEndpointPolicy("/v1/chat/completions"),
    isHeaderModified: () => false,
  });

  return session as ProxySession;
}

/**
 * Start a local server that returns 200 + application/json + chunked body (no Content-Length).
 * The body is larger than 32 KiB to trigger the truncated path in readResponseTextUpTo.
 */
async function startChunkedServer(
  bodySize: number
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();

  const server = createServer((_req, res) => {
    // Chunked transfer encoding: write headers without Content-Length,
    // then write body in multiple chunks.
    res.writeHead(200, { "content-type": "application/json" });

    // Build a valid JSON body larger than bodySize.
    // Use a simple structure: {"data":"AAAA..."}
    const padding = "A".repeat(bodySize);
    const body = JSON.stringify({ data: padding });

    // Write in ~4KB chunks to simulate realistic chunked transfer
    const chunkSize = 4096;
    let offset = 0;
    const writeNext = () => {
      while (offset < body.length) {
        const slice = body.slice(offset, offset + chunkSize);
        offset += chunkSize;
        if (!res.write(slice)) {
          res.once("drain", writeNext);
          return;
        }
      }
      res.end();
    };
    writeNext();
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

describe("ProxyForwarder - large chunked non-streaming response", () => {
  test("200 + chunked + no Content-Length + >32KiB body must not hang on body inspection", async () => {
    // 64 KiB body: well above the 32 KiB inspection limit to trigger truncated + cancel
    const { baseUrl, close } = await startChunkedServer(64 * 1024);
    const clientAbortController = new AbortController();

    try {
      const provider = createProvider({
        url: baseUrl,
        // Disable response timeout so the only thing that can hang is readResponseTextUpTo
        requestTimeoutNonStreamingMs: 0,
      });

      const session = createSession({ clientAbortSignal: clientAbortController.signal });
      session.setProvider(provider);

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
          (response) => ({ type: "resolved" as const, response: response as Response }),
          (error) => ({ type: "rejected" as const, error })
        ),
        new Promise<{ type: "timeout" }>((resolve) =>
          setTimeout(() => resolve({ type: "timeout" as const }), 5_000)
        ),
      ]);

      if (result.type === "timeout") {
        clientAbortController.abort(new Error("test_timeout"));
        throw new Error(
          "doForward timed out: readResponseTextUpTo likely blocking on reader.cancel() for large chunked response"
        );
      }

      // doForward should resolve successfully (200 response)
      expect(result.type).toBe("resolved");
      const response = (result as { type: "resolved"; response: Response }).response;
      expect(response.status).toBe(200);

      // The response body must be fully readable by the client
      const bodyText = await response.text();
      expect(bodyText.length).toBeGreaterThan(64 * 1024);

      const parsed = JSON.parse(bodyText);
      expect(parsed.data).toBeDefined();
    } finally {
      await close();
    }
  });
});
