import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    emitErrorRulesUpdated: vi.fn(),
    emitSensitiveWordsUpdated: vi.fn(),
    emitRequestFiltersUpdated: vi.fn(),
    publishCacheInvalidation: vi.fn(async () => {}),
  };
});

vi.mock("@/lib/event-emitter", () => ({
  eventEmitter: {
    emitErrorRulesUpdated: mocks.emitErrorRulesUpdated,
    emitSensitiveWordsUpdated: mocks.emitSensitiveWordsUpdated,
    emitRequestFiltersUpdated: mocks.emitRequestFiltersUpdated,
  },
}));

vi.mock("@/lib/redis/pubsub", () => ({
  CHANNEL_ERROR_RULES_UPDATED: "cch:cache:error_rules:updated",
  CHANNEL_REQUEST_FILTERS_UPDATED: "cch:cache:request_filters:updated",
  publishCacheInvalidation: mocks.publishCacheInvalidation,
}));

describe.sequential("emit-event", () => {
  const prevRuntime = process.env.NEXT_RUNTIME;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_RUNTIME = "nodejs";
  });

  afterEach(() => {
    process.env.NEXT_RUNTIME = prevRuntime;
  });

  test("emitErrorRulesUpdated：Node.js runtime 下应触发本地事件并广播缓存失效", async () => {
    const { emitErrorRulesUpdated } = await import("@/lib/emit-event");
    await emitErrorRulesUpdated();

    expect(mocks.emitErrorRulesUpdated).toHaveBeenCalledTimes(1);
    expect(mocks.publishCacheInvalidation).toHaveBeenCalledTimes(1);
    expect(mocks.publishCacheInvalidation).toHaveBeenCalledWith("cch:cache:error_rules:updated");
  });

  test("emitSensitiveWordsUpdated：Node.js runtime 下仅触发本地事件", async () => {
    const { emitSensitiveWordsUpdated } = await import("@/lib/emit-event");
    await emitSensitiveWordsUpdated();

    expect(mocks.emitSensitiveWordsUpdated).toHaveBeenCalledTimes(1);
    expect(mocks.publishCacheInvalidation).not.toHaveBeenCalled();
  });

  test("emitRequestFiltersUpdated：Node.js runtime 下应触发本地事件并广播缓存失效", async () => {
    const { emitRequestFiltersUpdated } = await import("@/lib/emit-event");
    await emitRequestFiltersUpdated();

    expect(mocks.emitRequestFiltersUpdated).toHaveBeenCalledTimes(1);
    expect(mocks.publishCacheInvalidation).toHaveBeenCalledTimes(1);
    expect(mocks.publishCacheInvalidation).toHaveBeenCalledWith(
      "cch:cache:request_filters:updated"
    );
  });

  test("Edge runtime 下应静默跳过（不触发任何事件/广播）", async () => {
    process.env.NEXT_RUNTIME = "edge";

    const { emitErrorRulesUpdated, emitSensitiveWordsUpdated, emitRequestFiltersUpdated } =
      await import("@/lib/emit-event");

    await emitErrorRulesUpdated();
    await emitSensitiveWordsUpdated();
    await emitRequestFiltersUpdated();

    expect(mocks.emitErrorRulesUpdated).not.toHaveBeenCalled();
    expect(mocks.emitSensitiveWordsUpdated).not.toHaveBeenCalled();
    expect(mocks.emitRequestFiltersUpdated).not.toHaveBeenCalled();
    expect(mocks.publishCacheInvalidation).not.toHaveBeenCalled();
  });
});
