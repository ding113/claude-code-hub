import { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyResponseHandler } from "@/app/v1/_lib/proxy/response-handler";
import { ProxySession, type MessageContext } from "@/app/v1/_lib/proxy/session";
import type { Key } from "@/types/key";
import type { Provider } from "@/types/provider";
import type { User } from "@/types/user";

type TaskOptions = { readonly abortController?: AbortController };

const mocks = vi.hoisted(() => ({
  durable: vi.fn<(id: number, details: object) => Promise<void>>(),
  tasks: Array.from<Promise<void>>([]),
  trackerEnd: vi.fn(),
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

function sseResponse(body: BodyInit): Response {
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

describe("ProxyResponseHandler.dispatch stream terminal behavior", () => {
  beforeEach(() => {
    mocks.tasks.length = 0;
    vi.clearAllMocks();
    mocks.durable.mockResolvedValue(undefined);
  });

  it("persists a naturally completed stream and releases its transport", async () => {
    const { releaseAgent, session } = await createSession({});
    const returned = await ProxyResponseHandler.dispatch(
      session,
      sseResponse('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    );

    await returned.text();
    await settleTasks();

    expect(mocks.durable).toHaveBeenCalledWith(51, expect.objectContaining({ statusCode: 200 }));
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

    expect(mocks.durable).toHaveBeenCalledWith(51, expect.objectContaining({ statusCode: 499 }));
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

    expect(mocks.durable).toHaveBeenCalledWith(51, expect.objectContaining({ statusCode: 502 }));
    expect(cancelSource).toHaveBeenCalledOnce();
    expect(releaseAgent).toHaveBeenCalledOnce();
  });
});
