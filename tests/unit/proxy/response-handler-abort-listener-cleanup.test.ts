import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import { ProxyResponseHandler } from "@/app/v1/_lib/proxy/response-handler";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

const testState = vi.hoisted(() => ({
  asyncTasks: [] as Promise<void>[],
  cancelTask: vi.fn(),
  cleanupTask: vi.fn(),
  responseFixerProcess: vi.fn(async (_session: unknown, response: Response) => response),
}));

vi.mock("@/app/v1/_lib/proxy/response-fixer", () => ({
  ResponseFixer: {
    process: testState.responseFixerProcess,
  },
}));

vi.mock("@/lib/async-task-manager", () => ({
  AsyncTaskManager: {
    register: (
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
      testState.asyncTasks.push(promise);
      return controller;
    },
    touch: () => true,
    cleanup: testState.cleanupTask,
    cancel: testState.cancelTask,
  },
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
  },
}));

vi.mock("@/lib/redis/live-chain-store", () => ({
  deleteLiveChain: vi.fn(),
  writeLiveRoutingTrace: vi.fn(),
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    clearSessionProvider: vi.fn(),
    storeSessionResponse: vi.fn(),
    storeSessionResponseBodySet: vi.fn(async () => undefined),
    updateSessionUsage: vi.fn(),
    storeSessionRequestPhaseSnapshot: vi.fn(),
    storeSessionResponsePhaseSnapshot: vi.fn(),
    storeSessionUpstreamRequestMeta: vi.fn(),
    storeSessionSpecialSettings: vi.fn(),
    storeSessionRequestHeaders: vi.fn(),
    storeSessionResponseHeaders: vi.fn(),
    storeSessionUpstreamResponseMeta: vi.fn(),
  },
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    refreshSession: vi.fn(),
  },
}));

vi.mock("@/lib/circuit-breaker", () => ({
  recordFailure: vi.fn(),
}));

vi.mock("@/lib/endpoint-circuit-breaker", () => ({
  recordEndpointFailure: vi.fn(),
  recordEndpointSuccess: vi.fn(),
  resetEndpointCircuit: vi.fn(),
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestCostWithBreakdown: vi.fn(),
  updateMessageRequestDetails: vi.fn(),
  updateMessageRequestDetailsDurably: vi.fn(async () => {}),
  updateMessageRequestDetailsIfUnfinalized: vi.fn(async () => {}),
  updateMessageRequestDuration: vi.fn(),
}));

async function drainAsyncTasks(): Promise<void> {
  while (testState.asyncTasks.length > 0) {
    const tasks = testState.asyncTasks.splice(0);
    const settlements = await Promise.allSettled(tasks);
    const failures = settlements
      .filter((settlement): settlement is PromiseRejectedResult => settlement.status === "rejected")
      .map((settlement) => settlement.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, "Async task failed during test drain");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 99,
    name: "test-provider",
    providerType: "openai",
    baseUrl: "https://api.test.invalid",
    priority: 1,
    weight: 1,
    costMultiplier: 1,
    groupTag: "default",
    isEnabled: true,
    models: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    streamingIdleTimeoutMs: 0,
    ...overrides,
  } as Provider;
}

function makeSession(clientAbortSignal: AbortSignal | null, stream: boolean): ProxySession {
  const endpointPolicy = resolveEndpointPolicy("/v1/chat/completions");
  const provider = makeProvider();
  const session = {
    request: {
      model: "gpt-5.5",
      log: "",
      message: {
        model: "gpt-5.5",
        stream,
        messages: [{ role: "user", content: "hello" }],
      },
    },
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("http://localhost/v1/chat/completions"),
    headers: new Headers(),
    headerLog: "",
    userAgent: null,
    context: {},
    clientAbortSignal,
    forwardedRequestBody: "",
    userName: "test-user",
    authState: {
      success: true,
      user: { id: 1, name: "test-user" },
      key: { id: 2, name: "test-key" },
      apiKey: "test-key",
    },
    provider,
    messageContext: {
      id: 123,
      user: { id: 1, name: "test-user" },
      key: { id: 2, name: "test-key" },
      isSystemPrompt: false,
      requireAuth: true,
      createdAt: new Date(),
    },
    sessionId: null,
    requestSequence: 1,
    originalFormat: "openai",
    providerType: "openai",
    originalModelName: "gpt-5.5",
    originalUrlPathname: "/v1/chat/completions",
    providerChain: [],
    cacheTtlResolved: null,
    context1mApplied: false,
    specialSettings: [],
    cachedPriceData: undefined,
    cachedBillingModelSource: undefined,
    endpointPolicy,
    isHeaderModified: () => false,
    getEndpointPolicy: () => endpointPolicy,
    getContext1mApplied: () => false,
    getGroupCostMultiplier: () => 1,
    getOriginalModel: () => "gpt-5.5",
    getCurrentModel: () => "gpt-5.5",
    getProviderChain: () => [],
    getSpecialSettings: () => [],
    shouldPersistSessionDebugArtifacts: () => false,
    shouldTrackSessionObservability: () => false,
    getResolvedPricingByBillingSource: async () => null,
    recordTtft: vi.fn(),
    ttftMs: null,
    firstByteMs: null,
    addProviderToChain: vi.fn(),
    clearResponseTimeout: vi.fn(),
    releaseAgent: vi.fn(),
  };

  return session as unknown as ProxySession;
}

