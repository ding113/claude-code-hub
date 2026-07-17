import { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyResponseHandler } from "@/app/v1/_lib/proxy/response-handler";
import { ProxySession, type MessageContext } from "@/app/v1/_lib/proxy/session";
import type { Key } from "@/types/key";
import type { Provider } from "@/types/provider";
import type { User } from "@/types/user";

type TaskOptions = { readonly abortController?: AbortController; readonly taskType?: string };
type TerminalWriterOptions = { readonly onCommitted?: () => void | Promise<void> };

const mocks = vi.hoisted(() => ({
  conditional:
    vi.fn<(id: number, details: object, options?: TerminalWriterOptions) => Promise<boolean>>(),
  durable:
    vi.fn<(id: number, details: object, options?: TerminalWriterOptions) => Promise<boolean>>(),
  recordFailure: vi.fn<(providerId: number, error: Error) => Promise<void>>(),
  tasks: Array.from<Promise<void>>([]),
  trackerEnd: vi.fn(),
}));

vi.mock("@/app/v1/_lib/proxy/response-fixer", () => ({
  ResponseFixer: { process: async (_session: ProxySession, response: Response) => response },
}));
vi.mock("@/lib/async-task-manager", () => ({
  AsyncTaskManager: {
    cancel: vi.fn(),
    cleanup: vi.fn(),
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
vi.mock("@/lib/circuit-breaker", () => ({
  recordFailure: mocks.recordFailure,
  recordSuccess: vi.fn(),
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
  updateMessageRequestDetailsIfUnfinalized: mocks.conditional,
  updateMessageRequestDuration: vi.fn(),
  updateMessageRequestWinnerCost: vi.fn(),
}));

const CREATED_AT = new Date(0);
const USER = {
  createdAt: CREATED_AT,
  dailyQuota: null,
  dailyResetMode: "fixed",
  dailyResetTime: "00:00",
  description: "terminal test user",
  id: 11,
  isEnabled: true,
  limit5hResetMode: "fixed",
  name: "terminal-user",
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
  id: 12,
  isEnabled: true,
  key: "sk-terminal",
  limit5hResetMode: "fixed",
  limit5hUsd: null,
  limitConcurrentSessions: 0,
  limitDailyUsd: null,
  limitMonthlyUsd: null,
  limitWeeklyUsd: null,
  name: "terminal-key",
  providerGroup: null,
  updatedAt: CREATED_AT,
  userId: USER.id,
} satisfies Key;
const MESSAGE = {
  apiKey: KEY.key,
  createdAt: CREATED_AT,
  id: 41,
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
    id: 7,
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
    name: "nonstream-terminal-provider",
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

async function createSession(releaseAgent: () => void): Promise<ProxySession> {
  const request = new Request("https://hub.test/v1/messages", {
    body: JSON.stringify({ messages: [], stream: false }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const session = await ProxySession.fromContext(new Context(request));
  session.setProvider(createProvider());
  session.setMessageContext(MESSAGE);
  Object.defineProperty(session, "releaseAgent", { value: releaseAgent, writable: true });
  return session;
}

async function settleTasks(): Promise<PromiseSettledResult<void>[]> {
  const settlements = Array.from<PromiseSettledResult<void>>([]);
  while (mocks.tasks.length > 0) {
    settlements.push(...(await Promise.allSettled(mocks.tasks.splice(0, mocks.tasks.length))));
  }
  return settlements;
}

describe("ProxyResponseHandler.dispatch nonstream terminal behavior", () => {
  beforeEach(() => {
    mocks.tasks.length = 0;
    vi.clearAllMocks();
    mocks.conditional.mockImplementation(async (_id, _details, options) => {
      try {
        const result = options?.onCommitted?.();
        if (result) void Promise.resolve(result).catch(() => undefined);
      } catch {
        // Test mock mirrors the repository's commit-observer boundary.
      }
      return true;
    });
    mocks.durable.mockImplementation(async (_id, _details, options) => {
      try {
        const result = options?.onCommitted?.();
        if (result) void Promise.resolve(result).catch(() => undefined);
      } catch {
        // Test mock mirrors the repository's commit-observer boundary.
      }
      return true;
    });
    mocks.recordFailure.mockResolvedValue(undefined);
  });

  it("uses conditional persistence before recording a nonstream provider failure", async () => {
    mocks.durable.mockRejectedValueOnce(new Error("primary unavailable"));
    const releaseAgent = vi.fn();
    const session = await createSession(releaseAgent);

    const returned = await ProxyResponseHandler.dispatch(
      session,
      new Response('{"error":{"message":"unavailable"}}', {
        status: 503,
        headers: { "content-type": "application/json" },
      })
    );
    await returned.text();
    const settlements = await settleTasks();

    expect(settlements.every(({ status }) => status === "fulfilled")).toBe(true);
    expect(mocks.conditional).toHaveBeenCalledWith(
      41,
      expect.objectContaining({ durationMs: expect.any(Number), statusCode: 503 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
    expect(mocks.recordFailure).toHaveBeenCalledWith(7, expect.any(Error));
    expect(mocks.conditional.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recordFailure.mock.invocationCallOrder[0]
    );
    expect(releaseAgent).toHaveBeenCalledOnce();
  });

  it("rejects the managed task without mutating the circuit when both writes fail", async () => {
    mocks.durable.mockRejectedValueOnce(new Error("primary unavailable"));
    mocks.conditional.mockRejectedValueOnce(new Error("fallback unavailable"));
    const releaseAgent = vi.fn();
    const session = await createSession(releaseAgent);

    const returned = await ProxyResponseHandler.dispatch(
      session,
      new Response('{"error":{"message":"unavailable"}}', {
        status: 503,
        headers: { "content-type": "application/json" },
      })
    );
    await returned.text();
    const settlements = await settleTasks();

    expect(settlements.some(({ status }) => status === "rejected")).toBe(true);
    expect(mocks.recordFailure).not.toHaveBeenCalled();
    expect(mocks.trackerEnd).toHaveBeenCalledWith(USER.id, MESSAGE.id);
    expect(releaseAgent).toHaveBeenCalledOnce();
  });
});
