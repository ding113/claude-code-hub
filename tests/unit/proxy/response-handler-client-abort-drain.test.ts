import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import {
  BoundedStreamTextAccumulator,
  ProxyResponseHandler,
} from "@/app/v1/_lib/proxy/response-handler";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import {
  peekDeferredStreamingFinalization,
  setDeferredStreamingFinalization,
} from "@/app/v1/_lib/proxy/stream-finalization";
import { AsyncTaskManager, shutdownAllAsyncTasks } from "@/lib/async-task-manager";
import { recordFailure } from "@/lib/circuit-breaker";
import { emitProxyLangfuseTrace } from "@/lib/langfuse/emit-proxy-trace";
import { RateLimitService } from "@/lib/rate-limit";
import type { SessionBindingSnapshot } from "@/lib/redis/session-binding";
import { SessionManager } from "@/lib/session-manager";
import {
  updateMessageRequestCostWithBreakdown,
  updateMessageRequestDetails,
  updateMessageRequestDetailsDurably,
  updateMessageRequestDetailsIfUnfinalized,
  updateMessageRequestDuration,
} from "@/repository/message";
import type { Provider } from "@/types/provider";

const asyncTasks: Promise<void>[] = [];
const registeredTasks: Array<{ taskType: string; promise: Promise<void> }> = [];
const STREAM_STATS_HEAD_BYTES_FOR_TEST = 1024 * 1024;

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
        options?: string | { abortController?: AbortController; taskType?: string }
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
        registeredTasks.push({
          taskType: typeof options === "object" ? (options.taskType ?? "unknown") : "unknown",
          promise,
        });
        return controller;
      }
    ),
    touch: vi.fn(() => true),
    cleanup: vi.fn(),
    cancel: vi.fn(),
  },
  shutdownAllAsyncTasks: vi.fn(async () => {
    while (asyncTasks.length > 0) {
      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await Promise.allSettled(tasks);
    }
  }),
}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: vi.fn(async () => ({
    billNonSuccessfulRequests: false,
  })),
}));

vi.mock("@/lib/langfuse/emit-proxy-trace", () => ({
  emitProxyLangfuseTrace: vi.fn(),
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

vi.mock("@/lib/price-sync/cloud-price-updater", () => ({
  requestCloudPriceTableSync: vi.fn(),
}));

vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: {
    getInstance: () => ({
      endRequest: vi.fn(),
    }),
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  RateLimitService: {
    trackCost: vi.fn(),
    trackUserDailyCost: vi.fn(),
    decrementLeaseBudget: vi.fn(),
    settleLeaseBudgets: vi.fn(),
    releaseProviderSession: vi.fn(),
  },
}));

vi.mock("@/lib/redis/live-chain-store", () => ({
  deleteLiveChain: vi.fn(),
  writeLiveRoutingTrace: vi.fn(),
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    clearSessionProvider: vi.fn(),
    clearVersionedSessionProvider: vi.fn(),
    compareAndSetSessionProvider: vi.fn(),
    getSessionBindingSnapshot: vi.fn(),
    getVersionedSessionBindingRefreshIntervalMs: vi.fn(() => 100_000),
    renewSessionDiscoveryLease: vi.fn(async () => ({
      status: "renewed",
      legacyFallbackAllowed: false,
    })),
    releaseSessionDiscoveryLease: vi.fn(async () => ({
      status: "released",
      legacyFallbackAllowed: false,
    })),
    touchVersionedSessionBinding: vi.fn(async (snapshot: SessionBindingSnapshot) => ({
      status: "ok",
      source: "touched",
      snapshot,
      legacyFallbackAllowed: false,
    })),
    extractCodexPromptCacheKey: vi.fn(),
    storeSessionResponse: vi.fn(async () => undefined),
    storeSessionRequestPhaseSnapshot: vi.fn(),
    storeSessionResponsePhaseSnapshot: vi.fn(),
    storeSessionRequestHeaders: vi.fn(),
    storeSessionResponseHeaders: vi.fn(),
    storeSessionSpecialSettings: vi.fn(),
    storeSessionUpstreamRequestMeta: vi.fn(),
    storeSessionUpstreamResponseMeta: vi.fn(),
    updateSessionProvider: vi.fn(),
    updateSessionUsage: vi.fn(),
    updateSessionBindingSmart: vi.fn(async () => ({
      updated: false,
      reason: "test",
    })),
    updateSessionWithCodexCacheKey: vi.fn(),
  },
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    refreshSession: vi.fn(),
  },
}));

vi.mock("@/lib/circuit-breaker", () => ({
  recordFailure: vi.fn(),
  recordSuccess: vi.fn(),
}));

vi.mock("@/lib/endpoint-circuit-breaker", () => ({
  recordEndpointFailure: vi.fn(),
  recordEndpointSuccess: vi.fn(),
  resetEndpointCircuit: vi.fn(),
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestCostWithBreakdown: vi.fn(),
  updateMessageRequestDetails: vi.fn(),
  updateMessageRequestDetailsDurably: vi.fn(),
  updateMessageRequestDetailsIfUnfinalized: vi.fn(),
  updateMessageRequestDuration: vi.fn(),
}));

function createProvider(): Provider {
  return {
    id: 1,
    name: "avemujica-responses",
    url: "https://api.test.invalid/v1",
    key: "sk-test",
    providerVendorId: null,
    providerType: "codex",
    isEnabled: true,
    weight: 1,
    priority: 1,
    groupPriorities: null,
    costMultiplier: 1,
    groupTag: "OpenAI",
    modelRedirects: null,
    allowedModels: null,
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
    preserveClientIp: false,
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
  } as Provider;
}

function createSession(
  signal: AbortSignal,
  overrides: {
    providerType?: string;
    originalFormat?: string;
    endpoint?: string;
    model?: string;
  } = {}
): ProxySession {
  const provider = createProvider();
  if (overrides.providerType) {
    (provider as { providerType: string }).providerType = overrides.providerType;
  }
  const originalFormat = overrides.originalFormat ?? "response";
  const endpoint = overrides.endpoint ?? "/v1/responses";
  const model = overrides.model ?? "gpt-5.4-mini";
  const user = { id: 1, name: "admin" };
  const key = { id: 2, name: "Omni" };
  const session = Object.create(ProxySession.prototype) as ProxySession;

  Object.assign(session, {
    authState: { success: true, user, key, apiKey: "sk-test" },
    cacheTtlResolved: null,
    clientAbortSignal: signal,
    context: {},
    context1mApplied: false,
    forwardedRequestBody: "",
    headerLog: "",
    headers: new Headers(),
    method: "POST",
    messageContext: {
      id: 123,
      createdAt: new Date(),
      user,
      key,
      apiKey: "sk-test",
    },
    originalFormat,
    originalModelName: model,
    originalUrlPathname: endpoint,
    provider,
    providerChain: [],
    providerType: overrides.providerType ?? "codex",
    request: {
      log: "",
      message: { model, stream: true },
      model,
    },
    requestSequence: 1,
    requestUrl: new URL(`http://localhost${endpoint}`),
    sessionId: null,
    specialSettings: [],
    startTime: Date.now(),
    ttfbMs: null,
    userAgent: "Go-http-client/1.1",
    userName: "admin",
    addProviderToChain(this: ProxySession & { providerChain: unknown[] }, prov: Provider, meta) {
      this.providerChain.push({
        id: prov.id,
        name: prov.name,
        ...(meta ?? {}),
      });
    },
    clearResponseTimeout: vi.fn(),
    getContext1mApplied: () => false,
    getCurrentModel: () => model,
    getEndpoint: () => endpoint,
    getEndpointPolicy: () => resolveEndpointPolicy(endpoint),
    getGroupCostMultiplier: () => 1,
    getOriginalModel: () => model,
    getProviderChain: () => session.providerChain,
    getResolvedPricingByBillingSource: async () => null,
    getSpecialSettings: () => [],
    isHeaderModified: () => false,
    recordTtfb: vi.fn(),
    releaseAgent: vi.fn(),
    setContext1mApplied: vi.fn(),
    shouldPersistSessionDebugArtifacts: () => false,
    shouldTrackSessionObservability: () => false,
  });

  return session;
}

function createResponsesSse(): Response {
  const body = [
    `event: response.output_text.done\ndata: ${JSON.stringify({
      type: "response.output_text.done",
      text: "短标题",
    })}`,
    `event: response.completed\ndata: ${JSON.stringify({
      type: "response.completed",
      response: {
        id: "resp_test",
        model: "gpt-5.4-mini-2026-03-17",
        usage: {
          input_tokens: 463,
          output_tokens: 11,
        },
      },
    })}`,
    "",
  ].join("\n\n");

  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function createPullTrackedResponsesSse(): {
  response: Response;
  getPullCount: () => number;
} {
  const encoder = new TextEncoder();
  const totalChunks = 32;
  let index = 0;
  let pullCount = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pullCount++;
      if (index < totalChunks - 1) {
        controller.enqueue(
          encoder.encode(
            `event: response.output_text.delta\ndata: ${JSON.stringify({
              type: "response.output_text.delta",
              delta: `chunk-${index++}`,
            })}\n\n`
          )
        );
        return;
      }
      if (index++ === totalChunks - 1) {
        controller.enqueue(
          encoder.encode(
            `event: response.completed\ndata: ${JSON.stringify({
              type: "response.completed",
              response: {
                id: "resp_pull_tracked",
                model: "gpt-5.4-mini-2026-03-17",
                usage: { input_tokens: 463, output_tokens: 11 },
              },
            })}\n\n`
          )
        );
        return;
      }
      controller.close();
    },
  });

  return {
    response: new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    getPullCount: () => pullCount,
  };
}

function createControllableTransportErrorResponsesSse(): {
  response: Response;
  fail: () => void;
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });

  return {
    response: new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    fail() {
      const error = Object.assign(new Error("socket closed after client cancel"), {
        code: "ECONNRESET",
      });
      controller?.error(error);
    },
  };
}

function createControllableEmptyResponsesSse(): {
  response: Response;
  close: () => void;
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });

  return {
    response: new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    close() {
      try {
        controller?.close();
      } catch {
        // The timeout hard-cancel path may already have closed the source.
      }
    },
  };
}

function createControllableIdleTimeoutResponsesSse(): {
  response: Response;
  failIdle: () => void;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      streamController.enqueue(
        encoder.encode(
          `event: response.output_text.delta\ndata: ${JSON.stringify({
            type: "response.output_text.delta",
            delta: "partial",
          })}\n\n`
        )
      );
    },
  });

  return {
    response: new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    failIdle() {
      const error = new Error("streaming_idle");
      error.name = "AbortError";
      controller?.error(error);
    },
  };
}

function createAbortInsensitiveHangingResponsesSse(): {
  response: Response;
  close: () => void;
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });

  return {
    response: new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    close() {
      try {
        controller?.close();
      } catch {
        // The hard-cap path may already have cancelled and closed the source.
      }
    },
  };
}

function createAbortInsensitivePostChunkHangingResponsesSse(): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `event: response.output_text.delta\ndata: ${JSON.stringify({
              type: "response.output_text.delta",
              delta: "first",
            })}\n\n`
          )
        );
      },
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }
  );
}

function createEmptyResponsesSse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }
  );
}