function makeCodexResponsesSession(stream = true): ProxySession {
  const session = makeSession(null, stream) as ProxySession & {
    endpointPolicy: ReturnType<typeof resolveEndpointPolicy>;
  };
  const endpointPolicy = resolveEndpointPolicy("/v1/responses");
  session.provider = makeProvider({ providerType: "codex" });
  session.providerType = "codex";
  session.originalFormat = "response";
  session.originalUrlPathname = "/v1/responses";
  session.requestUrl = new URL("http://localhost/v1/responses");
  session.endpointPolicy = endpointPolicy;
  session.getEndpointPolicy = () => endpointPolicy;
  session.getEndpoint = () => "/v1/responses";
  return session;
}

function makeRemoteCompactionV2Session(): ProxySession {
  const session = makeCodexResponsesSession() as ProxySession & {
    endpointPolicy: ReturnType<typeof resolveEndpointPolicy>;
  };
  const endpointPolicy = resolveEndpointPolicy("/v1/responses/compact");
  session.endpointPolicy = endpointPolicy;
  session.getEndpointPolicy = () => endpointPolicy;
  session.request.message.input = [{ type: "compaction_trigger" }];
  return session;
}

const CODEX_RESPONSES_SSE = [
  'event: response.created\ndata: {"response":{"id":"resp_missing_header"}}\n\n',
  [
    'event: response.completed\ndata: {"response":{"id":"resp_missing_header",',
    '"status":"completed","usage":{"input_tokens":1,"output_tokens":2}},',
    '"sequence_number":3}\n\n',
  ].join(""),
].join("");

const REMOTE_COMPACTION_V2_SSE = [
  [
    'event: response.output_item.done\ndata: {"type":"response.output_item.done",',
    '"output_index":0,"item":{"type":"compaction",',
    '"encrypted_content":"opaque-state"}}\n\n',
  ].join(""),
  [
    'event: response.completed\ndata: {"type":"response.completed",',
    '"response":{"id":"resp_compact","status":"completed",',
    '"output":[{"type":"compaction","encrypted_content":"opaque-state"}]}}\n\n',
  ].join(""),
].join("");

