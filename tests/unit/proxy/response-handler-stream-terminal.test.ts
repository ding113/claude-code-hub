import { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyResponseHandler } from "@/app/v1/_lib/proxy/response-handler";
import {
  acquireDetachedStreamLease,
  getDetachedStreamBudgetSnapshot,
} from "@/app/v1/_lib/proxy/detached-stream-budget";
import { ProxySession, type MessageContext } from "@/app/v1/_lib/proxy/session";
import { setDeferredStreamingFinalization } from "@/app/v1/_lib/proxy/stream-finalization";
import type { Key } from "@/types/key";
import type { Provider } from "@/types/provider";
import type { User } from "@/types/user";

type TaskOptions = { readonly abortController?: AbortController };

const mocks = vi.hoisted(() => ({
  durable:
    vi.fn<
      (id: number, details: object, options?: { onCommitted?: () => void }) => Promise<boolean>
    >(),
  tasks: Array.from<Promise<void>>([]),
  trackerEnd: vi.fn(),
  replayObserve: vi.fn(),
  replayComplete: vi.fn(async () => {}),
  replayAbort: vi.fn(async () => {}),
  replayInactive: null as (() => void) | null,
  replayTerminal: null as (() => void) | null,
  replayTerminalState: false,
}));

vi.mock("@/app/v1/_lib/proxy/response-fixer", () => ({
  ResponseFixer: { process: async (_session: ProxySession, response: Response) => response },
}));
vi.mock("@/lib/async-task-manager", () => ({
  AsyncTaskManager: {
    register: (
      _id: string,
      factory: (signal: AbortSignal) => Promise<void>,
      options: string | TaskOptions = "unknown"
    ) => {
      const controller =
        typeof options === "object" && options.abortController
          ? options.abortController
          : new AbortController();
      const task = Promise.resolve().then(() => factory(controller.signal));
      mocks.tasks.push(task);
      return controller;
    },
    touch: vi.fn(() => true),
  },
}));
vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: vi.fn(async () => ({ billNonSuccessfulRequests: false })),
}));
vi.mock("@/lib/langfuse/emit-proxy-trace", () => ({ emitProxyLangfuseTrace: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  },
}));
vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: { getInstance: () => ({ endRequest: mocks.trackerEnd }) },
}));
vi.mock("@/app/v1/_lib/proxy/replay/replay-spool", () => ({
  abortReplayOwnership: vi.fn(async () => undefined),
  createReplaySpoolIfOwner: (
    session: ProxySession,
    _response: Response,
    _delivery: string,
    options: { onInactive?: () => void; onTerminal?: () => void } = {}
  ) => {
    if (session.replayState?.role !== "owner") return null;
    mocks.replayInactive = options.onInactive ?? null;
    mocks.replayTerminal = options.onTerminal ?? null;
    return {
      abort: mocks.replayAbort,
      completeAfterBilling: mocks.replayComplete,
      get isTerminal() {
        return mocks.replayTerminalState;
      },
      observe: mocks.replayObserve,
    };
  },
  releaseReplayOwnership: vi.fn(),
}));
vi.mock("@/repository/message", () => ({
  addMessageRequestHedgeLoserCost: vi.fn(),
  updateMessageRequestCostWithBreakdown: vi.fn(),
  updateMessageRequestDetails: vi.fn(),
  updateMessageRequestDetailsDurably: mocks.durable,
  updateMessageRequestDetailsIfUnfinalized: vi.fn(),
  updateMessageRequestDuration: vi.fn(),
  updateMessageRequestWinnerCost: vi.fn(),
}));

const CREATED_AT = new Date(0);
const USER = {
  createdAt: CREATED_AT,
  dailyQuota: null,
  dailyResetMode: "fixed",
  dailyResetTime: "00:00",
  description: "stream test user",
  id: 21,
  isEnabled: true,
  limit5hResetMode: "fixed",
  name: "stream-user",
  providerGroup: null,
  role: "user",
  rpm: null,
  updatedAt: CREATED_AT,
} satisfies User;
const KEY = {
  cacheTtlPreference: null,
  canLoginWebUi: false,
  createdAt: CREATED_AT,
  dailyResetMode: "fixed",
  dailyResetTime: "00:00",
  id: 22,
  isEnabled: true,
  key: "sk-stream",
  limit5hResetMode: "fixed",
  limit5hUsd: null,
  limitConcurrentSessions: 0,
  limitDailyUsd: null,
  limitMonthlyUsd: null,
  limitWeeklyUsd: null,
  name: "stream-key",
  providerGroup: null,
  updatedAt: CREATED_AT,
  userId: USER.id,
} satisfies Key;
const MESSAGE = {
  apiKey: KEY.key,
  createdAt: CREATED_AT,
  id: 51,
  key: KEY,
  user: USER,
} satisfies MessageContext;

