import { describe, expect, test, vi } from "vitest";
import type { ResponseRequest } from "@/app/v1/_lib/codex/types/response";
import {
  ResponsesWebSocketInboundHandler,
  type ResponsesWebSocketExecutorInput,
  type ResponsesWebSocketJsonEvent,
  type ResponsesWebSocketQueueInput,
  ResponsesWebSocketRequestQueue,
  type ResponsesWebSocketQueuedRequest,
} from "@/server/responses-websocket-protocol";
import {
  ResponsesWebSocketSessionState,
  type ResponsesWebSocketProviderIdentity,
} from "@/server/responses-websocket-session-state";

function providerIdentity(
  overrides: Partial<ResponsesWebSocketProviderIdentity> = {}
): ResponsesWebSocketProviderIdentity {
  return {
    providerId: 1001,
    providerType: "codex",
    upstreamBaseUrl: "https://codex.example.com/v1",
    endpointId: 9001,
    endpointUrl: "https://codex.example.com/v1/responses",
    ...overrides,
  };
}

function createBody(overrides: Partial<ResponseRequest & Record<string, unknown>> = {}) {
  return {
    model: "gpt-5-codex",
    store: false,
    input: [
      {
        role: "user" as const,
        content: [{ type: "input_text" as const, text: "hello" }],
      },
    ],
    tools: [{ type: "function", function: { name: "lookup", parameters: {} } }],
    instructions: "Be concise",
    reasoning: { effort: "medium" },
    text: { format: { type: "text" } },
    service_tier: "auto",
    ...overrides,
  } satisfies ResponseRequest & Record<string, unknown>;
}

function responseObject(id: string, outputText = "answer") {
  return {
    id,
    output: [
      {
        id: `${id}-msg`,
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: outputText }],
      },
    ],
  };
}

function responseCreateFrame(body: Record<string, unknown>): string {
  return JSON.stringify({ type: "response.create", body });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Responses WebSocket session queue", () => {
  test("serializes response.create frames FIFO and exposes queueWaitMs to the executor", async () => {
    let now = 1_000;
    const releaseFirst = deferred<void>();
    const executionOrder: string[] = [];
    const queueWaits: number[] = [];

    const handler = new ResponsesWebSocketInboundHandler({
      requestUrl: "/v1/responses",
      now: () => now,
      createRequestId: () => `request-${executionOrder.length + 1}`,
      executor: vi.fn(async (input: ResponsesWebSocketExecutorInput) => {
        const marker = String((input.upstreamBody.metadata as Record<string, unknown>).marker);
        executionOrder.push(marker);
        queueWaits.push(input.queueWaitMs);

        if (marker === "first") {
          await releaseFirst.promise;
        }

        return { type: "response.completed", response: { id: `resp-${marker}` } };
      }),
    });

    const first = handler.handleFrame(
      responseCreateFrame({ ...createBody(), metadata: { marker: "first" } })
    );
    await vi.waitFor(() => expect(executionOrder).toEqual(["first"]));

    now += 25;
    const second = handler.handleFrame(
      responseCreateFrame({ ...createBody(), metadata: { marker: "second" } })
    );

    await Promise.resolve();
    expect(executionOrder).toEqual(["first"]);

    now += 10;
    releaseFirst.resolve();

    await Promise.all([first, second]);

    expect(executionOrder).toEqual(["first", "second"]);
    expect(queueWaits[0]).toBe(0);
    expect(queueWaits[1]).toBe(10);
  });

  test("rejects active and queued requests and clears socket cache on dispose", async () => {
    const releaseFirst = deferred<ResponsesWebSocketJsonEvent>();
    const handler = new ResponsesWebSocketInboundHandler({
      requestUrl: "/v1/responses",
      executor: vi.fn(async (input: ResponsesWebSocketExecutorInput) => {
        if ((input.upstreamBody.metadata as Record<string, unknown>).marker === "first") {
          return releaseFirst.promise;
        }

        return { type: "response.completed", response: { id: "resp-queued" } };
      }),
    });

    handler.executionContext.sessionState.updateStoreFalseCache({
      requestBody: createBody(),
      response: responseObject("resp-seed"),
      providerIdentity: providerIdentity(),
    });
    expect(handler.executionContext.sessionState.getStoreFalseCacheDebugSnapshot()).toMatchObject({
      lastResponseId: "resp-seed",
    });

    const active = handler.handleFrame(
      responseCreateFrame({ ...createBody(), metadata: { marker: "first" } })
    );
    await vi.waitFor(() => expect(handler.inFlightCount).toBe(1));
    const queued = handler.handleFrame(
      responseCreateFrame({ ...createBody(), metadata: { marker: "queued" } })
    );

    handler.dispose();
    releaseFirst.resolve({ type: "response.completed", response: { id: "resp-first" } });

    await expect(active).rejects.toThrow(/closed|disposed|aborted/i);
    await expect(queued).rejects.toThrow(/closed|disposed|aborted/i);
    expect(handler.executionContext.sessionState.getStoreFalseCacheDebugSnapshot()).toBeNull();
  });

  test("queue dispose rejects pending work without invoking the queued handler", async () => {
    const releaseFirst = deferred<string>();
    const handledIds: string[] = [];
    const queue = new ResponsesWebSocketRequestQueue<string>(
      async (request: ResponsesWebSocketQueuedRequest) => {
        handledIds.push(request.id);
        if (request.id === "first") return releaseFirst.promise;
        return request.id;
      }
    );

    const first = queue.enqueue({ id: "first", frame: "{}", requestUrl: "/v1/responses" });
    await vi.waitFor(() => expect(queue.inFlightCount).toBe(1));
    const second = queue.enqueue({ id: "second", frame: "{}", requestUrl: "/v1/responses" });

    queue.dispose();
    releaseFirst.resolve("first");

    await expect(first).rejects.toThrow(/closed|disposed|aborted/i);
    await expect(second).rejects.toThrow(/closed|disposed|aborted/i);
    expect(handledIds).toEqual(["first"]);
  });
});

