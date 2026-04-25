import { afterEach, describe, expect, test, vi } from "vitest";
import type { ResponseRequest } from "@/app/v1/_lib/codex/types/response";
import { SessionManager } from "@/lib/session-manager";
import {
  createResponsesWebSocketProxyGuardExecutor,
  type ResponsesWebSocketProxyExecutionSession,
  type ResponsesWebSocketProxyGuardBoundary,
  type ResponsesWebSocketProxyHttpFallback,
  type ResponsesWebSocketProxyUpstreamAdapter,
} from "@/server/responses-websocket-proxy-executor";
import type {
  ResponsesWebSocketExecutorInput,
  ResponsesWebSocketExecutorResult,
  ResponsesWebSocketJsonEvent,
} from "@/server/responses-websocket-protocol";
import { ResponsesWebSocketSessionState } from "@/server/responses-websocket-session-state";
import type { ResponsesWebSocketUpstreamAdapterResult } from "@/server/responses-websocket-upstream-adapter";
import type { Provider } from "@/types/provider";

const PROMPT_CACHE_KEY = "019b82ff-08ff-75a3-a203-7e10274fdbd8";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Responses WebSocket Codex session continuity", () => {
  test("syncs Codex prompt_cache_key completion into the upstream WebSocket body", async () => {
    const input = createExecutorInput({
      upstreamBody: createBody({ prompt_cache_key: undefined }),
    });
    const completedBody = { ...input.upstreamBody, prompt_cache_key: PROMPT_CACHE_KEY };
    const session = createSession({ requestMessage: completedBody });
    const upstreamAdapter = vi.fn<ResponsesWebSocketProxyUpstreamAdapter>(() =>
      createConnectedUpstream([{ type: "response.completed", response: { id: "resp_sync" } }])
    );

    const executor = createResponsesWebSocketProxyGuardExecutor({
      guardBoundary: createGuardBoundary(session),
      upstreamAdapter,
      httpFallback: vi.fn(async () => new Response("{}")),
      isResponsesWebSocketEnabled: async () => true,
    });

    await collectExecutorResult(await executor(input));

    expect(upstreamAdapter).toHaveBeenCalledTimes(1);
    const upstreamInput = upstreamAdapter.mock.calls[0]![0];
    expect(upstreamInput.upstreamBody.prompt_cache_key).toBe(PROMPT_CACHE_KEY);
  });

  test("binds prompt_cache_key and store=false response data from upstream WS events", async () => {
    const updateSession = vi
      .spyOn(SessionManager, "updateSessionWithCodexCacheKey")
      .mockResolvedValue({ sessionId: `codex_${PROMPT_CACHE_KEY}`, updated: true });
    const sessionState = new ResponsesWebSocketSessionState();
    const input = createExecutorInput({ sessionState, upstreamBody: createBody() });
    const session = createSession();
    const upstreamAdapter = vi.fn<ResponsesWebSocketProxyUpstreamAdapter>(() =>
      createConnectedUpstream([
        {
          type: "response.completed",
          response: responseObject("resp_ws_bind", { prompt_cache_key: PROMPT_CACHE_KEY }),
        },
      ])
    );

    const executor = createResponsesWebSocketProxyGuardExecutor({
      guardBoundary: createGuardBoundary(session),
      upstreamAdapter,
      httpFallback: vi.fn(async () => new Response("{}")),
      isResponsesWebSocketEnabled: async () => true,
    });

    await collectExecutorResult(await executor(input));

    expect(updateSession).toHaveBeenCalledWith("session-1", PROMPT_CACHE_KEY, 10, 42);
    expect(sessionState.getStoreFalseCacheDebugSnapshot()).toMatchObject({
      lastResponseId: "resp_ws_bind",
      store: false,
    });
  });

  test("binds prompt_cache_key from HTTP fallback SSE events", async () => {
    const updateSession = vi
      .spyOn(SessionManager, "updateSessionWithCodexCacheKey")
      .mockResolvedValue({ sessionId: `codex_${PROMPT_CACHE_KEY}`, updated: true });
    const input = createExecutorInput();
    const session = createSession();
    const httpFallback = vi.fn<ResponsesWebSocketProxyHttpFallback>(async () =>
      createSseResponse([
        {
          type: "response.completed",
          response: responseObject("resp_fallback_bind", { prompt_cache_key: PROMPT_CACHE_KEY }),
        },
      ])
    );

    const executor = createResponsesWebSocketProxyGuardExecutor({
      guardBoundary: createGuardBoundary(session),
      upstreamAdapter: vi.fn(() => ({ type: "skipped", reason: "global_disabled" })),
      httpFallback,
      isResponsesWebSocketEnabled: async () => false,
    });

    await collectExecutorResult(await executor(input));

    expect(updateSession).toHaveBeenCalledWith("session-1", PROMPT_CACHE_KEY, 10, 42);
  });

  test("refuses unsafe store=false delta when non-input config changes", async () => {
    const sessionState = new ResponsesWebSocketSessionState();
    const provider = createProvider();
    sessionState.updateStoreFalseCache({
      requestBody: createBody(),
      response: responseObject("resp_base"),
      providerIdentity: {
        providerId: provider.id,
        providerType: provider.providerType,
        upstreamBaseUrl: provider.url,
        endpointId: null,
        endpointUrl: provider.url,
      },
    });
    const input = createExecutorInput({
      sessionState,
      upstreamBody: createBody({
        previous_response_id: "resp_base",
        instructions: "Use a different policy",
      }),
    });
    const session = createSession({ provider, requestMessage: input.upstreamBody });
    const upstreamAdapter = vi.fn<ResponsesWebSocketProxyUpstreamAdapter>(() =>
      createConnectedUpstream([{ type: "response.completed", response: { id: "resp_unsafe" } }])
    );
    const httpFallback = vi.fn(async () => new Response("{}"));

    const executor = createResponsesWebSocketProxyGuardExecutor({
      guardBoundary: createGuardBoundary(session),
      upstreamAdapter,
      httpFallback,
      isResponsesWebSocketEnabled: async () => true,
    });

    const events = await collectExecutorResult(await executor(input));

    expect(upstreamAdapter).not.toHaveBeenCalled();
    expect(httpFallback).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        type: "error",
        error: {
          type: "invalid_request_error",
          code: "full_context_required",
          message: "Full context is required for store=false Responses WebSocket continuation",
        },
      },
    ]);
  });

  test("rewrites safe store=false continuation to full in-socket context", async () => {
    const sessionState = new ResponsesWebSocketSessionState();
    const provider = createProvider();
    sessionState.updateStoreFalseCache({
      requestBody: createBody(),
      response: responseObject("resp_base"),
      providerIdentity: {
        providerId: provider.id,
        providerType: provider.providerType,
        upstreamBaseUrl: provider.url,
        endpointId: null,
        endpointUrl: provider.url,
      },
    });
    const input = createExecutorInput({
      sessionState,
      upstreamBody: createBody({
        previous_response_id: "resp_base",
        input: [{ role: "user", content: [{ type: "input_text", text: "next" }] }],
      }),
    });
    const upstreamAdapter = vi.fn<ResponsesWebSocketProxyUpstreamAdapter>(() =>
      createConnectedUpstream([{ type: "response.completed", response: { id: "resp_full" } }])
    );
    const executor = createResponsesWebSocketProxyGuardExecutor({
      guardBoundary: createGuardBoundary(
        createSession({ provider, requestMessage: input.upstreamBody })
      ),
      upstreamAdapter,
      httpFallback: vi.fn(async () => new Response("{}")),
      isResponsesWebSocketEnabled: async () => true,
    });

    await collectExecutorResult(await executor(input));

    const rewrittenBody = upstreamAdapter.mock.calls[0]![0].upstreamBody;
    expect(rewrittenBody.previous_response_id).toBeUndefined();
    expect(rewrittenBody.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "hello" }] },
      {
        id: "resp_base-msg",
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "answer" }],
      },
      { role: "user", content: [{ type: "input_text", text: "next" }] },
    ]);
  });
});

