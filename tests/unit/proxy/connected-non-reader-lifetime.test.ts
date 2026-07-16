import { Context } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import {
  createDemandDrivenResponsePump,
  type DemandDrivenResponsePump,
  type DemandDrivenResponsePumpCompletion,
} from "@/app/v1/_lib/proxy/demand-driven-response-pump";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxyProviderResolver } from "@/app/v1/_lib/proxy/provider-selector";
import { ProxyResponseHandler } from "@/app/v1/_lib/proxy/response-handler";
import { ProxySession } from "@/app/v1/_lib/proxy/session";

const encoder = new TextEncoder();
const processingTasks: Promise<void>[] = [];
const transportMocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("undici", async (importOriginal) => ({
  ...(await importOriginal<typeof import("undici")>()),
  request: transportMocks.request,
}));

vi.mock("@/app/v1/_lib/proxy/response-fixer", () => ({
  ResponseFixer: { process: async (_session: ProxySession, response: Response) => response },
}));
vi.mock("@/lib/async-task-manager", () => ({
  AsyncTaskManager: {
    register: vi.fn((_id: string, factory: () => Promise<void>) => {
      const task = factory();
      processingTasks.push(task);
      return new AbortController();
    }),
    touch: vi.fn(),
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), trace: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/lib/circuit-breaker", () => ({
  getCircuitState: vi.fn(() => "closed"),
  getProviderHealthInfo: vi.fn(async () => ({
    health: { failureCount: 0 },
    config: { failureThreshold: 3 },
  })),
  recordFailure: vi.fn(),
  recordSuccess: vi.fn(),
}));
vi.mock("@/lib/endpoint-circuit-breaker", () => ({
  recordEndpointFailure: vi.fn(),
}));
vi.mock("@/repository/message", () => ({
  updateMessageRequestCostWithBreakdown: vi.fn(),
  updateMessageRequestDetails: vi.fn(),
  updateMessageRequestDetailsDurably: vi.fn(),
  updateMessageRequestDetailsIfUnfinalized: vi.fn(),
  updateMessageRequestDuration: vi.fn(),
}));
vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    clearSessionProvider: vi.fn(),
    updateSessionBindingSmart: vi.fn(async () => ({ reason: "test", updated: false })),
    updateSessionUsage: vi.fn(),
  },
}));

async function createGeminiSession(signal: AbortSignal | null): Promise<ProxySession> {
  const request = new Request("https://example.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gemini-2.0-flash", stream: true }),
    signal,
  });
  const session = await ProxySession.fromContext(new Context(request));
  Object.assign(session, {
    authState: { apiKey: null, key: null, success: true, user: null },
    provider: {
      id: 1,
      name: "gemini",
      url: "https://example.com",
      key: "test-key",
      providerType: "gemini",
      firstByteTimeoutStreamingMs: 0,
      streamingIdleTimeoutMs: 0,
    },
    messageContext: { createdAt: new Date(), id: 1, user: { id: 1, name: "test" } },
    originalFormat: "gemini",
  });
  return session;
}

afterEach(() => {
  vi.useRealTimers();
  processingTasks.length = 0;
});

