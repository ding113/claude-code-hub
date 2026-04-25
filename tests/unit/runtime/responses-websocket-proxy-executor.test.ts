import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  createResponsesWebSocketProxyGuardExecutor,
  type ResponsesWebSocketProxyGuardBoundary,
} from "@/server/responses-websocket-proxy-executor";
import type {
  ResponsesWebSocketExecutorInput,
  ResponsesWebSocketExecutorResult,
  ResponsesWebSocketJsonEvent,
} from "@/server/responses-websocket-protocol";
import type { ResponsesWebSocketUpstreamAdapterResult } from "@/server/responses-websocket-upstream-adapter";
import type { Provider } from "@/types/provider";

const messageRepositoryMocks = vi.hoisted(() => ({
  updateMessageRequestDetails: vi.fn(async () => undefined),
}));

vi.mock("@/repository/message", () => messageRepositoryMocks);

function createExecutorInput(): ResponsesWebSocketExecutorInput {
  const upstreamBody = {
    model: "query-model",
    input: [{ role: "user", content: [{ type: "input_text", text: "guard me" }] }],
  };

  return {
    id: "request-1",
    parsed: {
      type: "response.create",
      upstreamBody,
      transport: { stream: true },
      modelSource: "query",
    },
    upstreamBody,
    transport: { stream: true },
    modelSource: "query",
    requestUrl: "/v1/responses?model=query-model",
    executionContext: {
      requestUrl: "/v1/responses?model=query-model",
      headers: new Headers({
        authorization: "Bearer test-key",
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-key": "client-key",
      }),
      clientAbortSignal: null,
      connectionId: "connection-1",
    },
  };
}

describe("Responses WebSocket proxy guard executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("delegates response.create frames to the HTTP proxy guard boundary as sanitized POST requests", async () => {
    const boundary = vi.fn<ResponsesWebSocketProxyGuardBoundary>(async () => ({
      session: null,
      earlyResponse: new Response(
        JSON.stringify({ error: { type: "authentication_error", message: "missing auth" } }),
        { status: 401, headers: { "content-type": "application/json" } }
      ),
    }));
    const executor = createResponsesWebSocketProxyGuardExecutor({ guardBoundary: boundary });

    const events = await executor(createExecutorInput());
    const [guardRequest] = boundary.mock.calls[0]!;

    expect(boundary).toHaveBeenCalledTimes(1);
    expect(guardRequest.method).toBe("POST");
    expect(new URL(guardRequest.url).pathname).toBe("/v1/responses");
    expect(new URL(guardRequest.url).searchParams.get("model")).toBe("query-model");
    expect(guardRequest.headers.get("authorization")).toBe("Bearer test-key");
    expect(guardRequest.headers.get("upgrade")).toBeNull();
    expect(guardRequest.headers.get("sec-websocket-key")).toBeNull();
    expect(JSON.parse(await guardRequest.clone().text())).toEqual(
      createExecutorInput().upstreamBody
    );
    expect(events).toEqual([
      {
        type: "error",
        error: {
          type: "authentication_error",
          code: "authentication_error",
          message: "missing auth",
          status: 401,
        },
      },
    ]);
  });

  test("bridges HTTP fallback events after guards pass when upstream WebSocket is skipped", async () => {
    const fallbackResponse = new Response(
      [
        "event: response.created",
        'data: {"type":"response.created","response":{"id":"resp_executor","status":"in_progress"}}',
        "",
        "event: response.completed",
        'data: {"type":"response.completed","response":{"id":"resp_executor","status":"completed"}}',
        "",
      ].join("\n"),
      { headers: { "content-type": "text/event-stream" } }
    );
    const session = {
      sessionId: "session-1",
      provider: createProvider(),
      authState: { success: true },
      recordForwardStart: vi.fn(),
    };
    const boundary = vi.fn<ResponsesWebSocketProxyGuardBoundary>(async () => ({
      session,
      earlyResponse: null,
    }));
    const upstreamAdapter = vi.fn<() => ResponsesWebSocketUpstreamAdapterResult>(() => ({
      type: "skipped",
      reason: "global_disabled",
    }));
    const httpFallback = vi.fn(async () => fallbackResponse);
    const executor = createResponsesWebSocketProxyGuardExecutor({
      guardBoundary: boundary,
      upstreamAdapter,
      httpFallback,
      isResponsesWebSocketEnabled: async () => false,
    });

    const events = await collectExecutorResult(await executor(createExecutorInput()));

    expect(boundary).toHaveBeenCalledTimes(1);
    expect(upstreamAdapter).toHaveBeenCalledTimes(1);
    expect(httpFallback).toHaveBeenCalledTimes(1);
    expect(session.recordForwardStart).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      {
        type: "response.created",
        response: { id: "resp_executor", status: "in_progress" },
      },
      {
        type: "response.completed",
        response: { id: "resp_executor", status: "completed" },
      },
    ]);
  });

  test("records decision-chain metadata when upstream WebSocket succeeds", async () => {
    const session = createDecisionChainSession();
    const upstreamAdapter = vi.fn<ResponsesWebSocketProxyUpstreamAdapter>(() =>
      createConnectedUpstream([
        { type: "response.completed", response: { id: "resp_ws_success", status: "completed" } },
      ])
    );
    const input = createExecutorInput();
    input.metadata = {
      queueWaitMs: 19,
      storeFalseCacheHit: false,
      storeFalseCacheRefusalReason: null,
      storeFalseCacheDebug: null,
    };
    const executor = createResponsesWebSocketProxyGuardExecutor({
      guardBoundary: createGuardBoundary(session),
      upstreamAdapter,
      httpFallback: vi.fn(async () => new Response("{}")),
      isResponsesWebSocketEnabled: async () => true,
    });

    const events = await collectExecutorResult(await executor(input));

    expect(events).toEqual([
      { type: "response.completed", response: { id: "resp_ws_success", status: "completed" } },
    ]);
    expect(upstreamAdapter).toHaveBeenCalledTimes(1);
    expect(session.getProviderChain()).toHaveLength(1);
    expect(session.getProviderChain()[0]).toMatchObject({
      id: 10,
      name: "Codex Provider",
      statusCode: 101,
      clientTransport: "websocket",
      upstreamWsAttempted: true,
      upstreamWsConnected: true,
      downgradedToHttp: false,
      queueWaitMs: 19,
      storeFalseCacheHit: false,
      storeFalseCacheRefusalReason: null,
    });
    expect(JSON.stringify(session.getProviderChain())).not.toContain("guard me");
    expect(messageRepositoryMocks.updateMessageRequestDetails).toHaveBeenCalledWith(
      321,
      expect.objectContaining({
        statusCode: 101,
        providerId: 10,
        providerChain: session.getProviderChain(),
      })
    );
  });

  test("records fallback decision-chain metadata when unsupported cache downgrades to HTTP", async () => {
    const session = createDecisionChainSession();
    const upstreamAdapter = vi.fn<ResponsesWebSocketProxyUpstreamAdapter>(() => ({
      type: "skipped",
      reason: "ws_unsupported_cached",
    }));
    const httpFallback = vi.fn(async () =>
      createSseResponse([
        {
          type: "response.completed",
          response: { id: "resp_fallback", status: "completed" },
        },
      ])
    );
    const input = createExecutorInput();
    const executor = createResponsesWebSocketProxyGuardExecutor({
      guardBoundary: createGuardBoundary(session),
      upstreamAdapter,
      httpFallback,
      isResponsesWebSocketEnabled: async () => true,
    });

    const events = await collectExecutorResult(await executor(input));

    expect(events).toEqual([
      { type: "response.completed", response: { id: "resp_fallback", status: "completed" } },
    ]);
    expect(httpFallback).toHaveBeenCalledTimes(1);
    expect(session.recordForwardStart).toHaveBeenCalledTimes(1);
    expect(session.getProviderChain()).toHaveLength(1);
    expect(session.getProviderChain()[0]).toMatchObject({
      statusCode: 200,
      clientTransport: "websocket",
      upstreamWsAttempted: false,
      upstreamWsConnected: false,
      downgradedToHttp: true,
      downgradeReason: "upstream_ws_unsupported",
      upstreamWsUnsupportedCacheHit: true,
    });
    expect(messageRepositoryMocks.updateMessageRequestDetails).toHaveBeenCalledWith(
      321,
      expect.objectContaining({
        statusCode: 200,
        providerId: 10,
        providerChain: session.getProviderChain(),
      })
    );
  });
});

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
    enabled: true,
    models: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Provider;
}