function createExecutorInput(
  overrides: {
    upstreamBody?: ResponseRequest & Record<string, unknown>;
    sessionState?: ResponsesWebSocketSessionState;
  } = {}
): ResponsesWebSocketExecutorInput {
  const upstreamBody = overrides.upstreamBody ?? createBody();
  const sessionState = overrides.sessionState ?? new ResponsesWebSocketSessionState();

  return {
    id: "request-1",
    parsed: {
      type: "response.create",
      upstreamBody,
      transport: {},
      modelSource: "body",
    },
    upstreamBody,
    transport: {},
    modelSource: "body",
    requestUrl: "/v1/responses",
    queueWaitMs: 0,
    metadata: {
      queueWaitMs: 0,
      storeFalseCacheHit: false,
      storeFalseCacheRefusalReason: null,
      storeFalseCacheDebug: null,
    },
    executionContext: {
      requestUrl: "/v1/responses",
      headers: new Headers({ authorization: "Bearer test-key", "user-agent": "codex-test" }),
      clientAbortSignal: null,
      connectionId: "connection-1",
      sessionState,
    },
  };
}

function createBody(
  overrides: Partial<ResponseRequest & Record<string, unknown>> = {}
): ResponseRequest & Record<string, unknown> {
  return {
    model: "gpt-5-codex",
    store: false,
    input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
    instructions: "Be concise",
    reasoning: { effort: "medium" },
    text: { format: { type: "text" } },
    service_tier: "auto",
    ...overrides,
  } as ResponseRequest & Record<string, unknown>;
}