describe("connected non-reader response lifetime", () => {
  it("cancels one unconsumed lookahead chunk at the 60 second deadline", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("pending"));
      },
      cancel,
    });
    const completions: DemandDrivenResponsePumpCompletion[] = [];
    const deadlineError = expect.objectContaining({ name: "AbortError" });

    const pump = createDemandDrivenResponsePump({ source, onChunk: vi.fn() });
    void pump.completion.then((completion) => completions.push(completion));
    await vi.advanceTimersByTimeAsync(59_999);

    expect(cancel).not.toHaveBeenCalled();
    expect(completions).toEqual([]);
    expect(pump.getState()).toBe("client-active");

    await vi.advanceTimersByTimeAsync(1);
    const completion = await pump.completion;
    pump.startDrain(new Error("late drain"));
    pump.cancelSource(new Error("late cancel"));
    await vi.runAllTimersAsync();

    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith(deadlineError);
    expect(completion).toMatchObject({ streamEndedNormally: false, clientAborted: true });
    expect(completion.error).toEqual(deadlineError);
    expect(completions).toEqual([completion]);
    expect(pump.getState()).toBe("closed");
  });

  it("transfers cancellation even when onClientCancel throws", async () => {
    let sourceController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const callbackError = new Error("cancel observer failed");
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        sourceController = controller;
      },
    });
    const pump = createDemandDrivenResponsePump({
      source,
      onChunk: vi.fn(),
      onClientCancel() {
        throw callbackError;
      },
    });

    const cancelOutcome = await pump.stream.cancel("client disconnected").then(
      () => ({ kind: "resolved" as const }),
      (error: unknown) => ({ kind: "rejected" as const, error })
    );
    const stateAfterCancel = pump.getState();
    sourceController?.close();
    const completion = await pump.completion;

    expect(cancelOutcome).toEqual({ kind: "rejected", error: callbackError });
    expect(stateAfterCancel).toBe("draining");
    expect(completion).toMatchObject({ streamEndedNormally: true, clientAborted: true });
    expect(completion.error).toBeNull();
  });

  it("preserves the first hard-cancel owner during synchronous source reentry", async () => {
    const firstError = new DOMException("pending response was not consumed", "AbortError");
    const reentrantError = new Error("reentrant cancel");
    const cancelFailure = new Error("source cancel failed");
    let pump: DemandDrivenResponsePump | null = null;
    const cancel = vi.fn(() => {
      pump?.cancelSource(reentrantError);
      return Promise.reject(cancelFailure);
    });
    const source = new ReadableStream<Uint8Array>({ cancel });
    pump = createDemandDrivenResponsePump({ source, onChunk: vi.fn() });
    const completions: DemandDrivenResponsePumpCompletion[] = [];
    void pump.completion.then((completion) => completions.push(completion));

    pump.cancelSource(firstError);
    const completion = await pump.completion;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(cancel).toHaveBeenCalledOnce();
    expect(completion.error).toBe(firstError);
    expect(firstError.cause).toBe(cancelFailure);
    expect(completions).toEqual([completion]);
    expect(pump.getState()).toBe("closed");
  });

  it("keeps Gemini passthrough demand-driven while preserving exact chunks", async () => {
    const chunks = [
      '{"candidates":[{"content":{"parts":[{"text":"one"}]}}]}\n',
      '{"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":3}}\n',
    ];
    let pullCount = 0;
    const source = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pullCount += 1;
          const chunk = chunks[pullCount - 1];
          if (chunk) controller.enqueue(encoder.encode(chunk));
          else controller.close();
        },
      },
      { highWaterMark: 0 }
    );
    const response = new Response(source, { headers: { "content-type": "text/event-stream" } });
    const session = await createGeminiSession(null);

    const returned = await ProxyResponseHandler.dispatch(session, response);
    await Promise.all([Promise.resolve(), Promise.resolve()]);

    expect(pullCount).toBe(1);
    await expect(returned.text()).resolves.toBe(chunks.join(""));
    const settlements = await Promise.allSettled(processingTasks);
    expect(settlements.every((settlement) => settlement.status === "fulfilled")).toBe(true);
  });

  it.each([true, false])(
    "detaches client cancellation after headers with signal=%s",
    async (hasClientSignal) => {
      const clientController = new AbortController();
      const session = await createGeminiSession(hasClientSignal ? clientController.signal : null);
      let transportSignal: AbortSignal | undefined;
      transportMocks.request.mockImplementation(async (_url, options) => {
        transportSignal = options.signal;
        return {
          statusCode: 200,
          headers: { "content-type": "text/event-stream" },
          body: Readable.from(["data: {}\n\n"]),
        };
      });

      const response = await ProxyForwarder.send(session);
      clientController.abort(new Error("client disconnected after headers"));
      expect(transportSignal?.aborted).toBe(false);
      await response.body?.cancel();
    }
  );

  it("detaches transport signals after an upstream error response", async () => {
    const clientController = new AbortController();
    const clientError = new Error("client abort before headers");
    const session = await createGeminiSession(clientController.signal);
    vi.spyOn(ProxyProviderResolver, "pickRandomProviderWithExclusion").mockResolvedValue(null);
    let transportSignal: AbortSignal | undefined;
    transportMocks.request.mockImplementation(async (_url, options) => {
      transportSignal = options.signal;
      clientController.abort(clientError);
      return {
        statusCode: 499,
        headers: { "content-type": "application/json" },
        body: Readable.from(["{}"]),
      };
    });

    await expect(ProxyForwarder.send(session)).rejects.toMatchObject({ statusCode: 503 });

    expect(transportSignal?.aborted).toBe(true);
    expect(transportSignal?.reason).toBe(clientError);
  });
});