describe("ProxyResponseHandler client abort listener cleanup", () => {
  beforeEach(() => {
    testState.asyncTasks = [];
    testState.cancelTask.mockClear();
    testState.cleanupTask.mockClear();
    testState.responseFixerProcess.mockClear();
    vi.restoreAllMocks();
  });

  it("removes non-stream client abort listener after response processing completes", async () => {
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
    const session = makeSession(controller.signal, false);
    const upstreamResponse = new Response(
      JSON.stringify({
        choices: [{ message: { content: "ok" } }],
      }),
      {
        headers: { "content-type": "application/json" },
      }
    );

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await response.text();
    await drainAsyncTasks();

    const abortAddCalls = addSpy.mock.calls.filter(([type]) => type === "abort");
    expect(abortAddCalls).toHaveLength(1);
    expect(removeSpy).toHaveBeenCalledWith("abort", abortAddCalls[0][1]);
  });

  it("removes stream client abort listener after stream processing completes", async () => {
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
    const session = makeSession(controller.signal, true);
    const upstreamResponse = new Response(
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
      {
        headers: { "content-type": "text/event-stream" },
      }
    );

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await response.text();
    await drainAsyncTasks();

    const abortAddCalls = addSpy.mock.calls.filter(([type]) => type === "abort");
    expect(abortAddCalls).toHaveLength(1);
    expect(removeSpy).toHaveBeenCalledWith("abort", abortAddCalls[0][1]);
  });

  it("preserves Codex Responses SSE without cloning a missing-header stream", async () => {
    const session = makeCodexResponsesSession();
    session.sessionId = "session-debug-artifacts";
    session.shouldPersistSessionDebugArtifacts = () => true;
    const upstreamResponse = new Response(new TextEncoder().encode(CODEX_RESPONSES_SSE));
    const cloneSpy = vi.spyOn(upstreamResponse, "clone");
    expect(upstreamResponse.headers.get("content-type")).toBeNull();

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    const responseText = await response.text();
    await drainAsyncTasks();

    expect(testState.responseFixerProcess).not.toHaveBeenCalled();
    expect(cloneSpy).not.toHaveBeenCalled();
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(responseText).toBe(CODEX_RESPONSES_SSE);
  });

  it("preserves headerless Remote Compaction v2 SSE under raw passthrough", async () => {
    const session = makeRemoteCompactionV2Session();
    session.sessionId = "session-debug-artifacts-compact";
    session.shouldPersistSessionDebugArtifacts = () => true;
    const upstreamResponse = new Response(new TextEncoder().encode(REMOTE_COMPACTION_V2_SSE));
    const cloneSpy = vi.spyOn(upstreamResponse, "clone");
    expect(session.getEndpointPolicy().kind).toBe("raw_passthrough");
    expect(upstreamResponse.headers.get("content-type")).toBeNull();

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    const responseText = await response.text();
    await drainAsyncTasks();

    expect(testState.responseFixerProcess).not.toHaveBeenCalled();
    expect(cloneSpy).not.toHaveBeenCalled();
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(responseText).toBe(REMOTE_COMPACTION_V2_SSE);
  });

  it.each(["application/json", "application/problem+json"])(
    "keeps explicit %s responses on non-stream handling",
    async (contentType) => {
      const session = makeCodexResponsesSession();
      const upstreamText = JSON.stringify({ id: "resp_json", status: "completed", output: [] });
      const upstreamResponse = new Response(upstreamText, {
        headers: { "content-type": contentType },
      });

      const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
      const responseText = await response.text();
      await drainAsyncTasks();

      expect(testState.responseFixerProcess).toHaveBeenCalledOnce();
      expect(response.headers.get("content-type")).toBe(contentType);
      expect(responseText).toBe(upstreamText);
    }
  );

  it("does not force a non-Codex response without content-type into stream handling", async () => {
    const session = makeSession(null, true);
    const upstreamResponse = new Response(new TextEncoder().encode(JSON.stringify({ output: [] })));

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await response.text();
    await drainAsyncTasks();

    expect(testState.responseFixerProcess).toHaveBeenCalledOnce();
    expect(response.headers.get("content-type")).toBeNull();
  });

  it("does not force a non-stream Codex request without content-type", async () => {
    const session = makeCodexResponsesSession(false);
    const upstreamResponse = new Response(new TextEncoder().encode(JSON.stringify({ output: [] })));

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await response.text();
    await drainAsyncTasks();

    expect(testState.responseFixerProcess).toHaveBeenCalledOnce();
    expect(response.headers.get("content-type")).toBeNull();
  });

  it("does not force a non-success Codex response without content-type", async () => {
    const session = makeCodexResponsesSession();
    const upstreamResponse = new Response(
      new TextEncoder().encode(JSON.stringify({ error: { message: "bad request" } })),
      { status: 400 }
    );

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await response.text();
    await drainAsyncTasks();

    expect(testState.responseFixerProcess).toHaveBeenCalledOnce();
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBeNull();
  });

  it("uses no-op cleanup when client abort signal is null", async () => {
    const session = makeSession(null, false);
    const upstreamResponse = new Response(JSON.stringify({ choices: [] }), {
      headers: { "content-type": "application/json" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await response.text();
    await drainAsyncTasks();

    expect(testState.cancelTask).not.toHaveBeenCalled();
  });

  it("invokes cancel synchronously when client signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
    const session = makeSession(controller.signal, false);
    const upstreamResponse = new Response(JSON.stringify({ choices: [] }), {
      headers: { "content-type": "application/json" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await response.text();
    await drainAsyncTasks();

    expect(addSpy.mock.calls.filter(([type]) => type === "abort")).toHaveLength(0);
    expect(removeSpy.mock.calls.filter(([type]) => type === "abort")).toHaveLength(0);
    expect(testState.cancelTask).toHaveBeenCalled();
  });
});
