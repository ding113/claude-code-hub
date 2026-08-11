import { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyResponseHandler } from "@/app/v1/_lib/proxy/response-handler";
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
  createReplaySpoolIfOwner: (session: ProxySession) =>
    session.replayState?.role === "owner"
      ? {
          abort: mocks.replayAbort,
          completeAfterBilling: mocks.replayComplete,
          isTerminal: false,
          onTerminal: () => () => {},
          observe: mocks.replayObserve,
        }
      : null,
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
}): Promise<{ readonly releaseAgent: ReturnType<typeof vi.fn>; readonly session: ProxySession }> {
  const request = new Request("https://hub.test/v1/messages", {
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

describe("ProxyResponseHandler.dispatch stream terminal behavior", () => {
  beforeEach(() => {
    mocks.tasks.length = 0;
    vi.clearAllMocks();
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
