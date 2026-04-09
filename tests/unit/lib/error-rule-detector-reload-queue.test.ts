import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  return {
    getActiveErrorRules: vi.fn(),
    subscribeCacheInvalidation: vi.fn(async () => undefined),
    eventEmitter: {
      on(event: string, handler: (...args: unknown[]) => void) {
        const current = listeners.get(event) ?? new Set<(...args: unknown[]) => void>();
        current.add(handler);
        listeners.set(event, current);
      },
      emit(event: string, ...args: unknown[]) {
        for (const handler of listeners.get(event) ?? []) {
          handler(...args);
        }
      },
      removeAllListeners() {
        listeners.clear();
      },
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      trace: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    },
  };
});

vi.mock("@/repository/error-rules", () => ({
  getActiveErrorRules: mocks.getActiveErrorRules,
}));

vi.mock("@/lib/event-emitter", () => ({
  eventEmitter: mocks.eventEmitter,
}));

vi.mock("@/lib/redis/pubsub", () => ({
  CHANNEL_ERROR_RULES_UPDATED: "errorRulesUpdated",
  subscribeCacheInvalidation: mocks.subscribeCacheInvalidation,
}));

vi.mock("@/lib/logger", () => ({
  logger: mocks.logger,
}));

function buildRule(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 101,
    pattern: "missing thinking fields",
    matchType: "contains" as const,
    category: "thinking_error",
    description: "YesCode missing thinking fields",
    overrideResponse: undefined,
    overrideStatusCode: 400,
    isEnabled: true,
    isDefault: false,
    priority: 10,
    createdAt: new Date("2026-04-09T00:00:00.000Z"),
    updatedAt: new Date("2026-04-09T00:00:00.000Z"),
    ...overrides,
  };
}

describe("ErrorRuleDetector reload queue", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.eventEmitter.removeAllListeners();
  });

  test("should apply a queued reload after errorRulesUpdated arrives mid-reload", async () => {
    let resolveFirstLoad: ((value: ReturnType<typeof buildRule>[]) => void) | undefined;

    mocks.getActiveErrorRules
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof buildRule>[]>((resolve) => {
            resolveFirstLoad = resolve;
          })
      )
      .mockResolvedValueOnce([]);

    const { errorRuleDetector } = await import("@/lib/error-rule-detector");

    // 等待构造函数里的事件监听异步挂载完成
    await new Promise((resolve) => setTimeout(resolve, 0));

    const initialReload = errorRuleDetector.reload();

    mocks.eventEmitter.emit("errorRulesUpdated");

    resolveFirstLoad?.([buildRule()]);
    await initialReload;

    // 给事件触发的补跑 reload 一个完成机会
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.getActiveErrorRules).toHaveBeenCalledTimes(2);
    expect(errorRuleDetector.detect("Your session is missing thinking fields").matched).toBe(false);
  });

  test("should restart reload when errorRulesUpdated lands after loading stops but before promise cleanup", async () => {
    let resolveFirstLoad: ((value: ReturnType<typeof buildRule>[]) => void) | undefined;

    mocks.getActiveErrorRules
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof buildRule>[]>((resolve) => {
            resolveFirstLoad = (value) => {
              resolve(value);
              queueMicrotask(() => {
                mocks.eventEmitter.emit("errorRulesUpdated");
              });
            };
          })
      )
      .mockResolvedValueOnce([]);

    const { errorRuleDetector } = await import("@/lib/error-rule-detector");

    await new Promise((resolve) => setTimeout(resolve, 0));

    const initialReload = errorRuleDetector.reload();

    resolveFirstLoad?.([buildRule()]);
    await initialReload;

    expect(mocks.getActiveErrorRules).toHaveBeenCalledTimes(2);
    expect(errorRuleDetector.detect("Your session is missing thinking fields").matched).toBe(false);
  });
});
