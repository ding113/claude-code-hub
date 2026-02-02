import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Tests for hot-reload singleton pattern (globalThis caching)
 * Verifies that EventEmitter and RequestFilterEngine use the same instance
 * across multiple dynamic imports (simulating different worker contexts)
 */

describe("globalThis singleton pattern", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    // Clean up globalThis
    const g = globalThis as Record<string, unknown>;
    delete g.__CCH_EVENT_EMITTER__;
    delete g.__CCH_REQUEST_FILTER_ENGINE__;
  });

  test("eventEmitter: multiple imports return same instance", async () => {
    // First import
    const { eventEmitter: emitter1 } = await import("@/lib/event-emitter");

    // Reset module cache to simulate different worker context
    vi.resetModules();

    // Second import
    const { eventEmitter: emitter2 } = await import("@/lib/event-emitter");

    // Should be the exact same instance due to globalThis caching
    expect(emitter1).toBe(emitter2);
  });

  test("eventEmitter: globalThis stores the singleton", async () => {
    const g = globalThis as Record<string, unknown>;

    // Before import, should not exist
    expect(g.__CCH_EVENT_EMITTER__).toBeUndefined();

    // After import, should exist
    const { eventEmitter } = await import("@/lib/event-emitter");
    expect(g.__CCH_EVENT_EMITTER__).toBe(eventEmitter);
  });

  test("requestFilterEngine: multiple imports return same instance", async () => {
    // First import
    const { requestFilterEngine: engine1 } = await import("@/lib/request-filter-engine");

    // Reset module cache
    vi.resetModules();

    // Second import
    const { requestFilterEngine: engine2 } = await import("@/lib/request-filter-engine");

    // Should be the exact same instance
    expect(engine1).toBe(engine2);
  });

  test("requestFilterEngine: globalThis stores the singleton", async () => {
    const g = globalThis as Record<string, unknown>;

    // Before import, should not exist
    expect(g.__CCH_REQUEST_FILTER_ENGINE__).toBeUndefined();

    // After import, should exist
    const { requestFilterEngine } = await import("@/lib/request-filter-engine");
    expect(g.__CCH_REQUEST_FILTER_ENGINE__).toBe(requestFilterEngine);
  });
});

describe("event propagation between singleton instances", () => {
  const prevRuntime = process.env.NEXT_RUNTIME;

  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_RUNTIME = "nodejs";
    // Clean globalThis
    const g = globalThis as Record<string, unknown>;
    delete g.__CCH_EVENT_EMITTER__;
    delete g.__CCH_REQUEST_FILTER_ENGINE__;
  });

  afterEach(() => {
    process.env.NEXT_RUNTIME = prevRuntime;
    const g = globalThis as Record<string, unknown>;
    delete g.__CCH_EVENT_EMITTER__;
    delete g.__CCH_REQUEST_FILTER_ENGINE__;
  });

  test("events emitted in one context should be received in another", async () => {
    const handler = vi.fn();

    // Context A: subscribe to event
    const { eventEmitter: emitterA } = await import("@/lib/event-emitter");
    emitterA.on("requestFiltersUpdated", handler);

    // Reset modules to simulate different worker context
    vi.resetModules();

    // Context B: emit event
    const { eventEmitter: emitterB } = await import("@/lib/event-emitter");
    emitterB.emitRequestFiltersUpdated();

    // Handler should be called because both contexts share the same globalThis instance
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("all event types should work with singleton pattern", async () => {
    const handlers = {
      errorRules: vi.fn(),
      sensitiveWords: vi.fn(),
      requestFilters: vi.fn(),
    };

    // Subscribe in context A
    const { eventEmitter: emitterA } = await import("@/lib/event-emitter");
    emitterA.on("errorRulesUpdated", handlers.errorRules);
    emitterA.on("sensitiveWordsUpdated", handlers.sensitiveWords);
    emitterA.on("requestFiltersUpdated", handlers.requestFilters);

    vi.resetModules();

    // Emit in context B
    const { eventEmitter: emitterB } = await import("@/lib/event-emitter");
    emitterB.emitErrorRulesUpdated();
    emitterB.emitSensitiveWordsUpdated();
    emitterB.emitRequestFiltersUpdated();

    expect(handlers.errorRules).toHaveBeenCalledTimes(1);
    expect(handlers.sensitiveWords).toHaveBeenCalledTimes(1);
    expect(handlers.requestFilters).toHaveBeenCalledTimes(1);
  });
});