describe("Responses WebSocket store=false context cache", () => {
  test("refuses reuse when model/tools/instructions/reasoning/text/service_tier changes", () => {
    const state = new ResponsesWebSocketSessionState();
    const identity = providerIdentity();
    const baseBody = createBody();

    state.updateStoreFalseCache({
      requestBody: baseBody,
      response: responseObject("resp-base"),
      providerIdentity: identity,
    });

    const reuse = state.resolveStoreFalseCacheReuse({
      requestBody: createBody({ previous_response_id: "resp-base" }),
      providerIdentity: identity,
    });
    expect(reuse.hit).toBe(true);
    if (reuse.hit) {
      expect(reuse.cachedItemChain.inputItems).toHaveLength(1);
      expect(reuse.cachedItemChain.outputItems).toHaveLength(1);
      expect(reuse.debugSnapshot).not.toHaveProperty("inputItems");
      expect(reuse.debugSnapshot).not.toHaveProperty("outputItems");
    }

    const incompatibleBodies: Array<[string, Partial<ResponseRequest & Record<string, unknown>>]> =
      [
        ["model", { model: "gpt-5.1-codex" }],
        ["tools", { tools: [{ type: "function", function: { name: "other" } }] }],
        ["instructions", { instructions: "Use a different policy" }],
        ["reasoning", { reasoning: { effort: "high" } }],
        ["text", { text: { format: { type: "json_schema", name: "out" } } }],
        ["service_tier", { service_tier: "priority" }],
      ];

    for (const [, overrides] of incompatibleBodies) {
      const result = state.resolveStoreFalseCacheReuse({
        requestBody: createBody({ previous_response_id: "resp-base", ...overrides }),
        providerIdentity: identity,
      });

      expect(result.hit).toBe(false);
      expect(result.reason).toBe("body_hash_mismatch");
    }
  });

  test("refuses reuse when provider or upstream identity changes", () => {
    const state = new ResponsesWebSocketSessionState();
    const identity = providerIdentity();

    state.updateStoreFalseCache({
      requestBody: createBody(),
      response: responseObject("resp-provider"),
      providerIdentity: identity,
    });

    const result = state.resolveStoreFalseCacheReuse({
      requestBody: createBody({ previous_response_id: "resp-provider" }),
      providerIdentity: providerIdentity({ endpointUrl: "https://other.example.com/v1/responses" }),
    });

    expect(result.hit).toBe(false);
    expect(result.reason).toBe("provider_identity_mismatch");
  });

  test("respects item count, byte size, and TTL limits", () => {
    let now = 5_000;

    const ttlState = new ResponsesWebSocketSessionState({ maxTtlMs: 100, now: () => now });
    ttlState.updateStoreFalseCache({
      requestBody: createBody(),
      response: responseObject("resp-ttl"),
      providerIdentity: providerIdentity(),
    });
    now += 101;
    expect(
      ttlState.resolveStoreFalseCacheReuse({
        requestBody: createBody({ previous_response_id: "resp-ttl" }),
        providerIdentity: providerIdentity(),
      })
    ).toMatchObject({ hit: false, reason: "expired" });

    const itemState = new ResponsesWebSocketSessionState({ maxItems: 1 });
    itemState.updateStoreFalseCache({
      requestBody: createBody(),
      response: responseObject("resp-items"),
      providerIdentity: providerIdentity(),
    });
    expect(itemState.getStoreFalseCacheDebugSnapshot()).toBeNull();

    const byteState = new ResponsesWebSocketSessionState({ maxBytes: 128 });
    byteState.updateStoreFalseCache({
      requestBody: createBody({
        input: [{ role: "user", content: [{ type: "input_text", text: "x".repeat(512) }] }],
      }),
      response: responseObject("resp-bytes"),
      providerIdentity: providerIdentity(),
    });
    expect(byteState.getStoreFalseCacheDebugSnapshot()).toBeNull();
  });

  test("does not expose raw cached content through metadata or debug persistence hooks", async () => {
    const rawInput = "DO_NOT_PERSIST_RAW_STORE_FALSE";
    const rawOutput = "DO_NOT_PERSIST_RAW_OUTPUT";
    const recordMessageRequestMetadata = vi.fn();
    const recordDebugSnapshot = vi.fn();
    const state = new ResponsesWebSocketSessionState();
    const identity = providerIdentity();

    const update = state.updateStoreFalseCache({
      requestBody: createBody({
        input: [{ role: "user", content: [{ type: "input_text", text: rawInput }] }],
      }),
      response: responseObject("resp-secret", rawOutput),
      providerIdentity: identity,
    });

    const reuse = state.resolveStoreFalseCacheReuse({
      requestBody: createBody({ previous_response_id: "resp-secret", input: [] }),
      providerIdentity: identity,
    });

    recordMessageRequestMetadata({
      storeFalseCacheHit: reuse.hit,
      storeFalseCacheRefusalReason: reuse.hit ? null : reuse.reason,
      storeFalseCacheDebug: reuse.debugSnapshot,
    });
    recordDebugSnapshot(update.debugSnapshot);

    const persisted = JSON.stringify({
      messageRequest: recordMessageRequestMetadata.mock.calls,
      debug: recordDebugSnapshot.mock.calls,
      snapshot: state.getStoreFalseCacheDebugSnapshot(),
    });

    expect(reuse.hit).toBe(true);
    expect(persisted).not.toContain(rawInput);
    expect(persisted).not.toContain(rawOutput);
    expect(persisted).toContain("resp-secret");
  });
});