function createSession(
  overrides: { provider?: Provider; requestMessage?: Record<string, unknown> } = {}
): ResponsesWebSocketProxyExecutionSession & { request: { message: Record<string, unknown> } } {
  const provider = overrides.provider ?? createProvider();

  return {
    sessionId: "session-1",
    provider,
    authState: { success: true, key: { id: 42 } },
    request: { message: overrides.requestMessage ?? createBody() },
    recordForwardStart: vi.fn(),
  } as unknown as ResponsesWebSocketProxyExecutionSession & {
    request: { message: Record<string, unknown> };
  };
}

function createProvider(): Provider {
  return {
    id: 10,
    name: "Codex Provider",
    key: "upstream-key",
    url: "https://upstream.example.com/v1",
    providerType: "codex",
    priority: 0,
    weight: 1,
    costMultiplier: 1,
    isEnabled: true,
    models: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Provider;
}

function createGuardBoundary(
  session: ResponsesWebSocketProxyExecutionSession
): ResponsesWebSocketProxyGuardBoundary {
  return vi.fn(async () => ({ session, earlyResponse: null }));
}

function createConnectedUpstream(
  events: ResponsesWebSocketJsonEvent[]
): ResponsesWebSocketUpstreamAdapterResult {
  return {
    type: "connected",
    upstreamUrl: "wss://upstream.example.com/v1/responses",
    events: (async function* () {
      for (const event of events) yield event;
    })(),
  };
}

function responseObject(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: "completed",
    model: "gpt-5-codex",
    usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 },
    output: [
      {
        id: `${id}-msg`,
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "answer" }],
      },
    ],
    ...overrides,
  };
}

function createSseResponse(events: ResponsesWebSocketJsonEvent[]): Response {
  const body = [
    ...events.flatMap((event) => [`event: ${event.type}`, `data: ${JSON.stringify(event)}`, ""]),
    "data: [DONE]",
    "",
  ].join("\n");

  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

async function collectExecutorResult(
  result: ResponsesWebSocketExecutorResult
): Promise<ResponsesWebSocketJsonEvent[]> {
  if (Array.isArray(result)) return [...result];
  if (isAsyncIterable(result)) {
    const events: ResponsesWebSocketJsonEvent[] = [];
    for await (const event of result) events.push(event);
    return events;
  }
  return [result];
}

function isAsyncIterable(value: unknown): value is AsyncIterable<ResponsesWebSocketJsonEvent> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  );
}
