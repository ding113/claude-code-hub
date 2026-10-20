import { Context } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyResponseHandler } from "@/app/v1/_lib/proxy/response-handler";
import { ProxySession, type MessageContext } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";
import type { User } from "@/types/user";

type TaskOptions = { readonly abortController?: AbortController };
type TerminalWriterOptions = { readonly onCommitted?: () => void | Promise<void> };
const mocks = vi.hoisted(() => ({
  conditional:
    vi.fn<(id: number, details: object, options?: TerminalWriterOptions) => Promise<boolean>>(),
  details: vi.fn<(id: number, details: object) => Promise<void>>(),
  durable:
    vi.fn<(id: number, details: object, options?: TerminalWriterOptions) => Promise<boolean>>(),
  tasks: Array.from<Promise<void>>([]),
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
  ProxyStatusTracker: { getInstance: () => ({ endRequest: vi.fn() }) },
}));
vi.mock("@/repository/message", () => ({
  addMessageRequestHedgeLoserCost: vi.fn(),
  updateMessageRequestCostWithBreakdown: vi.fn(),
  updateMessageRequestDetails: mocks.details,
  updateMessageRequestDetailsDurably: mocks.durable,
  updateMessageRequestDetailsIfUnfinalized: mocks.conditional,
  updateMessageRequestDuration: vi.fn(),
  updateMessageRequestWinnerCost: vi.fn(),
}));

type TerminalMessage = Pick<MessageContext, "createdAt" | "id"> & {
  readonly user: Pick<User, "id">;
};
const MESSAGE = {
  createdAt: new Date(0),
  id: 61,
  user: { id: 31 },
} satisfies TerminalMessage;

type GeminiProvider = Pick<
  Provider,
  | "costMultiplier"
  | "id"
  | "name"
  | "providerType"
  | "streamingIdleTimeoutMs"
  | "swapCacheTtlBilling"
>;

function createProvider(streamingIdleTimeoutMs = 0): GeminiProvider {
  return {
    costMultiplier: 1,
    id: 9,
    name: "gemini-terminal-provider",
    providerType: "gemini",
    streamingIdleTimeoutMs,
    swapCacheTtlBilling: false,
  } satisfies GeminiProvider;
}

async function createSession(options: {
  readonly idleMs?: number;
  readonly responseController?: AbortController;
}): Promise<ProxySession> {
  const request = new Request("https://hub.test/v1/messages", {
    body: JSON.stringify({ messages: [], stream: true }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const session = await ProxySession.fromContext(new Context(request));
  Object.defineProperty(session, "provider", {
    value: createProvider(options.idleMs),
    writable: true,
  });
  Object.defineProperty(session, "messageContext", { value: MESSAGE, writable: true });
  session.providerType = "gemini";
  session.setOriginalFormat("gemini");
  if (options.responseController) {
    Object.defineProperty(session, "responseController", { value: options.responseController });
  }
  return session;
}

const geminiResponse = (body: BodyInit) =>
  new Response(body, { headers: { "content-type": "text/event-stream" } });

async function settleTasks(): Promise<void> {
  while (mocks.tasks.length > 0) {
    const results = await Promise.allSettled(mocks.tasks.splice(0, mocks.tasks.length));
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
    if (errors.length > 0) {
      throw new AggregateError(errors, "Gemini terminal background tasks failed");
    }
  }
}

describe("ProxyResponseHandler.dispatch Gemini terminal behavior", () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    vi.useRealTimers();
    mocks.tasks.length = 0;
    vi.clearAllMocks();
    mocks.conditional.mockResolvedValue(true);
    mocks.details.mockResolvedValue(undefined);
    mocks.durable.mockResolvedValue(true);
  });

  it("drains the Gemini source after the returned body is cancelled", async () => {
    const cancelSource = vi.fn();
    let sourceController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      cancel: cancelSource,
      start(controller) {
        sourceController = controller;
        controller.enqueue(encoder.encode('{"chunk":1}\n'));
      },
    });
    const session = await createSession({});
    const returned = await ProxyResponseHandler.dispatch(session, geminiResponse(source));

    await returned.body?.cancel(new Error("client cancelled body"));
    sourceController?.enqueue(encoder.encode('{"usageMetadata":{"promptTokenCount":1}}\n'));
    sourceController?.close();
    await settleTasks();

    expect(cancelSource).not.toHaveBeenCalled();
    expect(mocks.durable).toHaveBeenCalledWith(
      MESSAGE.id,
      expect.objectContaining({
        durationMs: expect.any(Number),
        inputTokens: 1,
        statusCode: 499,
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("resets the Gemini idle window after every received chunk", async () => {
    vi.useFakeTimers();
    const responseController = new AbortController();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('{"chunk":1}\n'));
        setTimeout(() => controller.enqueue(encoder.encode('{"chunk":2}\n')), 80);
        setTimeout(() => {
          controller.enqueue(encoder.encode('{"finishReason":"STOP"}\n'));
          controller.close();
        }, 160);
      },
    });
    const session = await createSession({ idleMs: 100, responseController });
    const returned = await ProxyResponseHandler.dispatch(session, geminiResponse(source));
    const body = returned.text();

    await vi.advanceTimersByTimeAsync(160);
    await expect(body).resolves.toContain('"finishReason":"STOP"');
    await settleTasks();

    expect(responseController.signal.aborted).toBe(false);
  });

  it("uses conditional persistence when Gemini durable finalization fails", async () => {
    mocks.durable.mockRejectedValue(new Error("durable unavailable"));
    const session = await createSession({});
    const returned = await ProxyResponseHandler.dispatch(
      session,
      geminiResponse('{"finishReason":"STOP"}\n')
    );

    await returned.text();
    await settleTasks();

    expect(mocks.conditional).toHaveBeenCalledWith(
      MESSAGE.id,
      expect.objectContaining({ durationMs: expect.any(Number), statusCode: 500 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("settles Gemini terminal work when fallback persistence hangs", async () => {
    vi.useFakeTimers();
    mocks.durable.mockRejectedValue(new Error("durable unavailable"));
    mocks.details.mockImplementation(() => new Promise<void>(() => {}));
    mocks.conditional.mockImplementation(() => new Promise<void>(() => {}));
    const session = await createSession({});
    const returned = await ProxyResponseHandler.dispatch(
      session,
      geminiResponse('{"finishReason":"STOP"}\n')
    );
    await returned.text();
    const terminalTask = mocks.tasks[0];
    let settled = false;
    void terminalTask?.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );

    await vi.advanceTimersByTimeAsync(5_001);

    expect(mocks.details.mock.calls.length + mocks.conditional.mock.calls.length).toBeGreaterThan(
      0
    );
    expect(settled).toBe(true);
  });
});