function createProvider(): Provider {
  return {
    activeTimeEnd: null,
    activeTimeStart: null,
    allowedClients: [],
    allowedModels: null,
    anthropicAdaptiveThinking: null,
    anthropicMaxTokensPreference: null,
    anthropicThinkingBudgetPreference: null,
    blockedClients: [],
    cacheTtlPreference: null,
    cc: 0,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    circuitBreakerOpenDuration: 1_800_000,
    codexImageGenerationPreference: null,
    codexParallelToolCallsPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexServiceTierPreference: null,
    codexTextVerbosityPreference: null,
    context1mPreference: null,
    costMultiplier: 1,
    createdAt: CREATED_AT,
    customHeaders: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    disableSessionReuse: false,
    faviconUrl: null,
    firstByteTimeoutStreamingMs: 0,
    geminiGoogleSearchPreference: null,
    groupPriorities: null,
    groupTag: null,
    id: 8,
    isEnabled: true,
    key: "provider-key",
    limit5hResetMode: "fixed",
    limit5hUsd: null,
    limitConcurrentSessions: 0,
    limitDailyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    limitWeeklyUsd: null,
    maxRetryAttempts: null,
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
    modelRedirects: null,
    name: "stream-terminal-provider",
    preserveClientIp: false,
    priority: 1,
    providerType: "claude",
    providerVendorId: null,
    proxyFallbackToDirect: false,
    proxyUrl: null,
    requestTimeoutNonStreamingMs: 0,
    rpd: 0,
    rpm: 0,
    streamingIdleTimeoutMs: 0,
    swapCacheTtlBilling: false,
    totalCostResetAt: null,
    tpm: 0,
    updatedAt: CREATED_AT,
    url: "https://provider.test",
    websiteUrl: null,
    weight: 1,
  } satisfies Provider;
}