function createSession(
  overrides: { provider?: Provider; requestMessage?: Record<string, unknown> } = {}
): ResponsesWebSocketProxyExecutionSession & {
  request: { message: Record<string, unknown> };
  recordForwardStart: ReturnType<typeof vi.fn>;
} {
  return {
    sessionId: "session-1",
    provider: overrides.provider ?? createProvider(),
    authState: { success: true, key: { id: 42 } },
    request: { message: overrides.requestMessage ?? createExecutorInput().upstreamBody },
    recordForwardStart: vi.fn(),
  } as unknown as ResponsesWebSocketProxyExecutionSession & {
    request: { message: Record<string, unknown> };
    recordForwardStart: ReturnType<typeof vi.fn>;
  };
}

type TestDecisionChainSession = ResponsesWebSocketProxyExecutionSession & {
  getProviderChain: () => Array<Record<string, unknown>>;
  addProviderToChain: (provider: Provider, metadata: Record<string, unknown>) => void;
  getLastSelectionContext: () => Record<string, unknown>;
  recordForwardStart: ReturnType<typeof vi.fn>;
};

function createDecisionChainSession(): TestDecisionChainSession {
  const base = createSession();
  const providerChain: Array<Record<string, unknown>> = [];

  return {
    ...base,
    messageContext: { id: 321, key: { id: 42 } },
    recordForwardStart: vi.fn(),
    addProviderToChain(provider: Provider, metadata: Record<string, unknown>) {
      providerChain.push({
        id: provider.id,
        name: provider.name,
        providerType: provider.providerType,
        timestamp: Date.now(),
        ...metadata,
      });
    },
    getProviderChain() {
      return providerChain;
    },
    getLastSelectionContext() {
      return {
        requestedModel: "gpt-5-codex",
        candidateCount: 1,
      };
    },
  } as TestDecisionChainSession;
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
