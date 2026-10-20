import { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyResponseHandler } from "@/app/v1/_lib/proxy/response-handler";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

type TaskOptions = {
  readonly abortController?: AbortController;
  readonly staleTimeoutMs?: number;
  readonly taskType?: string;
};

const state = vi.hoisted(() => ({
  tasks: Array.from<Promise<void>>([]),
  taskTypes: Array.from<string>([]),
}));

vi.mock("@/app/v1/_lib/proxy/response-fixer", () => ({
  ResponseFixer: { process: async (_session: ProxySession, response: Response) => response },
}));
vi.mock("@/lib/async-task-manager", () => ({
  AsyncTaskManager: {
    cancel: vi.fn(),
    cleanup: vi.fn(),
    register: (
      _taskId: string,
      factory: (signal: AbortSignal) => Promise<void>,
      options: string | TaskOptions = "unknown"
    ) => {
      const controller =
        typeof options === "object" && options.abortController
          ? options.abortController
          : new AbortController();
      const task = Promise.resolve().then(() => factory(controller.signal));
      state.tasks.push(task);
      state.taskTypes.push(typeof options === "object" ? (options.taskType ?? "unknown") : options);
      return controller;
    },
    touch: vi.fn(() => true),
  },
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
vi.mock("@/repository/message", () => ({
  addMessageRequestHedgeLoserCost: vi.fn(),
  updateMessageRequestCostWithBreakdown: vi.fn(),
  updateMessageRequestDetails: vi.fn(),
  updateMessageRequestDetailsDurably: vi.fn(),
  updateMessageRequestDetailsIfUnfinalized: vi.fn(),
  updateMessageRequestDuration: vi.fn(),
  updateMessageRequestWinnerCost: vi.fn(),
}));

function createProvider(): Provider {
  const now = new Date(0);
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
    createdAt: now,
    customHeaders: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    disableSessionReuse: false,
    faviconUrl: null,
    firstByteTimeoutStreamingMs: 0,
    geminiGoogleSearchPreference: null,
    groupPriorities: null,
    groupTag: null,
    id: 1,
    isEnabled: true,
    key: "test-key",
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
    name: "public-dispatch-provider",
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
    updatedAt: now,
    url: "https://provider.test",
    websiteUrl: null,
    weight: 1,
  } satisfies Provider;
}

async function createSession(stream: boolean, provider: Provider | null): Promise<ProxySession> {
  const request = new Request("https://hub.test/v1/messages", {
    body: JSON.stringify({ messages: [], stream }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const session = await ProxySession.fromContext(new Context(request));
  session.setProvider(provider);
  return session;
}

async function settleTasks(): Promise<void> {
  while (state.tasks.length > 0) {
    const tasks = state.tasks.splice(0, state.tasks.length);
    await Promise.all(tasks);
  }
}

describe("ProxyResponseHandler.dispatch public routing", () => {
  beforeEach(() => {
    state.tasks.length = 0;
    state.taskTypes.length = 0;
    vi.clearAllMocks();
  });

  it("returns a nonstream response and releases the transport when no provider exists", async () => {
    const releaseAgent = vi.fn();
    const session = await createSession(false, null);
    Object.defineProperty(session, "releaseAgent", {
      configurable: true,
      value: releaseAgent,
      writable: true,
    });
    const upstream = new Response('{"ok":true}', {
      headers: { "content-type": "application/json" },
    });

    const returned = await ProxyResponseHandler.dispatch(session, upstream);

    await expect(returned.text()).resolves.toBe('{"ok":true}');
    expect(releaseAgent).toHaveBeenCalledOnce();
    expect(state.tasks).toEqual([]);
  });

  it("routes a provider nonstream response through the managed terminal task", async () => {
    const releaseAgent = vi.fn();
    const session = await createSession(false, createProvider());
    Object.defineProperty(session, "releaseAgent", {
      configurable: true,
      value: releaseAgent,
      writable: true,
    });
    const upstream = new Response('{"result":"accepted"}', {
      headers: { "content-type": "application/json" },
    });

    const returned = await ProxyResponseHandler.dispatch(session, upstream);
    await expect(returned.text()).resolves.toBe('{"result":"accepted"}');
    await settleTasks();

    expect(state.taskTypes).toContain("non-stream-processing");
    expect(releaseAgent).toHaveBeenCalledOnce();
  });

  it("routes SSE through the stream boundary and releases an incomplete session", async () => {
    const releaseAgent = vi.fn();
    const session = await createSession(true, createProvider());
    Object.defineProperty(session, "releaseAgent", {
      configurable: true,
      value: releaseAgent,
      writable: true,
    });
    const upstream = new Response('event: message_stop\ndata: {"type":"message_stop"}\n\n', {
      headers: { "content-type": "text/event-stream" },
    });

    const returned = await ProxyResponseHandler.dispatch(session, upstream);

    await expect(returned.text()).resolves.toContain("message_stop");
    expect(releaseAgent).toHaveBeenCalledOnce();
    expect(state.tasks).toEqual([]);
  });
});
