import { afterEach, describe, expect, test, vi } from "vitest";
import type { RequestFilter } from "@/repository/request-filters";

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  return {
    getActiveRequestFilters: vi.fn(),
    subscribeCacheInvalidation: vi.fn(async () => undefined),
    eventEmitter: {
      on(event: string, handler: (...args: unknown[]) => void) {
        const current = listeners.get(event) ?? new Set<(...args: unknown[]) => void>();
        current.add(handler);
        listeners.set(event, current);
      },
      off(event: string, handler: (...args: unknown[]) => void) {
        listeners.get(event)?.delete(handler);
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

vi.mock("@/repository/request-filters", () => ({
  getActiveRequestFilters: mocks.getActiveRequestFilters,
}));

vi.mock("@/lib/event-emitter", () => ({
  eventEmitter: mocks.eventEmitter,
}));

vi.mock("@/lib/redis/pubsub", () => ({
  CHANNEL_REQUEST_FILTERS_UPDATED: "requestFiltersUpdated",
  subscribeCacheInvalidation: mocks.subscribeCacheInvalidation,
}));

vi.mock("@/lib/logger", () => ({
  logger: mocks.logger,
}));

let nextId = 1;
function buildFilter(overrides?: Partial<RequestFilter>): RequestFilter {
  return {
    id: nextId++,
    name: "filter",
    description: null,
    scope: "header",
    action: "remove",
    matchType: null,
    target: "x-test-header",
    replacement: null,
    priority: 0,
    isEnabled: true,
    bindingType: "global",
    providerIds: null,
    groupTags: null,
    ruleMode: "simple",
    executionPhase: "guard",
    operations: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** Returns an array of N distinct global-guard filters. */
function filters(n: number): RequestFilter[] {
  return Array.from({ length: n }, () => buildFilter());
}

describe("RequestFilterEngine reload queue", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.eventEmitter.removeAllListeners();
    // The engine is a globalThis singleton that survives resetModules, so its
    // event listener only registers on first construction. Drop it so the next
    // test re-imports a fresh engine that re-subscribes to mocks.eventEmitter.
    delete (globalThis as Record<string, unknown>).__CCH_REQUEST_FILTER_ENGINE__;
    nextId = 1;
  });

  test("applies a reload requested while another reload is in-flight (not dropped)", async () => {
    let resolveFirstLoad: ((value: RequestFilter[]) => void) | undefined;

    // First load is slow and returns 1 filter (the "old" snapshot).
    // Second load returns 2 filters (the "new" snapshot saved by the user).
    mocks.getActiveRequestFilters
      .mockImplementationOnce(
        () =>
          new Promise<RequestFilter[]>((resolve) => {
            resolveFirstLoad = resolve;
          })
      )
      .mockResolvedValueOnce(filters(2));

    const { requestFilterEngine } = await import("@/lib/request-filter-engine");
    // Allow the constructor's async event-listener wiring to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const firstReload = requestFilterEngine.reload(); // starts load #1 (pending)
    const secondReload = requestFilterEngine.reload(); // requested mid-flight -> must queue

    // Let the dynamic import inside reload() settle so load #1 actually calls
    // getActiveRequestFilters (assigning resolveFirstLoad) before we resolve it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveFirstLoad?.(filters(1));
    await Promise.all([firstReload, secondReload]);

    // The concurrent reload must NOT be silently dropped: a second DB read runs
    // and the engine ends up reflecting the newest snapshot (2 filters), not the
    // stale one (1 filter).
    expect(mocks.getActiveRequestFilters).toHaveBeenCalledTimes(2);
    expect(requestFilterEngine.getStats().count).toBe(2);
  });

  test("a requestFiltersUpdated event during a reload triggers a queued rerun", async () => {
    let resolveFirstLoad: ((value: RequestFilter[]) => void) | undefined;

    mocks.getActiveRequestFilters
      .mockImplementationOnce(
        () =>
          new Promise<RequestFilter[]>((resolve) => {
            resolveFirstLoad = resolve;
          })
      )
      .mockResolvedValueOnce(filters(3));

    const { requestFilterEngine } = await import("@/lib/request-filter-engine");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const firstReload = requestFilterEngine.reload();
    mocks.eventEmitter.emit("requestFiltersUpdated");

    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveFirstLoad?.(filters(1));
    await firstReload;
    // Let the queued rerun (kicked by the event handler) settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.getActiveRequestFilters).toHaveBeenCalledTimes(2);
    expect(requestFilterEngine.getStats().count).toBe(3);
  });

  test("an awaited reload after an in-flight reload observes the freshest snapshot", async () => {
    // Models the save path: the repository emits an event (fire-and-forget reload),
    // then the action awaits its own reload. The awaited reload must resolve only
    // after a pass that reflects the just-written rows.
    let resolveFirstLoad: ((value: RequestFilter[]) => void) | undefined;

    mocks.getActiveRequestFilters
      .mockImplementationOnce(
        () =>
          new Promise<RequestFilter[]>((resolve) => {
            resolveFirstLoad = resolve;
          })
      )
      .mockResolvedValueOnce(filters(5));

    const { requestFilterEngine } = await import("@/lib/request-filter-engine");
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Event-driven (fire-and-forget) reload starts first.
    void requestFilterEngine.reload();
    // Action's awaited reload races in while the first is still loading.
    const awaitedReload = requestFilterEngine.reload();

    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveFirstLoad?.(filters(1));
    await awaitedReload;

    expect(mocks.getActiveRequestFilters).toHaveBeenCalledTimes(2);
    expect(requestFilterEngine.getStats().count).toBe(5);
  });
});