async function createSession(options: {
  readonly responseController?: AbortController;
  readonly pathname?: string;
}): Promise<{ readonly releaseAgent: ReturnType<typeof vi.fn>; readonly session: ProxySession }> {
  const request = new Request(`https://hub.test${options.pathname ?? "/v1/messages"}`, {
    body: JSON.stringify({ messages: [], stream: true }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const session = await ProxySession.fromContext(new Context(request));
  const releaseAgent = vi.fn();
  session.setProvider(createProvider());
  session.setMessageContext(MESSAGE);
  Object.defineProperty(session, "releaseAgent", { value: releaseAgent, writable: true });
  if (options.responseController) {
    Object.defineProperty(session, "responseController", { value: options.responseController });
  }
  return { releaseAgent, session };
}

async function settleTasks(): Promise<void> {
  while (mocks.tasks.length > 0) {
    await Promise.all(mocks.tasks.splice(0, mocks.tasks.length));
  }
}

function sseResponse(body: BodyInit, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

function setReplayOwner(session: ProxySession, suffix: string): void {
  session.replayState = {
    role: "owner",
    ownerToken: `owner-token-${suffix}`,
    identity: {
      replayId: `replay-${suffix}`,
      verifier: "verifier",
      scopeTag: "scope-tag",
      keyId: KEY.id,
      userId: USER.id,
      format: "claude",
      model: "claude-test",
      endpoint: "/v1/messages",
    },
  };
}

function setReplayFinalization(session: ProxySession): void {
  setDeferredStreamingFinalization(session, {
    providerId: session.provider?.id ?? 0,
    providerName: session.provider?.name ?? "provider",
    providerPriority: session.provider?.priority ?? 0,
    attemptNumber: 1,
    totalProvidersAttempted: 1,
    isFirstAttempt: true,
    isFailoverSuccess: false,
    endpointId: null,
    endpointUrl: session.provider?.url ?? "",
    upstreamStatusCode: 200,
    bindingIntent: "none",
  });
}

describe("ProxyResponseHandler.dispatch stream terminal behavior", () => {
  beforeEach(() => {
    mocks.tasks.length = 0;
    mocks.replayInactive = null;
    mocks.replayTerminal = null;
    mocks.replayTerminalState = false;
    vi.clearAllMocks();
    mocks.replayAbort.mockImplementation(async () => {
      mocks.replayTerminalState = true;
      mocks.replayInactive?.();
      mocks.replayTerminal?.();
    });
    mocks.replayComplete.mockImplementation(async () => {
      mocks.replayTerminalState = true;
      mocks.replayTerminal?.();
    });
    mocks.durable.mockImplementation(async (_id, _details, options) => {
      await options?.onCommitted?.();
      return true;
    });
  });

  it("persists a naturally completed stream and releases its transport", async () => {
    const { releaseAgent, session } = await createSession({});
    const returned = await ProxyResponseHandler.dispatch(
      session,
      sseResponse('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    );

    await returned.text();
    await settleTasks();

    expect(mocks.durable).toHaveBeenCalledWith(
      51,
      expect.objectContaining({ statusCode: 200 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
    expect(mocks.trackerEnd).toHaveBeenCalledWith(USER.id, MESSAGE.id);
    expect(releaseAgent).toHaveBeenCalledOnce();
  });

  it("透传并计量 Responses incomplete，但不发布 Replay 成功", async () => {
    const { session } = await createSession({});
    session.setProvider({ ...createProvider(), providerType: "codex" });
    session.originalFormat = "response";
    setReplayOwner(session, "responses-incomplete");
    setReplayFinalization(session);
    const body = [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"partial"}\n\n',
      'event: response.incomplete\ndata: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"usage":{"input_tokens":8,"output_tokens":4}}}\n\n',
    ].join("");

    const returned = await ProxyResponseHandler.dispatch(session, sseResponse(body));
    expect(await returned.text()).toBe(body);
    await settleTasks();

    expect(mocks.durable).toHaveBeenCalledWith(
      MESSAGE.id,
      expect.objectContaining({
        statusCode: 200,
        errorMessage: "RESPONSE_INCOMPLETE",
        inputTokens: 8,
        outputTokens: 4,
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
    expect(mocks.replayAbort).toHaveBeenCalledWith("response_incomplete");
    expect(mocks.replayComplete).not.toHaveBeenCalled();
  });

  it("客户端在 Responses incomplete 后断开时不改写为 499", async () => {
    const body =
      'event: response.incomplete\ndata: {"type":"response.incomplete","response":{"status":"incomplete","usage":{"input_tokens":3,"output_tokens":2}}}\n\n';
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
      },
    });
    const { session } = await createSession({});
    session.setProvider({ ...createProvider(), providerType: "codex" });
    session.originalFormat = "response";
    setReplayFinalization(session);

    const returned = await ProxyResponseHandler.dispatch(session, sseResponse(source));
    const reader = returned.body?.getReader();
    expect(new TextDecoder().decode((await reader?.read())?.value)).toBe(body);
    await reader?.cancel(new Error("client disconnected after incomplete"));
    await settleTasks();

    expect(mocks.durable).toHaveBeenCalledWith(
      MESSAGE.id,
      expect.objectContaining({ statusCode: 200, errorMessage: "RESPONSE_INCOMPLETE" }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("does not interpret an opaque raw-passthrough stream as a provider protocol", async () => {
    const { session } = await createSession({ pathname: "/v1/responses/compact" });
    const returned = await ProxyResponseHandler.dispatch(
      session,
      sseResponse("data: opaque upstream bytes\n\n")
    );

    expect(await returned.text()).toBe("data: opaque upstream bytes\n\n");
    await settleTasks();

    expect(mocks.durable).toHaveBeenCalledWith(
      51,
      expect.objectContaining({ statusCode: 200 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("persists a partial client-aborted stream as 499", async () => {
    let abortSource = () => {};
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"partial":true}\n\n'));
        abortSource = () => controller.error(new DOMException("client aborted", "AbortError"));
      },
    });
    const { releaseAgent, session } = await createSession({});
    const returned = await ProxyResponseHandler.dispatch(session, sseResponse(source));
    const reader = returned.body?.getReader();
    expect(reader).toBeDefined();
    await reader?.read();

    await reader?.cancel(new Error("client disconnected"));
    abortSource();
    await settleTasks();

    expect(mocks.durable).toHaveBeenCalledWith(
      51,
      expect.objectContaining({ statusCode: 499 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
    expect(releaseAgent).toHaveBeenCalledOnce();
  });

  it("keeps an admitted detached Replay complete and replayable", async () => {
    const chunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"kept"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":4}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
    let index = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index++];
        if (chunk) controller.enqueue(new TextEncoder().encode(chunk));
      },
    });
    const { session } = await createSession({});
    setReplayOwner(session, "admitted-detached");
    setReplayFinalization(session);

    const returned = await ProxyResponseHandler.dispatch(session, sseResponse(source));
    const reader = returned.body?.getReader();
    await reader?.read();
    await reader?.cancel(new Error("client disconnected"));
    await settleTasks();

    expect(mocks.replayAbort).not.toHaveBeenCalled();
    expect(mocks.replayComplete).toHaveBeenCalledWith(MESSAGE.id);
    const replayedText = mocks.replayObserve.mock.calls
      .map(([chunk]) => new TextDecoder().decode(chunk as Uint8Array))
      .join("");
    expect(replayedText).toContain('"text":"kept"');
    expect(replayedText).toContain("message_stop");
    expect(getDetachedStreamBudgetSnapshot().activeStreams).toBe(0);
  });

  it("persists OpenAI Chat Replay through the wire [DONE] marker", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"kept"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":null}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\n',
      "data: [DONE]\n\n",
    ];
    let index = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index++];
        if (chunk) controller.enqueue(new TextEncoder().encode(chunk));
      },
    });
    const { session } = await createSession({});
    session.setProvider({ ...createProvider(), providerType: "openai" });
    session.originalFormat = "openai";
    setReplayOwner(session, "openai-done");
    setReplayFinalization(session);

    const returned = await ProxyResponseHandler.dispatch(session, sseResponse(source));
    const reader = returned.body?.getReader();
    await reader?.read();
    await reader?.cancel(new Error("client disconnected"));
    await settleTasks();

    const replayedText = mocks.replayObserve.mock.calls
      .map(([chunk]) => new TextDecoder().decode(chunk as Uint8Array))
      .join("");
    expect(replayedText).toContain('"completion_tokens":4');
    expect(replayedText).toContain("data: [DONE]");
    expect(mocks.replayAbort).not.toHaveBeenCalled();
    expect(mocks.replayComplete).toHaveBeenCalledWith(MESSAGE.id);
  });

  it("downgrades a detached Replay to metering when Replay headroom is exhausted", async () => {
    const blocker = acquireDetachedStreamLease("replay", 20 * 1024 * 1024);
    if (!blocker.acquired) throw new Error("expected Replay budget blocker");
    try {
      const chunks = [
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"not replayed"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":4}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ];
      let index = 0;
      const source = new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks[index++];
          if (chunk) controller.enqueue(new TextEncoder().encode(chunk));
        },
      });
      const { session } = await createSession({});
      setReplayOwner(session, "metering-fallback");
      setReplayFinalization(session);

      const returned = await ProxyResponseHandler.dispatch(session, sseResponse(source));
      const reader = returned.body?.getReader();
      await reader?.read();
      const observedBeforeDetach = mocks.replayObserve.mock.calls.length;
      await reader?.cancel(new Error("client disconnected"));
      await settleTasks();

      expect(mocks.replayAbort).toHaveBeenCalledWith("detached_replay_metering_reserve");
      expect(mocks.replayObserve.mock.calls.length).toBe(observedBeforeDetach);
      expect(mocks.durable).toHaveBeenCalledWith(
        MESSAGE.id,
        expect.objectContaining({ statusCode: 200, inputTokens: 10, outputTokens: 4 }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
    } finally {
      blocker.lease.release();
    }
    expect(getDetachedStreamBudgetSnapshot().activeStreams).toBe(0);
  });

  it("caps a detached Replay drain at 60 seconds after the spool becomes inactive", async () => {
    vi.useFakeTimers();
    const previousReplayDetachedMs = process.env.REPLAY_MAX_DETACHED_MS;
    process.env.REPLAY_MAX_DETACHED_MS = "300000";
    try {
      const cancelSource = vi.fn();
      const responseController = new AbortController();
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"partial":true}\n\n'));
        },
        cancel: cancelSource,
      });
      const { session } = await createSession({ responseController });
      setReplayOwner(session, "detached");

      const returned = await ProxyResponseHandler.dispatch(session, sseResponse(source));
      const reader = returned.body?.getReader();
      await reader?.read();
      await reader?.cancel(new Error("client disconnected"));

      expect(mocks.replayInactive).toEqual(expect.any(Function));
      expect(getDetachedStreamBudgetSnapshot().activeByKind).toEqual({
        loser: 0,
        metering: 0,
        replay: 1,
      });
      await vi.advanceTimersByTimeAsync(59_999);
      expect(responseController.signal.aborted).toBe(false);

      mocks.replayTerminalState = true;
      mocks.replayInactive?.();
      expect(getDetachedStreamBudgetSnapshot().activeByKind).toEqual({
        loser: 0,
        metering: 1,
        replay: 1,
      });
      mocks.replayTerminal?.();
      expect(getDetachedStreamBudgetSnapshot().activeByKind).toEqual({
        loser: 0,
        metering: 1,
        replay: 0,
      });
      await vi.advanceTimersByTimeAsync(1);

      expect(responseController.signal.aborted).toBe(true);
      expect(responseController.signal.reason).toEqual(
        expect.objectContaining({ message: "client_abort_drain_timeout" })
      );
      expect(cancelSource).toHaveBeenCalledOnce();
      await settleTasks();
      expect(getDetachedStreamBudgetSnapshot().activeStreams).toBe(0);
    } finally {
      if (previousReplayDetachedMs === undefined) {
        delete process.env.REPLAY_MAX_DETACHED_MS;
      } else {
        process.env.REPLAY_MAX_DETACHED_MS = previousReplayDetachedMs;
      }
      vi.useRealTimers();
    }
  });

  it("keeps the configured 300-second drain while the Replay spool remains active", async () => {
    vi.useFakeTimers();
    const previousReplayDetachedMs = process.env.REPLAY_MAX_DETACHED_MS;
    process.env.REPLAY_MAX_DETACHED_MS = "300000";
    try {
      const cancelSource = vi.fn();
      const responseController = new AbortController();
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"partial":true}\n\n'));
        },
        cancel: cancelSource,
      });
      const { session } = await createSession({ responseController });
      setReplayOwner(session, "active");

      const returned = await ProxyResponseHandler.dispatch(session, sseResponse(source));
      const reader = returned.body?.getReader();
      await reader?.read();
      await reader?.cancel(new Error("client disconnected"));

      await vi.advanceTimersByTimeAsync(60_000);
      expect(responseController.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(239_999);
      expect(responseController.signal.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(1);

      expect(responseController.signal.aborted).toBe(true);
      expect(cancelSource).toHaveBeenCalledOnce();
      await settleTasks();
    } finally {
      if (previousReplayDetachedMs === undefined) {
        delete process.env.REPLAY_MAX_DETACHED_MS;
      } else {
        process.env.REPLAY_MAX_DETACHED_MS = previousReplayDetachedMs;
      }
      vi.useRealTimers();
    }
  });

  it("uses the 60-second drain when Replay becomes inactive before client detach", async () => {
    vi.useFakeTimers();
    const previousReplayDetachedMs = process.env.REPLAY_MAX_DETACHED_MS;
    process.env.REPLAY_MAX_DETACHED_MS = "300000";
    try {
      const cancelSource = vi.fn();
      const responseController = new AbortController();
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"partial":true}\n\n'));
        },
        cancel: cancelSource,
      });
      const { session } = await createSession({ responseController });
      setReplayOwner(session, "inactive-before-detach");

      const returned = await ProxyResponseHandler.dispatch(session, sseResponse(source));
      const reader = returned.body?.getReader();
      await reader?.read();
      expect(mocks.replayInactive).toEqual(expect.any(Function));
      mocks.replayInactive?.();
      await reader?.cancel(new Error("client disconnected"));

      await vi.advanceTimersByTimeAsync(59_999);
      expect(responseController.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(responseController.signal.aborted).toBe(true);
      expect(cancelSource).toHaveBeenCalledOnce();
      await settleTasks();
    } finally {
      if (previousReplayDetachedMs === undefined) {
        delete process.env.REPLAY_MAX_DETACHED_MS;
      } else {
        process.env.REPLAY_MAX_DETACHED_MS = previousReplayDetachedMs;
      }
      vi.useRealTimers();
    }
  });

  it("persists a response-controller timeout as 502 and cancels the source", async () => {
    const cancelSource = vi.fn();
    const responseController = new AbortController();
    const source = new ReadableStream<Uint8Array>({ cancel: cancelSource });
    const { releaseAgent, session } = await createSession({ responseController });
    const returned = await ProxyResponseHandler.dispatch(session, sseResponse(source));
    const bodyRead = returned.text();

    responseController.abort(new Error("response deadline exceeded"));
    await expect(bodyRead).rejects.toThrow("response deadline exceeded");
    await settleTasks();

    expect(mocks.durable).toHaveBeenCalledWith(
      51,
      expect.objectContaining({ statusCode: 502 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
    expect(cancelSource).toHaveBeenCalledOnce();
    expect(releaseAgent).toHaveBeenCalledOnce();
  });

  it("fails closed on a late Gemini passthrough NDJSON error", async () => {
    const { session } = await createSession({});
    session.setProvider({ ...createProvider(), providerType: "gemini" });
    session.originalFormat = "gemini";
    const body = [
      '{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
      '{"error":{"message":"late upstream failure"}}',
      "",
    ].join("\n");

    const returned = await ProxyResponseHandler.dispatch(session, sseResponse(body));
    await returned.text();
    await settleTasks();

    expect(mocks.durable).toHaveBeenCalledWith(
      MESSAGE.id,
      expect.objectContaining({ statusCode: 502 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("observes native Gemini failures before transforming the client stream", async () => {
    const { session } = await createSession({});
    session.setProvider({ ...createProvider(), providerType: "gemini" });
    session.originalFormat = "claude";
    const body = [
      'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n',
      'data: {"error":{"message":"late upstream failure"}}\n\n',
    ].join("");

    const returned = await ProxyResponseHandler.dispatch(session, sseResponse(body));
    await returned.text();
    await settleTasks();

    expect(mocks.durable).toHaveBeenCalledWith(
      MESSAGE.id,
      expect.objectContaining({ statusCode: 502 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("preserves Gemini UTF-8 characters split across network chunks during conversion", async () => {
    const { session } = await createSession({});
    session.setProvider({ ...createProvider(), providerType: "gemini" });
    session.originalFormat = "claude";
    const prefix = 'data: {"candidates":[{"content":{"parts":[{"text":"';
    const suffix =
      '"}]}}]}\n\ndata: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":2}}\n\n';
    const encoder = new TextEncoder();
    const bytes = encoder.encode(`${prefix}你好😀${suffix}`);
    const splitAt = encoder.encode(`${prefix}你好`).byteLength + 2;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, splitAt));
        controller.enqueue(bytes.subarray(splitAt));
        controller.close();
      },
    });

    const returned = await ProxyResponseHandler.dispatch(session, sseResponse(source));
    expect(await returned.text()).toContain("你好😀");
    await settleTasks();

    expect(mocks.durable).toHaveBeenCalledWith(
      MESSAGE.id,
      expect.objectContaining({ statusCode: 200 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("accepts a large Gemini chunk composed of complete short lines", async () => {
    const { session } = await createSession({});
    session.setProvider({ ...createProvider(), providerType: "gemini" });
    session.originalFormat = "claude";
    const frame = 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n';
    const body = `${frame.repeat(Math.ceil((1024 * 1024 + 1) / frame.length))}data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":2}}\n\n`;

    const returned = await ProxyResponseHandler.dispatch(session, sseResponse(body));
    const returnedText = await returned.text();
    expect(returnedText.length).toBeGreaterThan(1024 * 1024);
    await settleTasks();

    expect(mocks.durable).toHaveBeenCalledWith(
      MESSAGE.id,
      expect.objectContaining({ statusCode: 200 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("treats malformed after wrapped Gemini content as postcommit", async () => {
    const { session } = await createSession({});
    session.setProvider({ ...createProvider(), providerType: "gemini" });
    session.originalFormat = "gemini";
    const body = [
      '{"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}}',
      "{not-json}",
      '{"response":{"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":2}}}',
      "",
    ].join("\n");

    const returned = await ProxyResponseHandler.dispatch(session, sseResponse(body));
    expect(await returned.text()).toBe(body);
    await settleTasks();

    expect(mocks.durable).toHaveBeenCalledWith(
      MESSAGE.id,
      expect.objectContaining({ inputTokens: 10, outputTokens: 2, statusCode: 200 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("bills a naturally completed postcommit malformed stream with terminal usage but rejects Replay", async () => {
    const { session } = await createSession({});
    session.setProvider({ ...createProvider(), providerType: "codex" });
    session.originalFormat = "response";
    session.replayState = {
      role: "owner",
      ownerToken: "owner-token-malformed-usage",
      identity: {
        replayId: "replay-malformed-usage",
        verifier: "verifier",
        scopeTag: "scope-tag",
        keyId: KEY.id,
        userId: USER.id,
        format: "response",
        model: "gpt-test",
        endpoint: "/v1/responses",
      },
    };
    setDeferredStreamingFinalization(session, {
      providerId: session.provider?.id ?? 0,
      providerName: session.provider?.name ?? "provider",
      providerPriority: session.provider?.priority ?? 0,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: null,
      endpointUrl: session.provider?.url ?? "",
      upstreamStatusCode: 200,
      bindingIntent: "none",
    });
    const malformed = "event: response.in_progress\ndata: not-json\n\n";
    const body = [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n',
      malformed,
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":10,"output_tokens":2}}}\n\n',
    ].join("");

    const returned = await ProxyResponseHandler.dispatch(session, sseResponse(body));
    expect(await returned.text()).toContain(malformed);
    await settleTasks();

    expect(mocks.durable).toHaveBeenCalledWith(
      MESSAGE.id,
      expect.objectContaining({ inputTokens: 10, outputTokens: 2, statusCode: 200 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
    expect(mocks.replayAbort).toHaveBeenLastCalledWith("protocol_malformed");
    expect(mocks.replayComplete).not.toHaveBeenCalled();
  });

  it("rejects a Responses usage payload without a valid completion marker after malformed", async () => {
    const { session } = await createSession({});
    session.setProvider({ ...createProvider(), providerType: "codex" });
    session.originalFormat = "response";
    setDeferredStreamingFinalization(session, {
      providerId: session.provider?.id ?? 0,
      providerName: session.provider?.name ?? "provider",
      providerPriority: session.provider?.priority ?? 0,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: null,
      endpointUrl: session.provider?.url ?? "",
      upstreamStatusCode: 200,
      bindingIntent: "none",
    });
    const body = [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n',
      "event: response.in_progress\ndata: not-json\n\n",
      'event: unrelated.event\ndata: {"type":"response.completed","usage":{"output_tokens":2}}\n\n',
    ].join("");

    const returned = await ProxyResponseHandler.dispatch(session, sseResponse(body));
    expect(await returned.text()).toBe(body);
    await settleTasks();

    expect(mocks.durable).toHaveBeenCalledWith(
      MESSAGE.id,
      expect.objectContaining({ statusCode: 502 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it.each([
    {
      label: "Anthropic",
      providerType: "claude" as const,
      format: "claude" as const,
      body: [
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"ok"}}\n\n',
        "event: ping\ndata: not-json\n\n",
        'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":2}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ].join(""),
    },
    {
      label: "OpenAI Chat",
      providerType: "openai-compatible" as const,
      format: "openai" as const,
      body: [
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        "data: not-json\n\n",
        'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n',
        "data: [DONE]\n\n",
      ].join(""),
    },
    {
      label: "Gemini",
      providerType: "gemini" as const,
      format: "gemini" as const,
      body: [
        '{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
        "{not-json}",
        '{"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":2}}',
        "",
      ].join("\n"),
    },
  ])(
    "records a naturally completed $label postcommit malformed stream as successful with terminal usage",
    async ({ providerType, format, body }) => {
      const { session } = await createSession({});
      session.setProvider({ ...createProvider(), providerType });
      session.originalFormat = format;
      setDeferredStreamingFinalization(session, {
        providerId: session.provider?.id ?? 0,
        providerName: session.provider?.name ?? "provider",
        providerPriority: session.provider?.priority ?? 0,
        attemptNumber: 1,
        totalProvidersAttempted: 1,
        isFirstAttempt: true,
        isFailoverSuccess: false,
        endpointId: null,
        endpointUrl: session.provider?.url ?? "",
        upstreamStatusCode: 200,
        bindingIntent: "none",
      });

      const returned = await ProxyResponseHandler.dispatch(session, sseResponse(body));
      expect(await returned.text()).toBe(body);
      await settleTasks();

      expect(mocks.durable).toHaveBeenCalledWith(
        MESSAGE.id,
        expect.objectContaining({ inputTokens: 10, outputTokens: 2, statusCode: 200 }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
    }
  );

  it("does not treat Anthropic message_start usage as terminal usage evidence", async () => {
    const { session } = await createSession({});
    setDeferredStreamingFinalization(session, {
      providerId: session.provider?.id ?? 0,
      providerName: session.provider?.name ?? "provider",
      providerPriority: session.provider?.priority ?? 0,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: null,
      endpointUrl: session.provider?.url ?? "",
      upstreamStatusCode: 200,
      bindingIntent: "none",
    });
    const body = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"ok"}}\n\n',
      "event: ping\ndata: not-json\n\n",
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join("");

    const returned = await ProxyResponseHandler.dispatch(session, sseResponse(body));
    expect(await returned.text()).toBe(body);
    await settleTasks();

    expect(mocks.durable).toHaveBeenCalledWith(
      MESSAGE.id,
      expect.objectContaining({ statusCode: 502 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("does not treat zero terminal usage as billable success after malformed", async () => {
    const { session } = await createSession({});
    session.setProvider({ ...createProvider(), providerType: "codex" });
    session.originalFormat = "response";
    setDeferredStreamingFinalization(session, {
      providerId: session.provider?.id ?? 0,
      providerName: session.provider?.name ?? "provider",
      providerPriority: session.provider?.priority ?? 0,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: null,
      endpointUrl: session.provider?.url ?? "",
      upstreamStatusCode: 200,
      bindingIntent: "none",
    });
    const body = [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n',
      "event: response.in_progress\ndata: not-json\n\n",
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":0,"output_tokens":0}}}\n\n',
    ].join("");

    const returned = await ProxyResponseHandler.dispatch(session, sseResponse(body));
    expect(await returned.text()).toBe(body);
    await settleTasks();

    expect(mocks.durable).toHaveBeenCalledWith(
      MESSAGE.id,
      expect.objectContaining({ statusCode: 502 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it.each([
    {
      label: "OpenAI Responses",
      providerType: "codex" as const,
      format: "response" as const,
      body: [
        'event: response.in_progress\ndata: {"type":"response.in_progress","response":{"status":"in_progress","usage":{"input_tokens":10}}}\n\n',
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n',
        "event: response.in_progress\ndata: not-json\n\n",
        'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{}}}\n\n',
      ].join(""),
    },
    {
      label: "Anthropic",
      providerType: "claude" as const,
      format: "claude" as const,
      body: [
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"ok"}}\n\n',
        "event: ping\ndata: not-json\n\n",
        'event: message_delta\ndata: {"type":"message_delta","usage":{}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ].join(""),
    },
    {
      label: "OpenAI Chat",
      providerType: "openai-compatible" as const,
      format: "openai" as const,
      body: [
        'data: {"choices":[{"delta":{"role":"assistant"}}],"usage":{"prompt_tokens":10}}\n\n',
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        "data: not-json\n\n",
        'data: {"choices":[],"usage":{}}\n\n',
        "data: [DONE]\n\n",
      ].join(""),
    },
    {
      label: "Gemini",
      providerType: "gemini" as const,
      format: "gemini" as const,
      body: [
        '{"usageMetadata":{"promptTokenCount":10}}',
        '{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
        "{not-json}",
        '{"candidates":[{"finishReason":"STOP"}],"usageMetadata":{}}',
        "",
      ].join("\n"),
    },
  ])(
    "does not combine early $label usage with empty terminal usage after malformed",
    async ({ providerType, format, body }) => {
      const { session } = await createSession({});
      session.setProvider({ ...createProvider(), providerType });
      session.originalFormat = format;
      setDeferredStreamingFinalization(session, {
        providerId: session.provider?.id ?? 0,
        providerName: session.provider?.name ?? "provider",
        providerPriority: session.provider?.priority ?? 0,
        attemptNumber: 1,
        totalProvidersAttempted: 1,
        isFirstAttempt: true,
        isFailoverSuccess: false,
        endpointId: null,
        endpointUrl: session.provider?.url ?? "",
        upstreamStatusCode: 200,
        bindingIntent: "none",
      });

      const returned = await ProxyResponseHandler.dispatch(session, sseResponse(body));
      expect(await returned.text()).toBe(body);
      await settleTasks();

      expect(mocks.durable).toHaveBeenCalledWith(
        MESSAGE.id,
        expect.objectContaining({ statusCode: 502 }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
    }
  );

  it.each([
    {
      label: "OpenAI Responses",
      providerType: "codex" as const,
      format: "response" as const,
      body: [
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n',
        "event: response.in_progress\ndata: not-json\n\n",
        'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
      ].join(""),
    },
    {
      label: "Anthropic",
      providerType: "claude" as const,
      format: "claude" as const,
      body: [
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"ok"}}\n\n',
        "event: ping\ndata: not-json\n\n",
        'event: message_delta\ndata: {"type":"message_delta","usage":{"input_tokens":10,"output_tokens":0}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ].join(""),
    },
    {
      label: "OpenAI Chat",
      providerType: "openai-compatible" as const,
      format: "openai" as const,
      body: [
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        "data: not-json\n\n",
        'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":0}}\n\n',
        "data: [DONE]\n\n",
      ].join(""),
    },
    {
      label: "Gemini",
      providerType: "gemini" as const,
      format: "gemini" as const,
      body: [
        '{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
        "{not-json}",
        '{"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":0}}',
        "",
      ].join("\n"),
    },
  ])(
    "does not treat terminal input-only $label usage as successful after malformed",
    async ({ providerType, format, body }) => {
      const { session } = await createSession({});
      session.setProvider({ ...createProvider(), providerType });
      session.originalFormat = format;
      setDeferredStreamingFinalization(session, {
        providerId: session.provider?.id ?? 0,
        providerName: session.provider?.name ?? "provider",
        providerPriority: session.provider?.priority ?? 0,
        attemptNumber: 1,
        totalProvidersAttempted: 1,
        isFirstAttempt: true,
        isFailoverSuccess: false,
        endpointId: null,
        endpointUrl: session.provider?.url ?? "",
        upstreamStatusCode: 200,
        bindingIntent: "none",
      });

      const returned = await ProxyResponseHandler.dispatch(session, sseResponse(body));
      expect(await returned.text()).toBe(body);
      await settleTasks();

      expect(mocks.durable).toHaveBeenCalledWith(
        MESSAGE.id,
        expect.objectContaining({ statusCode: 502 }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
    }
  );

  it("allows observation overflow to complete a successful Replay entry", async () => {
    const { session } = await createSession({});
    session.setProvider({ ...createProvider(), providerType: "codex" });
    session.originalFormat = "response";
    session.replayState = {
      role: "owner",
      ownerToken: "owner-token-overflow",
      identity: {
        replayId: "replay-overflow",
        verifier: "verifier",
        scopeTag: "scope-tag",
        keyId: KEY.id,
        userId: USER.id,
        format: "response",
        model: "gpt-test",
        endpoint: "/v1/responses",
      },
    };
    setDeferredStreamingFinalization(session, {
      providerId: session.provider?.id ?? 0,
      providerName: session.provider?.name ?? "provider",
      providerPriority: session.provider?.priority ?? 0,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: null,
      endpointUrl: session.provider?.url ?? "",
      upstreamStatusCode: 200,
      bindingIntent: "none",
    });
    const oversizedDelta = "x".repeat(10 * 1024 * 1024 + 1);
    const body = [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n',
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: oversizedDelta })}\n\n`,
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":10,"output_tokens":2}}}\n\n',
    ].join("");

    const returned = await ProxyResponseHandler.dispatch(session, sseResponse(body));
    expect((await returned.text()).length).toBe(body.length);
    await settleTasks();

    expect(mocks.durable).toHaveBeenCalledWith(
      MESSAGE.id,
      expect.objectContaining({ inputTokens: 10, outputTokens: 2, statusCode: 200 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
    expect(mocks.replayAbort).not.toHaveBeenCalled();
    expect(mocks.replayComplete).toHaveBeenCalledWith(MESSAGE.id);
  });

  it("aborts Replay when a late protocol error is outside the bounded text snapshot", async () => {
    const { session } = await createSession({});
    session.setProvider({ ...createProvider(), providerType: "codex" });
    session.originalFormat = "response";
    session.replayState = {
      role: "owner",
      ownerToken: "owner-token",
      identity: {
        replayId: "replay-id",
        verifier: "verifier",
        scopeTag: "scope-tag",
        keyId: KEY.id,
        userId: USER.id,
        format: "response",
        model: "gpt-test",
        endpoint: "/v1/responses",
      },
    };
    setDeferredStreamingFinalization(session, {
      providerId: session.provider?.id ?? 0,
      providerName: session.provider?.name ?? "provider",
      providerPriority: session.provider?.priority ?? 0,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: null,
      endpointUrl: session.provider?.url ?? "",
      upstreamStatusCode: 200,
      bindingIntent: "none",
    });

    const headFiller = "x".repeat(2 * 1024 * 1024);
    const tailFiller = "y".repeat(10 * 1024 * 1024);
    const body = [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n',
      `event: response.in_progress\ndata: ${JSON.stringify({ type: "response.in_progress", headFiller })}\n\n`,
      'event: response.failed\ndata: {"type":"response.failed","response":{"status":"failed"}}\n\n',
      `event: response.in_progress\ndata: ${JSON.stringify({ type: "response.in_progress", tailFiller })}\n\n`,
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
    ].join("");

    const returned = await ProxyResponseHandler.dispatch(session, sseResponse(body));
    await returned.text();
    await settleTasks();

    expect(mocks.replayAbort).toHaveBeenCalledWith(
      expect.stringContaining("UPSTREAM_PROTOCOL_ERROR")
    );
    expect(mocks.replayComplete).not.toHaveBeenCalled();
    expect(mocks.durable).toHaveBeenCalledWith(
      MESSAGE.id,
      expect.objectContaining({ statusCode: 502 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("does not recover malformed when a later protocol error is outside the bounded snapshot", async () => {
    const { session } = await createSession({});
    session.setProvider({ ...createProvider(), providerType: "codex" });
    session.originalFormat = "response";
    session.replayState = {
      role: "owner",
      ownerToken: "owner-token-malformed-then-error",
      identity: {
        replayId: "replay-malformed-then-error",
        verifier: "verifier",
        scopeTag: "scope-tag",
        keyId: KEY.id,
        userId: USER.id,
        format: "response",
        model: "gpt-test",
        endpoint: "/v1/responses",
      },
    };
    const headFiller = "x".repeat(2 * 1024 * 1024);
    const tailFiller = "y".repeat(10 * 1024 * 1024);
    const body = [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n',
      "event: response.in_progress\ndata: not-json\n\n",
      `event: response.in_progress\ndata: ${JSON.stringify({ type: "response.in_progress", headFiller })}\n\n`,
      'event: response.failed\ndata: {"type":"response.failed","response":{"status":"failed"}}\n\n',
      `event: response.in_progress\ndata: ${JSON.stringify({ type: "response.in_progress", tailFiller })}\n\n`,
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":10,"output_tokens":2}}}\n\n',
    ].join("");

    const returned = await ProxyResponseHandler.dispatch(session, sseResponse(body));
    expect((await returned.text()).length).toBe(body.length);
    await settleTasks();

    expect(mocks.durable).toHaveBeenCalledWith(
      MESSAGE.id,
      expect.objectContaining({ statusCode: 502 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
    expect(mocks.replayAbort).toHaveBeenLastCalledWith("protocol_malformed");
    expect(mocks.replayComplete).not.toHaveBeenCalled();
  });

  it("aborts Replay when a successful non-200 2xx stream contains a late protocol error", async () => {
    const { session } = await createSession({});
    session.setProvider({ ...createProvider(), providerType: "codex" });
    session.originalFormat = "response";
    session.replayState = {
      role: "owner",
      ownerToken: "owner-token",
      identity: {
        replayId: "replay-id-201",
        verifier: "verifier",
        scopeTag: "scope-tag",
        keyId: KEY.id,
        userId: USER.id,
        format: "response",
        model: "gpt-test",
        endpoint: "/v1/responses",
      },
    };
    setDeferredStreamingFinalization(session, {
      providerId: session.provider?.id ?? 0,
      providerName: session.provider?.name ?? "provider",
      providerPriority: session.provider?.priority ?? 0,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: null,
      endpointUrl: session.provider?.url ?? "",
      upstreamStatusCode: 201,
      bindingIntent: "none",
    });
    const body = [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
      'event: response.failed\ndata: {"type":"response.failed","response":{"status":"failed"}}\n\n',
    ].join("");

    const returned = await ProxyResponseHandler.dispatch(session, sseResponse(body, 201));
    await returned.text();
    await settleTasks();

    expect(mocks.replayAbort).toHaveBeenCalledWith(
      expect.stringContaining("UPSTREAM_PROTOCOL_ERROR")
    );
    expect(mocks.replayComplete).not.toHaveBeenCalled();
    expect(mocks.durable).toHaveBeenCalledWith(
      MESSAGE.id,
      expect.objectContaining({ statusCode: 502 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });
});