function createResponsesJson(): Response {
  return new Response(
    JSON.stringify({
      id: "resp_non_stream",
      model: "gpt-5.4-mini-2026-03-17",
      usage: {
        input_tokens: 463,
        output_tokens: 11,
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

function createOversizedResponsesSse(): Response {
  const oversizedDelta = "x".repeat(11 * 1024 * 1024);
  const body = [
    `event: response.output_text.delta\ndata: ${JSON.stringify({
      type: "response.output_text.delta",
      delta: oversizedDelta,
    })}`,
    `event: response.completed\ndata: ${JSON.stringify({
      type: "response.completed",
      response: {
        id: "resp_large",
        model: "gpt-5.4-mini-2026-03-17",
        usage: {
          input_tokens: 463,
          output_tokens: 11,
        },
      },
    })}`,
    "",
  ].join("\n\n");

  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function createUtf8SplitHeadTailResponsesSse(): Response {
  const encoder = new TextEncoder();
  const eventPrefix = `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"`;
  const splitChar = "界";
  const prefixBytes = encoder.encode(eventPrefix).byteLength;
  const fillBytes = STREAM_STATS_HEAD_BYTES_FOR_TEST - prefixBytes - 1;
  if (fillBytes < 0) {
    throw new Error("test event prefix is too large for the head window");
  }

  const completedEvent = `event: response.completed\ndata: ${JSON.stringify({
    type: "response.completed",
    response: {
      id: "resp_utf8_boundary",
      model: "gpt-5.4-mini-2026-03-17",
      usage: {
        input_tokens: 463,
        output_tokens: 11,
      },
    },
  })}\n\n`;
  const body = `${eventPrefix}${"a".repeat(fillBytes)}${splitChar}"}\n\n${completedEvent}`;
  const chunk = encoder.encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk);
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function createSplitTailBoundaryResponsesSse(): Response {
  const encoder = new TextEncoder();
  const completedEvent = `event: response.completed\ndata: ${JSON.stringify({
    type: "response.completed",
    response: {
      id: "resp_split_tail",
      model: "gpt-5.4-mini-2026-03-17",
      usage: {
        input_tokens: 463,
        output_tokens: 11,
      },
    },
  })}\n\n`;
  const splitAt = Math.floor(completedEvent.length / 2);
  const firstChunk = encoder.encode(
    `event: response.output_text.delta\ndata: ${JSON.stringify({
      type: "response.output_text.delta",
      delta: "x".repeat(9 * 1024 * 1024),
    })}\n\n${completedEvent.slice(0, splitAt)}`
  );
  const secondChunk = encoder.encode(
    `${completedEvent.slice(splitAt)}event: response.output_text.delta\ndata: ${JSON.stringify({
      type: "response.output_text.delta",
      delta: "y".repeat(2 * 1024 * 1024),
    })}\n\n`
  );
  const chunks = [firstChunk, secondChunk];
  let index = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
        return;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function createErroredResponsesSse(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `event: response.output_text.delta\ndata: ${JSON.stringify({
            type: "response.output_text.delta",
            delta: "短",
          })}\n\n`
        )
      );
      const error = new Error("Response transmission interrupted");
      error.name = "ResponseAborted";
      controller.error(error);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function createHangingResponsesSse(upstreamSignal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `event: response.output_text.delta\ndata: ${JSON.stringify({
            type: "response.output_text.delta",
            delta: "短",
          })}\n\n`
        )
      );
      upstreamSignal.addEventListener(
        "abort",
        () => {
          const error = new Error("client_abort_drain_timeout");
          error.name = "AbortError";
          controller.error(error);
        },
        { once: true }
      );
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function createPreBodyHangingResponsesSse(upstreamSignal: AbortSignal): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      upstreamSignal.addEventListener(
        "abort",
        () => {
          const error = new Error("streaming_idle");
          error.name = "AbortError";
          controller.error(error);
        },
        { once: true }
      );
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function createActiveHangingResponsesSse(upstreamSignal: AbortSignal): Response {
  const encoder = new TextEncoder();
  let index = 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const encodeChunk = (delta: string) =>
    encoder.encode(
      `event: response.output_text.delta\ndata: ${JSON.stringify({
        type: "response.output_text.delta",
        delta,
      })}\n\n`
    );

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encodeChunk("短"));
      intervalId = setInterval(() => {
        controller.enqueue(encodeChunk(`持续-${++index}`));
      }, 4_000);
      upstreamSignal.addEventListener(
        "abort",
        () => {
          if (intervalId) clearInterval(intervalId);
          const error = new Error("client_abort_drain_timeout");
          error.name = "AbortError";
          controller.error(error);
        },
        { once: true }
      );
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function createCompletedThenErroredResponsesSse(): Response {
  const encoder = new TextEncoder();
  const chunks = [
    `event: response.output_text.done\ndata: ${JSON.stringify({
      type: "response.output_text.done",
      text: "短标题",
    })}\n\n`,
    `event: response.completed\ndata: ${JSON.stringify({
      type: "response.completed",
      response: {
        id: "resp_test",
        model: "gpt-5.4-mini-2026-03-17",
        usage: {
          input_tokens: 463,
          output_tokens: 11,
        },
      },
    })}\n\n`,
  ];
  let index = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
        return;
      }

      const error = new Error("Response transmission interrupted after final usage");
      error.name = "ResponseAborted";
      controller.error(error);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

// U01: Anthropic streams carry usage in the FIRST `message_start` event, so a
// truncated mid-stream abort already has positive billable tokens. Without a
// completion marker it must NOT be reclassified as a 200 success.
function createTruncatedClaudeSse(): Response {
  const encoder = new TextEncoder();
  // pull-based so the enqueued chunks are actually delivered to the internal
  // (tee'd) branch before the error surfaces — a synchronous enqueue+error in
  // start() would drop them and the body would read as empty.
  const chunks = [
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: {
        id: "msg_test",
        model: "claude-x",
        usage: { input_tokens: 463, output_tokens: 1 },
      },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "部分" },
    })}\n\n`,
  ];
  let index = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
        return;
      }
      // Truncated mid-stream: no message_delta, no terminal message_stop.
      const error = new Error("Response transmission interrupted");
      error.name = "ResponseAborted";
      controller.error(error);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

// A genuinely complete Claude stream (terminal `message_stop`) whose socket is
// then dropped by the already-departed client must still bill as success.
function createCompletedThenAbortedClaudeSse(): Response {
  const encoder = new TextEncoder();
  const chunks = [
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: {
        id: "msg_test",
        model: "claude-x",
        usage: { input_tokens: 463, output_tokens: 1 },
      },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "完整" },
    })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 11 },
    })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  ];
  let index = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
        return;
      }
      const error = new Error("Response transmission interrupted after message_stop");
      error.name = "ResponseAborted";
      controller.error(error);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function expectAllFulfilled(tasks: readonly Promise<unknown>[]): Promise<void> {
  const settlements = await Promise.allSettled(tasks);
  const rejections = settlements
    .filter((settlement): settlement is PromiseRejectedResult => settlement.status === "rejected")
    .map((settlement) => settlement.reason);
  if (rejections.length > 0) {
    throw new AggregateError(rejections, "Unexpected async task rejection");
  }
}

async function drainAsyncTasks(): Promise<void> {
  while (asyncTasks.length > 0) {
    const tasks = asyncTasks.splice(0, asyncTasks.length);
    await expectAllFulfilled(tasks);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function getRegisteredTask(taskType: string): Promise<void> | undefined {
  return registeredTasks.filter((task) => task.taskType === taskType).at(-1)?.promise;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createRecoveryContinuationResponse(contentType: string): Response {
  const processingError = new Error("upstream body processing failed");
  let nameReads = 0;
  Object.defineProperty(processingError, "name", {
    configurable: true,
    get() {
      nameReads++;
      if (nameReads === 1) {
        throw new Error("error classification failed");
      }
      return "Error";
    },
  });

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(processingError);
      },
    }),
    {
      status: 200,
      headers: { "content-type": contentType },
    }
  );
}

async function expectPromiseToRemainPending(promise: Promise<unknown>): Promise<void> {
  let outcome: "pending" | "resolved" | "rejected" = "pending";
  void promise.then(
    () => {
      outcome = "resolved";
    },
    () => {
      outcome = "rejected";
    }
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(outcome).toBe("pending");
}

async function expectTaskToResolveWithoutWaiting(promise: Promise<void>): Promise<void> {
  let outcome: "pending" | "resolved" | "rejected" = "pending";
  void promise.then(
    () => {
      outcome = "resolved";
    },
    () => {
      outcome = "rejected";
    }
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(outcome).toBe("resolved");
}

function publishCommitObserver(
  details: Parameters<typeof updateMessageRequestDetailsDurably>[1],
  options: Parameters<typeof updateMessageRequestDetailsDurably>[2]
): void {
  try {
    const result = options?.onCommitted?.(details);
    if (result) void Promise.resolve(result).catch(() => undefined);
  } catch {
    // Test mock mirrors the repository's commit-observer boundary.
  }
}

function createAbortableNonStreamResponse(signal: AbortSignal): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const abort = () => {
        const reason =
          signal.reason instanceof Error ? signal.reason : new Error("non-stream response aborted");
        controller.error(reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("ProxyResponseHandler stream client abort finalization", () => {
  beforeEach(() => {
    asyncTasks.splice(0, asyncTasks.length);
    registeredTasks.splice(0, registeredTasks.length);
    vi.clearAllMocks();
    vi.mocked(updateMessageRequestDetailsDurably).mockImplementation(
      async (_id, details, options) => {
        try {
          const result = options?.onCommitted?.(details);
          if (result) void Promise.resolve(result).catch(() => undefined);
        } catch {
          // Test mock mirrors the repository's commit-observer boundary.
        }
        return true;
      }
    );
    vi.mocked(updateMessageRequestDetailsIfUnfinalized).mockImplementation(
      async (_id, details, options) => {
        try {
          const result = options?.onCommitted?.(details);
          if (result) void Promise.resolve(result).catch(() => undefined);
        } catch {
          // Test mock mirrors the repository's commit-observer boundary.
        }
        return true;
      }
    );
  });

  it("propagates unexpected registered task rejections during drain", async () => {
    const failure = new Error("factory task failed");
    AsyncTaskManager.register("rejecting-test-task", async () => {
      throw failure;
    });

    let rejection: unknown;
    try {
      await drainAsyncTasks();
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(AggregateError);
    expect((rejection as AggregateError).errors).toEqual([failure]);
  });

  it("keeps shutdown pending until generic non-stream recovery persistence settles", async () => {
    const recoveryStarted = createDeferred<void>();
    const releaseRecovery = createDeferred<void>();
    vi.mocked(updateMessageRequestDetailsIfUnfinalized).mockImplementationOnce(async () => {
      recoveryStarted.resolve();
      await releaseRecovery.promise;
      return true;
    });
    let shutdownPromise: Promise<void> | undefined;

    try {
      const session = createSession(new AbortController().signal);
      const response = await ProxyResponseHandler.dispatch(
        session,
        createRecoveryContinuationResponse("application/json")
      );

      expect(response.status).toBe(200);
      await recoveryStarted.promise;
      const processingTask = getRegisteredTask("non-stream-processing");
      expect(processingTask).toBeDefined();
      shutdownPromise = shutdownAllAsyncTasks();

      await expectPromiseToRemainPending(shutdownPromise);
      expect(updateMessageRequestDetails).not.toHaveBeenCalled();
      expect(updateMessageRequestDetailsIfUnfinalized).toHaveBeenCalledTimes(1);

      releaseRecovery.resolve();
      await shutdownPromise;
      await expect(processingTask).rejects.toThrow("error classification failed");

      expect(updateMessageRequestDetailsIfUnfinalized).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          durationMs: expect.any(Number),
          statusCode: 500,
          errorMessage: "Error: error classification failed",
        })
      );
    } finally {
      releaseRecovery.resolve();
      await shutdownPromise?.catch(() => {});
      await drainAsyncTasks();
    }
  });

  it("keeps shutdown pending until generic stream recovery persistence settles", async () => {
    const recoveryStarted = createDeferred<void>();
    const releaseRecovery = createDeferred<void>();
    vi.mocked(updateMessageRequestDetailsIfUnfinalized).mockImplementationOnce(async () => {
      recoveryStarted.resolve();
      await releaseRecovery.promise;
      return true;
    });
    let downstreamRead: Promise<string> | undefined;
    let shutdownPromise: Promise<void> | undefined;

    try {
      const session = createSession(new AbortController().signal);
      const response = await ProxyResponseHandler.dispatch(
        session,
        createRecoveryContinuationResponse("text/event-stream")
      );

      expect(response.status).toBe(200);
      downstreamRead = response.text().catch(() => "stream failed");
      await recoveryStarted.promise;
      const processingTask = getRegisteredTask("stream-processing");
      expect(processingTask).toBeDefined();
      shutdownPromise = shutdownAllAsyncTasks();

      await expectPromiseToRemainPending(shutdownPromise);
      expect(updateMessageRequestDetailsIfUnfinalized).toHaveBeenCalledTimes(1);

      releaseRecovery.resolve();
      await shutdownPromise;
      await downstreamRead;
      await expect(processingTask).rejects.toThrow("error classification failed");

      expect(updateMessageRequestDetailsIfUnfinalized).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          durationMs: expect.any(Number),
          statusCode: 500,
          errorMessage: "Error: error classification failed",
        }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
    } finally {
      releaseRecovery.resolve();
      await shutdownPromise?.catch(() => {});
      await downstreamRead?.catch(() => {});
      await drainAsyncTasks();
    }
  });

  it("copies Buffer-backed stream windows before retaining stats snapshots", () => {
    const accumulator = new BoundedStreamTextAccumulator();
    const headMarker = "head-copy-marker";
    const tailMarker = "tail-copy-marker";
    const originalChunk = Buffer.from(`${headMarker}${"x".repeat(11 * 1024 * 1024)}${tailMarker}`);
    const originalLength = originalChunk.byteLength;

    accumulator.pushBytes(originalChunk);
    originalChunk.fill("z");

    const snapshot = accumulator.finish();

    expect(snapshot.truncated).toBe(true);
    expect(snapshot.totalBytes).toBe(originalLength);
    expect(snapshot.bufferedBytes).toBe(10 * 1024 * 1024);
    expect(snapshot.text).toContain(headMarker);
    expect(snapshot.text).toContain(tailMarker);
    expect(snapshot.text).not.toContain("zzzzzzzzzzzzzzzz");
  });

  it("does not pull the upstream stream before downstream demand", async () => {
    const clientController = new AbortController();
    const session = createSession(clientController.signal);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });
    const tracked = createPullTrackedResponsesSse();

    const downstream = await ProxyResponseHandler.dispatch(session, tracked.response);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(tracked.getPullCount()).toBeLessThanOrEqual(4);

    clientController.abort(new Error("test cleanup"));
    await downstream.body?.cancel().catch(() => {});
    await drainAsyncTasks();
  });

  it("keeps upstream lookahead bounded while the downstream consumer is paused", async () => {
    const clientController = new AbortController();
    const session = createSession(clientController.signal);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });
    const tracked = createPullTrackedResponsesSse();

    const downstream = await ProxyResponseHandler.dispatch(session, tracked.response);
    const reader = downstream.body?.getReader();
    expect(reader).toBeDefined();
    const first = await reader?.read();
    expect(first?.done).toBe(false);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(tracked.getPullCount()).toBeLessThanOrEqual(3);
    expect(updateMessageRequestDuration).not.toHaveBeenCalled();

    await reader?.cancel("test cleanup");
    await drainAsyncTasks();
    expect(updateMessageRequestDuration).not.toHaveBeenCalled();
    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      123,
      expect.objectContaining({ durationMs: expect.any(Number) }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("does not count a pending chunk for an active slow consumer as Provider idle", async () => {
    vi.useFakeTimers();
    const responseController = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const clientController = new AbortController();
      const session = createSession(clientController.signal);
      session.provider.streamingIdleTimeoutMs = 5_000;
      Object.assign(session, { responseController });
      setDeferredStreamingFinalization(session, {
        providerId: 1,
        providerName: "avemujica-responses",
        providerPriority: 1,
        attemptNumber: 1,
        totalProvidersAttempted: 1,
        isFirstAttempt: true,
        isFailoverSuccess: false,
        endpointId: 42,
        endpointUrl: "https://api.test.invalid/v1",
        upstreamStatusCode: 200,
      });
      const tracked = createPullTrackedResponsesSse();

      const downstream = await ProxyResponseHandler.dispatch(session, tracked.response);
      reader = downstream.body?.getReader();
      expect(reader).toBeDefined();

      const decoder = new TextDecoder();
      const first = await reader?.read();
      expect(first?.done).toBe(false);
      let responseText = first?.value ? decoder.decode(first.value, { stream: true }) : "";
      await vi.advanceTimersByTimeAsync(0);

      const pullsBeforePause = tracked.getPullCount();
      expect(pullsBeforePause).toBeGreaterThanOrEqual(2);

      await vi.advanceTimersByTimeAsync(10_000);

      expect(responseController.signal.aborted).toBe(false);
      expect(tracked.getPullCount()).toBe(pullsBeforePause);
      expect(updateMessageRequestDuration).not.toHaveBeenCalled();

      while (true) {
        const result = await reader?.read();
        if (!result || result.done) break;
        responseText += decoder.decode(result.value, { stream: true });
      }
      responseText += decoder.decode();

      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await expectAllFulfilled(tasks);

      expect(responseText).toContain("event: response.completed");
      expect(responseController.signal.aborted).toBe(false);
      expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          statusCode: 200,
          inputTokens: 463,
          outputTokens: 11,
        }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
      expect(recordFailure).not.toHaveBeenCalled();
    } finally {
      await reader?.cancel("test cleanup").catch(() => {});
      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await expectAllFulfilled(tasks);
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("does not apply the default stale cleanup when stream idle timeout is disabled", async () => {
    const controller = new AbortController();
    const session = createSession(controller.signal);
    session.provider.streamingIdleTimeoutMs = 0;
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });

    const downstream = await ProxyResponseHandler.dispatch(session, createResponsesSse());
    await downstream.text();
    await drainAsyncTasks();

    const streamRegisterCall = vi.mocked(AsyncTaskManager.register).mock.calls.find((call) => {
      const options = call[2] as { taskType?: string } | undefined;
      return options?.taskType === "stream-processing";
    });

    expect(streamRegisterCall).toBeDefined();
    expect(streamRegisterCall?.[2]).toEqual(
      expect.objectContaining({
        staleTimeoutMs: Number.POSITIVE_INFINITY,
      })
    );
  });

  it("does not apply the generic stale watchdog when stream timeouts are enabled", async () => {
    const controller = new AbortController();
    const session = createSession(controller.signal);
    session.provider.streamingIdleTimeoutMs = 5_000;
    session.provider.firstByteTimeoutStreamingMs = 2_000;
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });

    const downstream = await ProxyResponseHandler.dispatch(session, createResponsesSse());
    await downstream.text();
    await drainAsyncTasks();

    const streamRegisterCall = vi.mocked(AsyncTaskManager.register).mock.calls.find((call) => {
      const options = call[2] as { taskType?: string } | undefined;
      return options?.taskType === "stream-processing";
    });

    expect(streamRegisterCall?.[2]).toEqual(
      expect.objectContaining({ staleTimeoutMs: Number.POSITIVE_INFINITY })
    );
  });

  it("clears the first-byte timeout when an empty upstream stream reaches EOF", async () => {
    const controller = new AbortController();
    const session = createSession(controller.signal);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });

    const downstream = await ProxyResponseHandler.dispatch(session, createEmptyResponsesSse());
    await downstream.text();
    await drainAsyncTasks();

    expect(session.recordTtfb).not.toHaveBeenCalled();
    expect(session.clearResponseTimeout).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite persisted terminal details when a later side effect fails", async () => {
    const controller = new AbortController();
    const session = createSession(controller.signal);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });
    vi.mocked(emitProxyLangfuseTrace).mockImplementationOnce(() => {
      throw new Error("final trace failed");
    });

    const downstream = await ProxyResponseHandler.dispatch(session, createResponsesSse());
    await downstream.text();
    await drainAsyncTasks();

    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledTimes(1);
    expect(updateMessageRequestDuration).not.toHaveBeenCalled();
    expect(emitProxyLangfuseTrace).toHaveBeenCalledTimes(1);
  });

  it("settles stream processing before deferred success side effects even when tracing fails", async () => {
    const clientController = new AbortController();
    const session = createSession(clientController.signal);
    session.sessionId = "deferred-success-side-effects";
    let resolveBinding!: (result: { updated: boolean; reason: string }) => void;
    let markBindingStarted!: () => void;
    const bindingStarted = new Promise<void>((resolve) => {
      markBindingStarted = resolve;
    });
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });
    vi.mocked(SessionManager.updateSessionBindingSmart).mockImplementationOnce(() => {
      markBindingStarted();
      return new Promise((resolve) => {
        resolveBinding = resolve;
      });
    });
    vi.mocked(emitProxyLangfuseTrace).mockImplementationOnce(() => {
      throw new Error("final trace failed");
    });

    try {
      const downstream = await ProxyResponseHandler.dispatch(session, createResponsesSse());
      await downstream.text();
      await bindingStarted;

      const streamProcessingTask = getRegisteredTask("stream-processing");
      expect(streamProcessingTask).toBeDefined();
      await expectTaskToResolveWithoutWaiting(streamProcessingTask as Promise<void>);

      expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          statusCode: 200,
          providerId: 1,
        }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
      expect(emitProxyLangfuseTrace).toHaveBeenCalledTimes(1);
      expect(
        vi.mocked(AsyncTaskManager.register).mock.calls.some((call) => {
          const options = call[2] as { taskType?: string } | undefined;
          return options?.taskType === "post-terminal-side-effects";
        })
      ).toBe(true);
    } finally {
      resolveBinding?.({ updated: false, reason: "test cleanup" });
      await drainAsyncTasks();
    }
  });

  it("persists an upstream failure before waiting for Session cleanup side effects", async () => {
    const clientController = new AbortController();
    const session = createSession(clientController.signal, {
      providerType: "claude",
      originalFormat: "claude",
      endpoint: "/v1/messages",
      model: "claude-x",
    });
    session.sessionId = "deferred-failure-side-effects";
    let resolveCleanup!: () => void;
    let markCleanupStarted!: () => void;
    const cleanupStarted = new Promise<void>((resolve) => {
      markCleanupStarted = resolve;
    });
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });
    vi.mocked(SessionManager.clearSessionProvider).mockImplementationOnce(() => {
      markCleanupStarted();
      return new Promise<void>((resolve) => {
        resolveCleanup = resolve;
      });
    });

    try {
      const downstream = await ProxyResponseHandler.dispatch(session, createTruncatedClaudeSse());
      await downstream.text().catch(() => "client stream closed");
      await cleanupStarted;

      const streamProcessingTask = getRegisteredTask("stream-processing");
      expect(streamProcessingTask).toBeDefined();
      await expectTaskToResolveWithoutWaiting(streamProcessingTask as Promise<void>);

      expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          statusCode: 502,
          errorMessage: "STREAM_UPSTREAM_ABORTED",
          providerId: 1,
        }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
      expect(
        vi.mocked(AsyncTaskManager.register).mock.calls.some((call) => {
          const options = call[2] as { taskType?: string } | undefined;
          return options?.taskType === "post-terminal-side-effects";
        })
      ).toBe(true);
    } finally {
      resolveCleanup?.();
      await drainAsyncTasks();
    }
  });

  it("releases stream listeners and timeouts before deferred persistence finishes", async () => {
    vi.useFakeTimers();
    const clientController = new AbortController();
    const addSpy = vi.spyOn(clientController.signal, "addEventListener");
    const removeSpy = vi.spyOn(clientController.signal, "removeEventListener");
    const responseController = new AbortController();
    let resolvePersistence!: () => void;
    const blockedPersistence = new Promise<boolean>((resolve) => {
      resolvePersistence = () => resolve(true);
    });
    let markPersistenceStarted!: () => void;
    const persistenceStarted = new Promise<void>((resolve) => {
      markPersistenceStarted = resolve;
    });
    let timersRestored = false;
    try {
      const session = createSession(clientController.signal);
      const releaseAgent = vi.fn();
      session.provider.streamingIdleTimeoutMs = 5_000;
      Object.assign(session, { responseController, releaseAgent });
      const responseTimeoutId = setTimeout(() => {
        responseController.abort(new Error("response timeout was not cleared"));
      }, 5_000);
      session.clearResponseTimeout = vi.fn(() => clearTimeout(responseTimeoutId));
      setDeferredStreamingFinalization(session, {
        providerId: 1,
        providerName: "avemujica-responses",
        providerPriority: 1,
        attemptNumber: 1,
        totalProvidersAttempted: 1,
        isFirstAttempt: true,
        isFailoverSuccess: false,
        endpointId: 42,
        endpointUrl: "https://api.test.invalid/v1",
        upstreamStatusCode: 200,
      });
      vi.mocked(updateMessageRequestDetailsDurably).mockImplementationOnce(() => {
        markPersistenceStarted();
        return blockedPersistence;
      });

      const downstream = await ProxyResponseHandler.dispatch(
        session,
        createPullTrackedResponsesSse().response
      );
      await downstream.text();
      await persistenceStarted;

      expect(updateMessageRequestDetailsDurably).toHaveBeenCalledTimes(1);
      expect(updateMessageRequestDetailsIfUnfinalized).not.toHaveBeenCalled();
      expect(session.clearResponseTimeout).toHaveBeenCalledTimes(1);
      expect(releaseAgent).toHaveBeenCalledTimes(1);

      const abortAddCalls = addSpy.mock.calls.filter(([type]) => type === "abort");
      expect(abortAddCalls).toHaveLength(1);
      expect(removeSpy).toHaveBeenCalledWith("abort", abortAddCalls[0][1]);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(responseController.signal.aborted).toBe(false);

      clientController.abort(new Error("late client disconnect"));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(responseController.signal.aborted).toBe(false);
      expect(updateMessageRequestDetailsIfUnfinalized).not.toHaveBeenCalled();

      resolvePersistence();
      vi.clearAllTimers();
      vi.useRealTimers();
      timersRestored = true;
      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await expectAllFulfilled(tasks);
      expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          durationMs: expect.any(Number),
          statusCode: 200,
        }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
    } finally {
      resolvePersistence();
      if (!timersRestored) {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await expectAllFulfilled(tasks);
    }
  });

  it("bounds deferred stream finalization when persistence never settles", async () => {
    vi.useFakeTimers();
    try {
      const clientController = new AbortController();
      const session = createSession(clientController.signal);
      setDeferredStreamingFinalization(session, {
        providerId: 1,
        providerName: "avemujica-responses",
        providerPriority: 1,
        attemptNumber: 1,
        totalProvidersAttempted: 1,
        isFirstAttempt: true,
        isFailoverSuccess: false,
        endpointId: 42,
        endpointUrl: "https://api.test.invalid/v1",
        upstreamStatusCode: 200,
      });
      vi.mocked(updateMessageRequestDetailsDurably).mockImplementationOnce(
        () => new Promise<boolean>(() => {})
      );

      const downstream = await ProxyResponseHandler.dispatch(session, createResponsesSse());
      await downstream.text();
      await vi.advanceTimersByTimeAsync(120_000);
      await vi.advanceTimersByTimeAsync(0);

      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await expectAllFulfilled(tasks);
      expect(updateMessageRequestDetailsIfUnfinalized).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          durationMs: expect.any(Number),
          statusCode: 500,
          errorMessage: "Error: stream_finalization_timeout",
        }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("keeps a late fallback commit observable after the failure deadline", async () => {
    vi.useFakeTimers();
    const flushMicrotasks = (remaining = 32): Promise<void> =>
      remaining === 0
        ? Promise.resolve()
        : Promise.resolve().then(() => flushMicrotasks(remaining - 1));
    let resolveFallback!: () => void;
    let committedCallback: (() => void | Promise<void>) | undefined;
    try {
      const clientController = new AbortController();
      const session = createSession(clientController.signal);
      setDeferredStreamingFinalization(session, {
        providerId: 1,
        providerName: "avemujica-responses",
        providerPriority: 1,
        attemptNumber: 1,
        totalProvidersAttempted: 1,
        isFirstAttempt: true,
        isFailoverSuccess: false,
        endpointId: 42,
        endpointUrl: "https://api.test.invalid/v1",
        upstreamStatusCode: 200,
      });
      vi.mocked(updateMessageRequestDetailsDurably).mockImplementationOnce(
        () => new Promise<boolean>(() => {})
      );
      vi.mocked(updateMessageRequestDetailsIfUnfinalized).mockImplementationOnce(
        async (_id, details, options) => {
          committedCallback = options?.onCommitted;
          await new Promise<void>((resolve) => {
            resolveFallback = resolve;
          });
          await options?.onCommitted?.(details);
          return true;
        }
      );

      const downstream = await ProxyResponseHandler.dispatch(session, createResponsesSse());
      await downstream.text();
      await vi.advanceTimersByTimeAsync(120_000);
      await flushMicrotasks();

      expect(updateMessageRequestDetailsDurably).toHaveBeenCalledTimes(1);
      expect(updateMessageRequestDetailsIfUnfinalized).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5_000);
      await flushMicrotasks();
      expect(asyncTasks.length).toBeGreaterThanOrEqual(2);

      resolveFallback();
      await flushMicrotasks();
      expect(committedCallback).toBeTypeOf("function");
      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await expectAllFulfilled(tasks);

      expect(updateMessageRequestDetailsIfUnfinalized).toHaveBeenCalledTimes(1);
    } finally {
      resolveFallback?.();
      await flushMicrotasks();
      vi.clearAllTimers();
      vi.useRealTimers();
      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await expectAllFulfilled(tasks);
    }
  });

  it("persists stream duration in the same durable terminal patch", async () => {
    const clientController = new AbortController();
    const session = createSession(clientController.signal);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });

    const downstream = await ProxyResponseHandler.dispatch(session, createResponsesSse());
    await downstream.text();
    await drainAsyncTasks();

    expect(updateMessageRequestDuration).not.toHaveBeenCalled();
    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        durationMs: expect.any(Number),
        statusCode: 200,
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("does not let a timeout fallback overwrite a late primary terminal write", async () => {
    vi.useFakeTimers();
    const flushMicrotasks = (remaining = 32): Promise<void> =>
      remaining === 0
        ? Promise.resolve()
        : Promise.resolve().then(() => flushMicrotasks(remaining - 1));
    let terminalStatusCode: number | null = null;
    let resolvePrimaryDetails!: () => void;
    let markPrimaryDetailsStarted!: () => void;
    const primaryDetailsStarted = new Promise<void>((resolve) => {
      markPrimaryDetailsStarted = resolve;
    });
    let resolveFallback!: () => void;
    let markFallbackStarted!: () => void;
    const fallbackStarted = new Promise<void>((resolve) => {
      markFallbackStarted = resolve;
    });
    try {
      const clientController = new AbortController();
      const session = createSession(clientController.signal);
      setDeferredStreamingFinalization(session, {
        providerId: 1,
        providerName: "avemujica-responses",
        providerPriority: 1,
        attemptNumber: 1,
        totalProvidersAttempted: 1,
        isFirstAttempt: true,
        isFailoverSuccess: false,
        endpointId: 42,
        endpointUrl: "https://api.test.invalid/v1",
        upstreamStatusCode: 200,
      });
      vi.mocked(updateMessageRequestDetailsDurably)
        .mockImplementationOnce((_id, details) => {
          markPrimaryDetailsStarted();
          return new Promise<boolean>((resolve) => {
            resolvePrimaryDetails = () => {
              terminalStatusCode = details.statusCode ?? null;
              resolve(true);
            };
          });
        })
        .mockImplementation(async (_id, details) => {
          terminalStatusCode = details.statusCode ?? null;
          return true;
        });
      vi.mocked(updateMessageRequestDetailsIfUnfinalized).mockImplementation(
        async (_id, details) => {
          markFallbackStarted();
          if (terminalStatusCode === null) {
            terminalStatusCode = details.statusCode ?? null;
          }
          return new Promise<boolean>((resolve) => {
            resolveFallback = () => resolve(false);
          });
        }
      );

      const downstream = await ProxyResponseHandler.dispatch(session, createResponsesSse());
      await downstream.text();
      await primaryDetailsStarted;
      await vi.advanceTimersByTimeAsync(120_000);
      await fallbackStarted;

      resolvePrimaryDetails();
      await flushMicrotasks();
      expect(terminalStatusCode).toBe(200);

      resolveFallback();
      await flushMicrotasks();
      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await expectAllFulfilled(tasks);

      expect(updateMessageRequestDetailsIfUnfinalized).toHaveBeenCalledTimes(1);
      expect(terminalStatusCode).toBe(200);
    } finally {
      resolvePrimaryDetails?.();
      resolveFallback?.();
      await flushMicrotasks();
      vi.clearAllTimers();
      vi.useRealTimers();
      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await expectAllFulfilled(tasks);
    }
  });

  it("does not apply the default stale cleanup when non-stream request timeout is disabled", async () => {
    const controller = new AbortController();
    const session = createSession(controller.signal);
    session.provider.requestTimeoutNonStreamingMs = 0;

    await ProxyResponseHandler.dispatch(session, createResponsesJson());
    await drainAsyncTasks();

    const nonStreamRegisterCall = vi.mocked(AsyncTaskManager.register).mock.calls.find((call) => {
      const options = call[2] as { taskType?: string } | undefined;
      return options?.taskType === "non-stream-processing";
    });

    expect(nonStreamRegisterCall).toBeDefined();
    expect(nonStreamRegisterCall?.[2]).toEqual(
      expect.objectContaining({
        staleTimeoutMs: Number.POSITIVE_INFINITY,
      })
    );
  });

  it("finalizes a complete upstream responses stream as success when the downstream client already closed", async () => {
    const controller = new AbortController();
    controller.abort();
    const session = createSession(controller.signal);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });

    await ProxyResponseHandler.dispatch(session, createResponsesSse());
    await drainAsyncTasks();

    expect(AsyncTaskManager.cancel).not.toHaveBeenCalled();
    expect(updateMessageRequestDuration).not.toHaveBeenCalled();
    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 200,
        inputTokens: 463,
        outputTokens: 11,
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("keeps stream accounting bounded for oversized successful streams", async () => {
    const controller = new AbortController();
    const session = createSession(controller.signal);
    session.sessionId = "session_large";
    Object.assign(session, {
      shouldPersistSessionDebugArtifacts: () => true,
    });
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });

    const downstream = await ProxyResponseHandler.dispatch(session, createOversizedResponsesSse());
    await downstream.text();
    await drainAsyncTasks();

    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 200,
        inputTokens: 463,
        outputTokens: 11,
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
    expect(SessionManager.storeSessionResponse).not.toHaveBeenCalled();

    const traceCall = vi.mocked(emitProxyLangfuseTrace).mock.calls.at(-1);
    expect(traceCall).toBeDefined();
    const traceData = traceCall?.[1];
    const responseText = traceData?.responseText ?? "";
    expect(responseText).toContain("[cch_truncated]");
    expect(responseText.length).toBeLessThan(10 * 1024 * 1024 + 1024);
  });

  it("decodes an untruncated stream as contiguous UTF-8 across the head/tail split", async () => {
    const controller = new AbortController();
    const session = createSession(controller.signal);
    session.sessionId = "session_utf8_boundary";
    Object.assign(session, {
      shouldPersistSessionDebugArtifacts: () => true,
    });
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });

    const downstream = await ProxyResponseHandler.dispatch(
      session,
      createUtf8SplitHeadTailResponsesSse()
    );
    await downstream.text();
    await drainAsyncTasks();

    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 200,
        inputTokens: 463,
        outputTokens: 11,
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );

    const traceCall = vi.mocked(emitProxyLangfuseTrace).mock.calls.at(-1);
    expect(traceCall).toBeDefined();
    const responseText = traceCall?.[1].responseText ?? "";
    expect(responseText).toContain("界");
    expect(responseText).not.toContain("\uFFFD");
    expect(responseText).not.toContain("[cch_truncated]");
  });

  it("keeps usage when a terminal responses event is split across tail chunk eviction", async () => {
    const controller = new AbortController();
    const session = createSession(controller.signal);
    session.sessionId = "session_split_tail";
    Object.assign(session, {
      shouldPersistSessionDebugArtifacts: () => true,
    });
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });

    const downstream = await ProxyResponseHandler.dispatch(
      session,
      createSplitTailBoundaryResponsesSse()
    );
    await downstream.text();
    await drainAsyncTasks();

    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 200,
        inputTokens: 463,
        outputTokens: 11,
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
    expect(SessionManager.storeSessionResponse).not.toHaveBeenCalled();
  });

  it("reclassifies a client-aborted stream as success when final usage was already received", async () => {
    const controller = new AbortController();
    controller.abort();
    const session = createSession(controller.signal);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });

    await ProxyResponseHandler.dispatch(session, createCompletedThenErroredResponsesSse());
    await drainAsyncTasks();

    expect(AsyncTaskManager.cancel).not.toHaveBeenCalled();
    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 200,
        inputTokens: 463,
        outputTokens: 11,
        providerChain: [
          expect.objectContaining({
            reason: "request_success",
            statusCode: 200,
          }),
        ],
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it.each([
    { bindingIntent: "create" as const, providerId: null },
    { bindingIntent: "renew" as const, providerId: 1 },
  ])(
    "preserves binding state for a client-aborted Discovery $bindingIntent stream",
    async ({ bindingIntent, providerId }) => {
      const controller = new AbortController();
      controller.abort();
      const session = createSession(controller.signal);
      Object.assign(session, {
        sessionId: `session-client-abort-${bindingIntent}`,
      });
      session.recordProviderSessionRef(1);
      vi.mocked(SessionManager.extractCodexPromptCacheKey).mockReturnValue(
        "client-abort-cache-key"
      );
      setDeferredStreamingFinalization(session, {
        providerId: 1,
        providerName: "avemujica-responses",
        providerPriority: 1,
        attemptNumber: 1,
        totalProvidersAttempted: 2,
        isFirstAttempt: false,
        isFailoverSuccess: bindingIntent === "create",
        endpointId: 42,
        endpointUrl: "https://api.test.invalid/v1",
        upstreamStatusCode: 200,
        bindingIntent,
        bindingSnapshot: {
          sessionId: `session-client-abort-${bindingIntent}`,
          keyId: 2,
          providerId,
          generation: `${bindingIntent}-generation`,
        },
        requiresCompletionMarkerForBinding: true,
        discoveryLease: {
          sessionId: `session-client-abort-${bindingIntent}`,
          keyId: 2,
          ownerToken: `client-abort-${bindingIntent}-owner`,
          ttlSeconds: 30,
        },
        providerSessionRefOwned: true,
      });

      await ProxyResponseHandler.dispatch(session, createCompletedThenErroredResponsesSse());
      await drainAsyncTasks();

      expect(SessionManager.clearVersionedSessionProvider).not.toHaveBeenCalled();
      expect(SessionManager.clearSessionProvider).not.toHaveBeenCalled();
      expect(SessionManager.compareAndSetSessionProvider).not.toHaveBeenCalled();
      expect(SessionManager.updateSessionBindingSmart).not.toHaveBeenCalled();
      expect(SessionManager.updateSessionWithCodexCacheKey).not.toHaveBeenCalled();
      expect(SessionManager.releaseSessionDiscoveryLease).toHaveBeenCalledOnce();
      expect(SessionManager.releaseSessionDiscoveryLease).toHaveBeenCalledWith(
        `session-client-abort-${bindingIntent}`,
        2,
        `client-abort-${bindingIntent}-owner`
      );
      expect(RateLimitService.releaseProviderSession).toHaveBeenCalledWith(
        1,
        `session-client-abort-${bindingIntent}`
      );
    }
  );

  it("keeps a genuinely aborted upstream responses stream as 499", async () => {
    const controller = new AbortController();
    controller.abort();
    const session = createSession(controller.signal);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });

    await ProxyResponseHandler.dispatch(session, createErroredResponsesSse());
    await drainAsyncTasks();

    expect(AsyncTaskManager.cancel).not.toHaveBeenCalled();
    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 499,
        errorMessage: "CLIENT_ABORTED",
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("keeps a truncated client-aborted Claude stream as 499 despite message_start usage (U01)", async () => {
    const controller = new AbortController();
    controller.abort();
    const session = createSession(controller.signal, {
      providerType: "anthropic",
      originalFormat: "claude",
      endpoint: "/v1/messages",
      model: "claude-x",
    });
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });

    await ProxyResponseHandler.dispatch(session, createTruncatedClaudeSse());
    await drainAsyncTasks();

    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 499,
        errorMessage: "CLIENT_ABORTED",
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
    // Must NOT have been recorded as a billed 200 success.
    const calls = (
      updateMessageRequestDetailsDurably as unknown as {
        mock: { calls: unknown[][] };
      }
    ).mock.calls;
    const recorded = calls.find((c) => (c[0] as number) === 123)?.[1] as
      | { statusCode?: number }
      | undefined;
    expect(recorded?.statusCode).not.toBe(200);
  });

  it("bills a complete-then-aborted Claude stream as success on the message_stop marker (U01)", async () => {
    const controller = new AbortController();
    controller.abort();
    const session = createSession(controller.signal, {
      providerType: "anthropic",
      originalFormat: "claude",
      endpoint: "/v1/messages",
      model: "claude-x",
    });
    Object.assign(session, {
      sessionId: "session-complete-then-aborted",
      getResolvedPricingByBillingSource: vi.fn(async () => ({
        resolvedModelName: "claude-x",
        resolvedPricingProviderKey: "anthropic",
        source: "local_manual" as const,
        priceData: {
          input_cost_per_token: 0.000003,
          output_cost_per_token: 0.000015,
        },
      })),
    });
    Object.assign(session.authState?.user ?? {}, {
      dailyResetTime: "00:00",
      dailyResetMode: "fixed",
      limit5hResetMode: "rolling",
    });
    Object.assign(session.authState?.key ?? {}, {
      dailyResetTime: "00:00",
      dailyResetMode: "fixed",
      limit5hResetMode: "rolling",
    });
    Object.assign(session.provider ?? {}, {
      limit5hResetMode: "rolling",
    });
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });

    await ProxyResponseHandler.dispatch(session, createCompletedThenAbortedClaudeSse());
    await drainAsyncTasks();

    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 200,
        inputTokens: 463,
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );

    const expectedCost = 0.001554;
    const dbCostCall = vi.mocked(updateMessageRequestCostWithBreakdown).mock.calls.at(-1);
    expect(dbCostCall).toBeDefined();
    expect(dbCostCall?.[0]).toBe(123);
    expect(String(dbCostCall?.[1])).toBe("0.001554");
    expect(dbCostCall?.[2]).toEqual(
      expect.objectContaining({
        input: "0.001389",
        output: "0.000165",
        total: "0.001554",
      })
    );

    expect(RateLimitService.trackCost).toHaveBeenCalledWith(
      2,
      1,
      "session-complete-then-aborted",
      expectedCost,
      expect.objectContaining({
        userId: 1,
        userResetTime: "00:00",
        userResetMode: "fixed",
        requestId: 123,
      })
    );
    expect(RateLimitService.trackUserDailyCost).not.toHaveBeenCalled();

    expect(RateLimitService.settleLeaseBudgets).toHaveBeenCalledTimes(1);
    expect(RateLimitService.settleLeaseBudgets).toHaveBeenCalledWith({
      requestId: 123,
      cost: expectedCost,
      entities: {
        key: expect.objectContaining({ id: 2 }),
        user: expect.objectContaining({ id: 1 }),
        provider: expect.objectContaining({ id: 1 }),
      },
    });
    expect(RateLimitService.decrementLeaseBudget).not.toHaveBeenCalled();
  });

  it("keeps client-abort drain independent from a small idle timeout while chunks are active", async () => {
    vi.useFakeTimers();
    try {
      const clientController = new AbortController();
      const upstreamController = new AbortController();
      const session = createSession(clientController.signal);
      session.provider.streamingIdleTimeoutMs = 5_000;
      Object.assign(session, { responseController: upstreamController });
      setDeferredStreamingFinalization(session, {
        providerId: 1,
        providerName: "avemujica-responses",
        providerPriority: 1,
        attemptNumber: 1,
        totalProvidersAttempted: 1,
        isFirstAttempt: true,
        isFailoverSuccess: false,
        endpointId: 42,
        endpointUrl: "https://api.test.invalid/v1",
        upstreamStatusCode: 200,
      });

      await ProxyResponseHandler.dispatch(
        session,
        createActiveHangingResponsesSse(upstreamController.signal)
      );
      clientController.abort();

      await vi.advanceTimersByTimeAsync(59_000);
      expect(upstreamController.signal.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(1_000);
      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await expectAllFulfilled(tasks);

      expect(upstreamController.signal.aborted).toBe(true);
      expect(AsyncTaskManager.cancel).not.toHaveBeenCalled();
      expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          statusCode: 499,
          errorMessage: "CLIENT_ABORTED",
        }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses idle timeout for client-aborted streams that hang before the first chunk", async () => {
    vi.useFakeTimers();
    try {
      const clientController = new AbortController();
      const upstreamController = new AbortController();
      const session = createSession(clientController.signal);
      session.provider.streamingIdleTimeoutMs = 5_000;
      Object.assign(session, { responseController: upstreamController });
      setDeferredStreamingFinalization(session, {
        providerId: 1,
        providerName: "avemujica-responses",
        providerPriority: 1,
        attemptNumber: 1,
        totalProvidersAttempted: 1,
        isFirstAttempt: true,
        isFailoverSuccess: false,
        endpointId: 42,
        endpointUrl: "https://api.test.invalid/v1",
        upstreamStatusCode: 200,
      });

      await ProxyResponseHandler.dispatch(
        session,
        createPreBodyHangingResponsesSse(upstreamController.signal)
      );
      clientController.abort();

      await vi.advanceTimersByTimeAsync(4_999);
      expect(upstreamController.signal.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await expectAllFulfilled(tasks);

      expect(upstreamController.signal.aborted).toBe(true);
      expect(AsyncTaskManager.cancel).not.toHaveBeenCalled();
      expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          statusCode: 499,
          errorMessage: "CLIENT_ABORTED",
        }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves an existing idle deadline when the client aborts after a chunk", async () => {
    vi.useFakeTimers();
    try {
      const clientController = new AbortController();
      const upstreamController = new AbortController();
      const session = createSession(clientController.signal);
      session.provider.streamingIdleTimeoutMs = 5_000;
      Object.assign(session, { responseController: upstreamController });
      setDeferredStreamingFinalization(session, {
        providerId: 1,
        providerName: "avemujica-responses",
        providerPriority: 1,
        attemptNumber: 1,
        totalProvidersAttempted: 1,
        isFirstAttempt: true,
        isFailoverSuccess: false,
        endpointId: 42,
        endpointUrl: "https://api.test.invalid/v1",
        upstreamStatusCode: 200,
      });

      const downstream = await ProxyResponseHandler.dispatch(
        session,
        createHangingResponsesSse(upstreamController.signal)
      );
      const downstreamReader = downstream.body?.getReader();
      expect(downstreamReader).toBeDefined();
      await downstreamReader?.read();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(4_999);
      expect(upstreamController.signal.aborted).toBe(false);

      clientController.abort();
      await vi.advanceTimersByTimeAsync(1);
      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await expectAllFulfilled(tasks);

      expect(upstreamController.signal.aborted).toBe(true);
      expect(AsyncTaskManager.cancel).not.toHaveBeenCalled();
      expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          statusCode: 499,
          errorMessage: "CLIENT_ABORTED",
        }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves an earlier Provider idle timeout when the client aborts before source settlement", async () => {
    vi.useFakeTimers();
    try {
      const clientController = new AbortController();
      const upstreamController = new AbortController();
      const session = createSession(clientController.signal);
      session.provider.streamingIdleTimeoutMs = 5_000;
      Object.assign(session, { responseController: upstreamController });
      setDeferredStreamingFinalization(session, {
        providerId: 1,
        providerName: "avemujica-responses",
        providerPriority: 1,
        attemptNumber: 1,
        totalProvidersAttempted: 1,
        isFirstAttempt: true,
        isFailoverSuccess: false,
        endpointId: 42,
        endpointUrl: "https://api.test.invalid/v1",
        upstreamStatusCode: 200,
      });
      const controlled = createControllableIdleTimeoutResponsesSse();

      const downstream = await ProxyResponseHandler.dispatch(session, controlled.response);
      const downstreamReader = downstream.body?.getReader();
      expect(downstreamReader).toBeDefined();
      void downstreamReader?.closed.catch(() => {});
      await downstreamReader?.read();
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(upstreamController.signal.aborted).toBe(true);

      clientController.abort();
      controlled.failIdle();
      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await expectAllFulfilled(tasks);

      expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          statusCode: 502,
          errorMessage: "STREAM_IDLE_TIMEOUT",
        }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
      expect(recordFailure).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps client-abort drain at 60s when the upstream stream hangs", async () => {
    vi.useFakeTimers();
    try {
      const clientController = new AbortController();
      const upstreamController = new AbortController();
      const session = createSession(clientController.signal);
      session.provider.streamingIdleTimeoutMs = 120_000;
      Object.assign(session, { responseController: upstreamController });
      setDeferredStreamingFinalization(session, {
        providerId: 1,
        providerName: "avemujica-responses",
        providerPriority: 1,
        attemptNumber: 1,
        totalProvidersAttempted: 1,
        isFirstAttempt: true,
        isFailoverSuccess: false,
        endpointId: 42,
        endpointUrl: "https://api.test.invalid/v1",
        upstreamStatusCode: 200,
      });

      await ProxyResponseHandler.dispatch(
        session,
        createHangingResponsesSse(upstreamController.signal)
      );
      clientController.abort();

      await vi.advanceTimersByTimeAsync(60_000);
      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await expectAllFulfilled(tasks);

      expect(upstreamController.signal.aborted).toBe(true);
      expect(AsyncTaskManager.cancel).not.toHaveBeenCalled();
      expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          statusCode: 499,
          errorMessage: "CLIENT_ABORTED",
        }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps body-cancel drain even when the session abort signal does not fire", async () => {
    vi.useFakeTimers();
    const upstreamController = new AbortController();
    try {
      const clientController = new AbortController();
      const session = createSession(clientController.signal);
      session.provider.streamingIdleTimeoutMs = 120_000;
      Object.assign(session, { responseController: upstreamController });
      setDeferredStreamingFinalization(session, {
        providerId: 1,
        providerName: "avemujica-responses",
        providerPriority: 1,
        attemptNumber: 1,
        totalProvidersAttempted: 1,
        isFirstAttempt: true,
        isFailoverSuccess: false,
        endpointId: 42,
        endpointUrl: "https://api.test.invalid/v1",
        upstreamStatusCode: 200,
      });

      const downstream = await ProxyResponseHandler.dispatch(
        session,
        createHangingResponsesSse(upstreamController.signal)
      );
      await downstream.body?.cancel("body_cancel_only");
      expect(clientController.signal.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(upstreamController.signal.aborted).toBe(true);

      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await expectAllFulfilled(tasks);
      expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          statusCode: 499,
          errorMessage: "CLIENT_ABORTED",
        }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
    } finally {
      if (!upstreamController.signal.aborted) {
        upstreamController.abort(new Error("test cleanup"));
      }
      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await expectAllFulfilled(tasks);
      vi.useRealTimers();
    }
  });

  it("classifies a transport error after body cancel as client-aborted", async () => {
    const clientController = new AbortController();
    const session = createSession(clientController.signal);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });
    const upstream = createControllableTransportErrorResponsesSse();

    const downstream = await ProxyResponseHandler.dispatch(session, upstream.response);
    await downstream.body?.cancel("body_cancel_only");
    upstream.fail();
    await drainAsyncTasks();

    expect(clientController.signal.aborted).toBe(false);
    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 499,
        errorMessage: "CLIENT_ABORTED",
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("keeps an earlier Provider transport error when the client signal aborts later", async () => {
    const clientController = new AbortController();
    const session = createSession(clientController.signal);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });
    const upstream = createControllableTransportErrorResponsesSse();

    await ProxyResponseHandler.dispatch(session, upstream.response);
    upstream.fail();
    queueMicrotask(() => clientController.abort(new Error("late client cleanup")));
    await drainAsyncTasks();

    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 502,
        errorMessage: "STREAM_UPSTREAM_ABORTED",
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("persists a fallback when client-detached transport finalization fails", async () => {
    const clientController = new AbortController();
    const session = createSession(clientController.signal);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });
    vi.mocked(updateMessageRequestDetailsDurably).mockRejectedValueOnce(
      new Error("client-detached terminal details failed")
    );
    const upstream = createControllableTransportErrorResponsesSse();

    const downstream = await ProxyResponseHandler.dispatch(session, upstream.response);
    await downstream.body?.cancel("body_cancel_only");
    upstream.fail();
    await drainAsyncTasks();

    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledTimes(1);
    expect(updateMessageRequestDetails).not.toHaveBeenCalled();
    expect(updateMessageRequestDetailsIfUnfinalized).toHaveBeenCalledTimes(1);
    expect(updateMessageRequestDuration).not.toHaveBeenCalled();
    expect(vi.mocked(updateMessageRequestDetailsIfUnfinalized).mock.calls[0]).toEqual([
      123,
      expect.objectContaining({
        durationMs: expect.any(Number),
        statusCode: 499,
        errorMessage: "CLIENT_ABORTED",
        providerId: 1,
        providerChain: [
          expect.objectContaining({
            id: 1,
            name: "avemujica-responses",
            statusCode: 499,
            errorMessage: "CLIENT_ABORTED",
          }),
        ],
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) }),
    ]);
  });

  it("hard-caps body-cancel drain when the source ignores AbortSignals", async () => {
    vi.useFakeTimers();
    const upstream = createAbortInsensitiveHangingResponsesSse();
    try {
      const clientController = new AbortController();
      const responseController = new AbortController();
      const session = createSession(clientController.signal);
      session.provider.streamingIdleTimeoutMs = 120_000;
      Object.assign(session, { responseController });
      setDeferredStreamingFinalization(session, {
        providerId: 1,
        providerName: "avemujica-responses",
        providerPriority: 1,
        attemptNumber: 1,
        totalProvidersAttempted: 1,
        isFirstAttempt: true,
        isFailoverSuccess: false,
        endpointId: 42,
        endpointUrl: "https://api.test.invalid/v1",
        upstreamStatusCode: 200,
      });

      const downstream = await ProxyResponseHandler.dispatch(session, upstream.response);
      await downstream.body?.cancel("body_cancel_only");
      await vi.advanceTimersByTimeAsync(60_000);

      const tasks = asyncTasks.splice(0, asyncTasks.length);
      const outcome = await Promise.race([
        expectAllFulfilled(tasks).then(() => "settled" as const),
        new Promise<"pending">((resolve) => setImmediate(() => resolve("pending"))),
      ]);
      expect(outcome).toBe("settled");
      expect(responseController.signal.aborted).toBe(true);
    } finally {
      upstream.close();
      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await expectAllFulfilled(tasks);
      vi.useRealTimers();
    }
  });

  it("settles an abort-insensitive source immediately after Provider idle timeout", async () => {
    vi.useFakeTimers();
    try {
      const clientController = new AbortController();
      const responseController = new AbortController();
      const session = createSession(clientController.signal);
      session.provider.streamingIdleTimeoutMs = 5_000;
      Object.assign(session, { responseController });
      setDeferredStreamingFinalization(session, {
        providerId: 1,
        providerName: "avemujica-responses",
        providerPriority: 1,
        attemptNumber: 1,
        totalProvidersAttempted: 1,
        isFirstAttempt: true,
        isFailoverSuccess: false,
        endpointId: 42,
        endpointUrl: "https://api.test.invalid/v1",
        upstreamStatusCode: 200,
      });

      const downstream = await ProxyResponseHandler.dispatch(
        session,
        createAbortInsensitivePostChunkHangingResponsesSse()
      );
      const reader = downstream.body?.getReader();
      expect(reader).toBeDefined();
      await reader?.read();
      void reader?.closed.catch(() => {});

      await vi.advanceTimersByTimeAsync(5_000);
      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await expectAllFulfilled(tasks);

      expect(responseController.signal.aborted).toBe(true);
      expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          statusCode: 502,
          errorMessage: "STREAM_IDLE_TIMEOUT",
        }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles an abort-insensitive source immediately after response timeout", async () => {
    const clientController = new AbortController();
    const responseController = new AbortController();
    const session = createSession(clientController.signal);
    Object.assign(session, { responseController });
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });
    const upstream = createAbortInsensitiveHangingResponsesSse();

    const downstream = await ProxyResponseHandler.dispatch(session, upstream.response);
    const downstreamOutcome = downstream.text().catch(() => "client stream closed");
    const timeoutError = new Error("response timeout");
    timeoutError.name = "AbortError";
    responseController.abort(timeoutError);
    await downstreamOutcome;
    await drainAsyncTasks();

    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 502,
        errorMessage: "STREAM_RESPONSE_TIMEOUT",
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
    upstream.close();
  });

  it("preserves a response timeout when the client aborts before source settlement", async () => {
    const clientController = new AbortController();
    const responseController = new AbortController();
    const session = createSession(clientController.signal);
    Object.assign(session, { responseController });
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });
    const upstream = createControllableEmptyResponsesSse();

    const downstream = await ProxyResponseHandler.dispatch(session, upstream.response);
    const downstreamOutcome = downstream.text().catch(() => "client stream closed");
    const timeoutError = new Error("response timeout");
    timeoutError.name = "AbortError";
    responseController.abort(timeoutError);
    clientController.abort(new Error("late client disconnect"));
    upstream.close();
    await downstreamOutcome;
    await drainAsyncTasks();

    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 502,
        errorMessage: "STREAM_RESPONSE_TIMEOUT",
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(recordFailure).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ message: "STREAM_RESPONSE_TIMEOUT" })
    );
    expect(SessionManager.updateSessionBindingSmart).not.toHaveBeenCalled();
  });

  it("waits for durable non-stream failure details before mutating the Provider circuit", async () => {
    const durableAck = createDeferred<void>();
    vi.mocked(updateMessageRequestDetailsDurably).mockImplementationOnce(
      async (_id, details, options) => {
        await durableAck.promise;
        try {
          const result = options?.onCommitted?.(details);
          if (result) void Promise.resolve(result).catch(() => undefined);
        } catch {
          // Test mock mirrors the repository's commit-observer boundary.
        }
        return true;
      }
    );
    const session = createSession(new AbortController().signal);
    const response = new Response('{"error":{"message":"provider failed"}}', {
      status: 500,
      headers: { "content-type": "application/json" },
    });

    await ProxyResponseHandler.dispatch(session, response);
    while (vi.mocked(updateMessageRequestDetailsDurably).mock.calls.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(session.getProviderChain()).toEqual([
      expect.objectContaining({
        id: 1,
        reason: "retry_failed",
        statusCode: 500,
      }),
    ]);
    expect(vi.mocked(updateMessageRequestDetailsDurably).mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        statusCode: 500,
        errorMessage: "FAKE_200_JSON_ERROR_MESSAGE_NON_EMPTY",
      })
    );
    const recordFailureCallsBeforeAck = vi.mocked(recordFailure).mock.calls.length;

    durableAck.resolve();
    await drainAsyncTasks();

    expect(recordFailureCallsBeforeAck).toBe(0);
    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(recordFailure).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        message: "FAKE_200_JSON_ERROR_MESSAGE_NON_EMPTY",
      })
    );
  });

  it("reuses the original non-stream terminal details in the conditional fallback", async () => {
    vi.mocked(updateMessageRequestDetailsDurably).mockRejectedValueOnce(
      new Error("durable acknowledgement failed")
    );
    const session = createSession(new AbortController().signal);
    const response = new Response('{"error":{"message":"provider failed"}}', {
      status: 500,
      headers: { "content-type": "application/json" },
    });

    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).not.toHaveBeenCalled();
    expect(updateMessageRequestDuration).not.toHaveBeenCalled();
    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        durationMs: expect.any(Number),
        statusCode: 500,
        errorMessage: "FAKE_200_JSON_ERROR_MESSAGE_NON_EMPTY",
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
    expect(updateMessageRequestDetailsIfUnfinalized).toHaveBeenCalledTimes(1);
    expect(updateMessageRequestDetailsIfUnfinalized).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        durationMs: expect.any(Number),
        statusCode: 500,
        errorMessage: "FAKE_200_JSON_ERROR_MESSAGE_NON_EMPTY",
        providerId: 1,
        providerChain: [
          expect.objectContaining({
            id: 1,
            reason: "retry_failed",
            statusCode: 500,
            errorMessage: "FAKE_200_JSON_ERROR_MESSAGE_NON_EMPTY",
          }),
        ],
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it.each([
    ["response timeout", "timeout"],
    ["client abort", "client"],
  ] as const)(
    "uses the conditional fallback when the non-stream %s finalizer durable write rejects",
    async (_name, abortSource) => {
      vi.mocked(updateMessageRequestDetailsDurably).mockRejectedValueOnce(
        new Error("durable finalizer acknowledgement failed")
      );
      const clientController = new AbortController();
      const responseController = new AbortController();
      const session = createSession(clientController.signal);
      Object.assign(session, { responseController });
      const response = createAbortableNonStreamResponse(
        abortSource === "timeout" ? responseController.signal : clientController.signal
      );

      await ProxyResponseHandler.dispatch(session, response);
      const abortError = new Error(`non-stream ${abortSource}`);
      abortError.name = "AbortError";
      if (abortSource === "timeout") {
        responseController.abort(abortError);
      } else {
        clientController.abort(abortError);
      }
      await drainAsyncTasks();

      expect(updateMessageRequestDetails).not.toHaveBeenCalled();
      expect(updateMessageRequestDetailsIfUnfinalized).toHaveBeenCalledTimes(1);
      expect(updateMessageRequestDetailsIfUnfinalized).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          statusCode: abortSource === "timeout" ? 502 : 499,
          ...(abortSource === "timeout"
            ? { errorMessage: expect.stringContaining("non-stream timeout") }
            : {}),
          providerId: 1,
          providerChain:
            abortSource === "timeout"
              ? [
                  expect.objectContaining({
                    id: 1,
                    statusCode: 502,
                    errorMessage: expect.stringContaining("non-stream timeout"),
                  }),
                ]
              : [],
        }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
    }
  );

  it("rejects non-stream processing when both terminal persistence attempts fail", async () => {
    vi.mocked(updateMessageRequestDetailsDurably).mockRejectedValueOnce(
      new Error("durable acknowledgement failed")
    );
    vi.mocked(updateMessageRequestDetailsIfUnfinalized).mockRejectedValueOnce(
      new Error("conditional fallback failed")
    );
    const session = createSession(new AbortController().signal);
    const response = new Response('{"error":{"message":"provider failed"}}', {
      status: 500,
      headers: { "content-type": "application/json" },
    });

    await ProxyResponseHandler.dispatch(session, response);
    const processingTask = getRegisteredTask("non-stream-processing");

    expect(processingTask).toBeDefined();
    await expect(processingTask).rejects.toThrow("conditional fallback failed");
    expect(updateMessageRequestDetails).not.toHaveBeenCalled();
  });

  it("waits for durable Gemini non-stream failure details before mutating the Provider circuit", async () => {
    const durableAck = createDeferred<void>();
    vi.mocked(updateMessageRequestDetailsDurably).mockImplementationOnce(
      async (_id, details, options) => {
        await durableAck.promise;
        publishCommitObserver(details, options);
        return true;
      }
    );
    const session = createSession(new AbortController().signal, {
      providerType: "gemini",
      originalFormat: "gemini",
      endpoint: "/v1beta/models/gemini-2.0-flash:generateContent",
      model: "gemini-2.0-flash",
    });
    const response = new Response('{"error":{"message":"provider failed"}}', {
      status: 500,
      headers: { "content-type": "application/json" },
    });

    const returned = await ProxyResponseHandler.dispatch(session, response);
    expect(returned).toBe(response);
    while (vi.mocked(updateMessageRequestDetailsDurably).mock.calls.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(session.getProviderChain()).toEqual([
      expect.objectContaining({
        id: 1,
        reason: "retry_failed",
        statusCode: 500,
      }),
    ]);
    const recordFailureCallsBeforeAck = vi.mocked(recordFailure).mock.calls.length;

    durableAck.resolve();
    await drainAsyncTasks();

    expect(recordFailureCallsBeforeAck).toBe(0);
    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(recordFailure).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        message: "FAKE_200_JSON_ERROR_MESSAGE_NON_EMPTY",
      })
    );
  });

  it.each([
    ["ordinary", {}],
    [
      "Gemini passthrough",
      {
        providerType: "gemini",
        originalFormat: "gemini",
        endpoint: "/v1beta/models/gemini-2.0-flash:generateContent",
        model: "gemini-2.0-flash",
      },
    ],
  ] as const)(
    "keeps non-stream 404 out of the Provider circuit for %s responses",
    async (_name, overrides) => {
      const session = createSession(new AbortController().signal, overrides);
      const response = new Response('{"error":{"message":"model not found"}}', {
        status: 404,
        headers: { "content-type": "application/json" },
      });

      await ProxyResponseHandler.dispatch(session, response);
      await drainAsyncTasks();

      expect(recordFailure).not.toHaveBeenCalled();
      expect(session.getProviderChain()).toEqual([
        expect.objectContaining({
          id: 1,
          reason: "resource_not_found",
          statusCode: 404,
        }),
      ]);
    }
  );

  it("persists Gemini non-stream duration atomically with terminal stats", async () => {
    const session = createSession(new AbortController().signal, {
      providerType: "gemini",
      originalFormat: "gemini",
      endpoint: "/v1beta/models/gemini-2.0-flash:generateContent",
      model: "gemini-2.0-flash",
    });
    const response = new Response('{"candidates":[]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(updateMessageRequestDuration).not.toHaveBeenCalled();
    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        durationMs: expect.any(Number),
        statusCode: 200,
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("releases Discovery resources for a non-SSE Gemini winner", async () => {
    const session = createSession(new AbortController().signal, {
      providerType: "gemini",
      originalFormat: "gemini",
      endpoint: "/v1beta/models/gemini-2.0-flash:streamGenerateContent",
      model: "gemini-2.0-flash",
    });
    session.sessionId = "non-sse-gemini-discovery";
    session.recordProviderSessionRef(1);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "gemini-discovery",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 2,
      isFirstAttempt: false,
      isFailoverSuccess: true,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
      bindingIntent: "create",
      bindingSnapshot: {
        sessionId: "non-sse-gemini-discovery",
        keyId: 2,
        providerId: null,
        generation: "non-sse-generation",
      },
      requiresCompletionMarkerForBinding: true,
      discoveryLease: {
        sessionId: "non-sse-gemini-discovery",
        keyId: 2,
        ownerToken: "non-sse-owner",
        ttlSeconds: 30,
      },
      providerSessionRefOwned: true,
      providerSessionRefRetainOnSuccess: true,
    });
    const response = new Response(
      '{"response":{"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}}',
      { status: 200, headers: { "content-type": "application/json" } }
    );

    const returned = await ProxyResponseHandler.dispatch(session, response);
    expect(returned).toBe(response);
    await drainAsyncTasks();

    expect(SessionManager.renewSessionDiscoveryLease).toHaveBeenCalled();
    expect(SessionManager.releaseSessionDiscoveryLease).toHaveBeenCalledOnce();
    expect(SessionManager.releaseSessionDiscoveryLease).toHaveBeenCalledWith(
      "non-sse-gemini-discovery",
      2,
      "non-sse-owner"
    );
    expect(RateLimitService.releaseProviderSession).toHaveBeenCalledWith(
      1,
      "non-sse-gemini-discovery"
    );
    expect(SessionManager.compareAndSetSessionProvider).not.toHaveBeenCalled();
    expect(peekDeferredStreamingFinalization(session)).toBeNull();
  });

  it("persists one durable 502 before Provider circuit mutation on non-stream response timeout", async () => {
    const durableAck = createDeferred<void>();
    vi.mocked(updateMessageRequestDetailsDurably).mockImplementationOnce(
      async (_id, details, options) => {
        await durableAck.promise;
        publishCommitObserver(details, options);
        return true;
      }
    );
    const responseController = new AbortController();
    const session = createSession(new AbortController().signal);
    Object.assign(session, { responseController });
    const response = createAbortableNonStreamResponse(responseController.signal);

    await ProxyResponseHandler.dispatch(session, response);
    const timeoutError = new Error("non-stream response timeout");
    timeoutError.name = "AbortError";
    responseController.abort(timeoutError);
    while (vi.mocked(updateMessageRequestDetailsDurably).mock.calls.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    const recordFailureCallsBeforeAck = vi.mocked(recordFailure).mock.calls.length;
    const durablePayloadBeforeAck = vi.mocked(updateMessageRequestDetailsDurably).mock
      .calls[0]?.[1];
    const ordinaryDetailsCallsBeforeAck = vi.mocked(updateMessageRequestDetails).mock.calls.length;

    durableAck.resolve();
    await drainAsyncTasks();

    expect(recordFailureCallsBeforeAck).toBe(0);
    expect(ordinaryDetailsCallsBeforeAck).toBe(0);
    expect(durablePayloadBeforeAck).toEqual(
      expect.objectContaining({
        statusCode: 502,
        errorMessage: expect.stringContaining("non-stream response timeout"),
      })
    );
    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledTimes(1);
    expect(recordFailure).toHaveBeenCalledTimes(1);
  });

  it("waits for durable non-stream details before updating the Codex cache binding", async () => {
    const durableAck = createDeferred<void>();
    vi.mocked(updateMessageRequestDetailsDurably).mockImplementationOnce(
      async (_id, details, options) => {
        await durableAck.promise;
        publishCommitObserver(details, options);
        return true;
      }
    );
    vi.mocked(SessionManager.extractCodexPromptCacheKey).mockReturnValueOnce("cache-key-1");
    vi.mocked(SessionManager.updateSessionWithCodexCacheKey).mockResolvedValueOnce(undefined);
    const session = createSession(new AbortController().signal);
    session.sessionId = "codex-cache-binding-session";
    const response = new Response('{"id":"resp_1"}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    await ProxyResponseHandler.dispatch(session, response);
    while (vi.mocked(updateMessageRequestDetailsDurably).mock.calls.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    const cacheBindingCallsBeforeAck = vi.mocked(SessionManager.updateSessionWithCodexCacheKey).mock
      .calls.length;
    durableAck.resolve();
    await drainAsyncTasks();

    expect(cacheBindingCallsBeforeAck).toBe(0);
    expect(SessionManager.updateSessionWithCodexCacheKey).toHaveBeenCalledTimes(1);
    expect(SessionManager.updateSessionWithCodexCacheKey).toHaveBeenCalledWith(
      "codex-cache-binding-session",
      "cache-key-1",
      1,
      2
    );
  });

  it("does not mutate non-stream bindings when the routing mode forbids it", async () => {
    const controller = new AbortController();
    controller.abort();
    const session = createSession(controller.signal);
    Object.assign(session, {
      sessionId: "lease-conflict-non-stream",
      isSessionBindingAllowed: () => false,
    });
    vi.mocked(SessionManager.extractCodexPromptCacheKey).mockReturnValue("blocked-cache-key");
    const response = new Response('{"id":"resp_lease_conflict"}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(SessionManager.clearSessionProvider).not.toHaveBeenCalled();
    expect(SessionManager.updateSessionWithCodexCacheKey).not.toHaveBeenCalled();
  });

  it("does not create a non-stream Codex cache binding when binding is disabled", async () => {
    const session = createSession(new AbortController().signal);
    Object.assign(session, {
      sessionId: "lease-conflict-non-stream-success",
      isSessionBindingAllowed: () => false,
    });
    vi.mocked(SessionManager.extractCodexPromptCacheKey).mockReturnValue("blocked-cache-key");
    const response = new Response('{"id":"resp_lease_conflict"}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(SessionManager.updateSessionWithCodexCacheKey).not.toHaveBeenCalled();
  });

  it("publishes a successful stream Codex cache binding only after durable acknowledgement", async () => {
    const durableAck = createDeferred<void>();
    const cacheBinding = createDeferred<void>();
    const cacheBindingStarted = createDeferred<void>();
    vi.mocked(updateMessageRequestDetailsDurably).mockImplementationOnce(
      async (_id, details, options) => {
        await durableAck.promise;
        publishCommitObserver(details, options);
        return true;
      }
    );
    vi.mocked(SessionManager.extractCodexPromptCacheKey).mockReturnValueOnce("stream-cache-key-1");
    vi.mocked(SessionManager.updateSessionWithCodexCacheKey).mockImplementationOnce(async () => {
      cacheBindingStarted.resolve();
      await cacheBinding.promise;
    });
    const session = createSession(new AbortController().signal);
    session.sessionId = "stream-codex-cache-binding-session";
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });

    try {
      const downstream = await ProxyResponseHandler.dispatch(session, createResponsesSse());
      await downstream.text();
      while (vi.mocked(updateMessageRequestDetailsDurably).mock.calls.length === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }

      expect(SessionManager.updateSessionWithCodexCacheKey).not.toHaveBeenCalled();

      durableAck.resolve();
      await cacheBindingStarted.promise;

      expect(SessionManager.updateSessionWithCodexCacheKey).toHaveBeenCalledWith(
        "stream-codex-cache-binding-session",
        "stream-cache-key-1",
        1,
        2
      );
      const streamProcessingTask = getRegisteredTask("stream-processing");
      expect(streamProcessingTask).toBeDefined();
      await expectTaskToResolveWithoutWaiting(streamProcessingTask as Promise<void>);
    } finally {
      durableAck.resolve();
      cacheBinding.resolve();
      await drainAsyncTasks();
    }
  });

  it("publishes a Discovery Codex cache key only after the primary generation CAS succeeds", async () => {
    const order: string[] = [];
    vi.mocked(SessionManager.extractCodexPromptCacheKey).mockReturnValueOnce(
      "discovery-stream-cache-key"
    );
    vi.mocked(SessionManager.compareAndSetSessionProvider).mockImplementationOnce(async () => {
      order.push("primary-cas");
      return {
        status: "ok",
        source: "updated",
        snapshot: {
          sessionId: "stream-discovery-cache-binding",
          keyId: 2,
          providerId: 1,
          generation: "discovery-updated-generation",
        },
        legacyFallbackAllowed: false,
      };
    });
    vi.mocked(SessionManager.updateSessionWithCodexCacheKey).mockImplementationOnce(async () => {
      order.push("aux-cache-binding");
    });
    const session = createSession(new AbortController().signal);
    session.sessionId = "stream-discovery-cache-binding";
    session.recordProviderSessionRef(1);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 2,
      isFirstAttempt: false,
      isFailoverSuccess: true,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
      bindingIntent: "create",
      bindingSnapshot: {
        sessionId: "stream-discovery-cache-binding",
        keyId: 2,
        providerId: null,
        generation: "discovery-create-generation",
      },
      requiresCompletionMarkerForBinding: true,
      discoveryLease: {
        sessionId: "stream-discovery-cache-binding",
        keyId: 2,
        ownerToken: "discovery-cache-owner",
        ttlSeconds: 30,
      },
      providerSessionRefOwned: true,
      providerSessionRefRetainOnSuccess: true,
    });

    const downstream = await ProxyResponseHandler.dispatch(session, createResponsesSse());
    await downstream.text();
    await drainAsyncTasks();

    expect(order).toEqual(["primary-cas", "aux-cache-binding"]);
    expect(RateLimitService.releaseProviderSession).not.toHaveBeenCalled();
    expect(SessionManager.releaseSessionDiscoveryLease).toHaveBeenCalledOnce();
  });

  it("does not publish a Discovery Codex cache key when the primary generation CAS conflicts", async () => {
    vi.mocked(SessionManager.extractCodexPromptCacheKey).mockReturnValueOnce(
      "conflicted-discovery-cache-key"
    );
    vi.mocked(SessionManager.compareAndSetSessionProvider).mockResolvedValueOnce({
      status: "conflict",
      reason: "generation_mismatch",
      legacyFallbackAllowed: false,
    });
    const session = createSession(new AbortController().signal);
    session.sessionId = "stream-discovery-cache-conflict";
    session.recordProviderSessionRef(1);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 2,
      isFirstAttempt: false,
      isFailoverSuccess: true,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
      bindingIntent: "create",
      bindingSnapshot: {
        sessionId: "stream-discovery-cache-conflict",
        keyId: 2,
        providerId: null,
        generation: "stale-discovery-generation",
      },
      requiresCompletionMarkerForBinding: true,
      discoveryLease: {
        sessionId: "stream-discovery-cache-conflict",
        keyId: 2,
        ownerToken: "conflicted-discovery-owner",
        ttlSeconds: 30,
      },
      providerSessionRefOwned: true,
    });

    const downstream = await ProxyResponseHandler.dispatch(session, createResponsesSse());
    await downstream.text();
    await drainAsyncTasks();

    expect(SessionManager.compareAndSetSessionProvider).toHaveBeenCalledOnce();
    expect(SessionManager.updateSessionWithCodexCacheKey).not.toHaveBeenCalled();
    expect(RateLimitService.releaseProviderSession).toHaveBeenCalledWith(
      1,
      "stream-discovery-cache-conflict"
    );
    expect(SessionManager.releaseSessionDiscoveryLease).toHaveBeenCalledOnce();
  });

  it("settles a failed Discovery binding before rejecting its auxiliary Codex cache binding", async () => {
    vi.mocked(SessionManager.extractCodexPromptCacheKey).mockReturnValueOnce(
      "incomplete-discovery-cache-key"
    );
    const session = createSession(new AbortController().signal);
    session.sessionId = "stream-discovery-cache-incomplete";
    session.recordProviderSessionRef(1);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 2,
      isFirstAttempt: false,
      isFailoverSuccess: true,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
      bindingIntent: "create",
      bindingSnapshot: {
        sessionId: "stream-discovery-cache-incomplete",
        keyId: 2,
        providerId: null,
        generation: "incomplete-discovery-generation",
      },
      requiresCompletionMarkerForBinding: true,
      discoveryLease: {
        sessionId: "stream-discovery-cache-incomplete",
        keyId: 2,
        ownerToken: "incomplete-discovery-owner",
        ttlSeconds: 30,
      },
      providerSessionRefOwned: true,
    });
    const incomplete = new Response(
      `event: response.output_text.done\ndata: ${JSON.stringify({
        type: "response.output_text.done",
        text: "partial",
      })}\n\n`,
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );

    const downstream = await ProxyResponseHandler.dispatch(session, incomplete);
    await downstream.text();
    for (let index = 0; index < 10 && !getRegisteredTask("post-terminal-side-effects"); index++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const sideEffects = getRegisteredTask("post-terminal-side-effects");
    expect(sideEffects).toBeDefined();
    await expectTaskToResolveWithoutWaiting(sideEffects as Promise<void>);
    await drainAsyncTasks();

    expect(SessionManager.compareAndSetSessionProvider).not.toHaveBeenCalled();
    expect(SessionManager.updateSessionWithCodexCacheKey).not.toHaveBeenCalled();
    expect(SessionManager.releaseSessionDiscoveryLease).toHaveBeenCalledOnce();
  });

  it("does not publish a stream Codex cache binding for a final non-2xx outcome", async () => {
    vi.mocked(SessionManager.extractCodexPromptCacheKey).mockReturnValueOnce("stream-cache-key-2");
    const session = createSession(new AbortController().signal);
    session.sessionId = "stream-codex-cache-binding-failure";
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 500,
    });
    const response = new Response(await createResponsesSse().text(), {
      status: 500,
      headers: { "content-type": "text/event-stream" },
    });

    const downstream = await ProxyResponseHandler.dispatch(session, response);
    await downstream.text();
    await drainAsyncTasks();

    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      123,
      expect.objectContaining({ statusCode: 500 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
    expect(SessionManager.updateSessionWithCodexCacheKey).not.toHaveBeenCalled();
  });

  it("does not publish a Codex cache binding for a Discovery fallback winner", async () => {
    vi.mocked(SessionManager.extractCodexPromptCacheKey).mockReturnValueOnce(
      "fallback-stream-cache-key"
    );
    const session = createSession(new AbortController().signal);
    session.sessionId = "stream-codex-fallback";
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 2,
      totalProvidersAttempted: 2,
      isFirstAttempt: false,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
      bindingIntent: "none",
    });

    const downstream = await ProxyResponseHandler.dispatch(session, createResponsesSse());
    await downstream.text();
    await drainAsyncTasks();

    expect(SessionManager.updateSessionWithCodexCacheKey).not.toHaveBeenCalled();
  });

  it("durably finalizes a Gemini non-stream passthrough body-read failure", async () => {
    const session = createSession(new AbortController().signal, {
      providerType: "gemini",
      originalFormat: "gemini",
      endpoint: "/v1beta/models/gemini-2.0-flash:generateContent",
      model: "gemini-2.0-flash",
    });
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("Gemini non-stream body read failed"));
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );

    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(updateMessageRequestDuration).not.toHaveBeenCalled();
    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        durationMs: expect.any(Number),
        statusCode: 502,
        errorMessage: expect.stringContaining("Gemini non-stream body read failed"),
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
    expect(recordFailure).toHaveBeenCalledTimes(1);
  });
});
