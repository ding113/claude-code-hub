import { afterEach, describe, expect, test, vi } from "vitest";
import type { KeywordRoutingScanTexts } from "@/lib/message-extractor";
import type { KeywordRoutingRule } from "@/repository/keyword-routing-rules";

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  // 捕获 Redis pub/sub 订阅参数，供失效通道与 destroy 清理路径的测试断言
  const redisSubscription: {
    channel: string | null;
    handler: (() => void) | null;
    cleanup: ReturnType<typeof vi.fn>;
  } = {
    channel: null,
    handler: null,
    cleanup: vi.fn(),
  };

  return {
    getActiveKeywordRoutingRules: vi.fn(),
    redisSubscription,
    subscribeCacheInvalidation: vi.fn(async (channel: string, handler: () => void) => {
      redisSubscription.channel = channel;
      redisSubscription.handler = handler;
      return redisSubscription.cleanup;
    }),
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

vi.mock("@/repository/keyword-routing-rules", () => ({
  getActiveKeywordRoutingRules: mocks.getActiveKeywordRoutingRules,
}));

vi.mock("@/lib/event-emitter", () => ({
  eventEmitter: mocks.eventEmitter,
}));

vi.mock("@/lib/redis/pubsub", () => ({
  CHANNEL_KEYWORD_ROUTING_RULES_UPDATED: "cch:cache:keyword_routing_rules:updated",
  subscribeCacheInvalidation: mocks.subscribeCacheInvalidation,
}));

vi.mock("@/lib/logger", () => ({
  logger: mocks.logger,
}));

let nextRuleId = 1;

/** 构建测试规则的工厂函数（id 自增，提供合理默认值） */
function makeRule(overrides: Partial<KeywordRoutingRule> = {}): KeywordRoutingRule {
  const now = new Date("2026-06-01T00:00:00.000Z");
  return {
    id: nextRuleId++,
    keyword: "EXAMPLE DIALOGE",
    sourceModel: null,
    targetModel: "claude-haiku-4-5",
    caseSensitive: true,
    priority: 0,
    description: null,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** 构建扫描文本的便捷函数 */
function makeTexts(overrides: Partial<KeywordRoutingScanTexts> = {}): KeywordRoutingScanTexts {
  return {
    systemTexts: [],
    lastUserTexts: [],
    ...overrides,
  };
}

/** 导入全新的引擎单例（先清理 globalThis 缓存） */
async function importFreshEngine() {
  const { keywordRoutingEngine } = await import("@/lib/keyword-routing/engine");
  // 等待构造函数中异步的事件监听注册完成
  await new Promise((resolve) => setTimeout(resolve, 0));
  return keywordRoutingEngine;
}

describe("KeywordRoutingRuleCache (engine)", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.eventEmitter.removeAllListeners();
    // 重置上一个测试捕获的 Redis 订阅参数（cleanup 的调用记录由 clearAllMocks 清除）
    mocks.redisSubscription.channel = null;
    mocks.redisSubscription.handler = null;
    // 引擎是 globalThis 单例，可跨 resetModules 存活；删除后下个测试
    // 重新导入会构造新实例并重新订阅 mocks.eventEmitter
    delete (globalThis as Record<string, unknown>).__CCH_KEYWORD_ROUTING_ENGINE__;
    nextRuleId = 1;
  });

  test("reload() populates rules from repository; match() delegates to matcher", async () => {
    const rule = makeRule({ keyword: "magic-token" });
    mocks.getActiveKeywordRoutingRules.mockResolvedValueOnce([rule]);

    const engine = await importFreshEngine();
    await engine.reload();

    expect(mocks.getActiveKeywordRoutingRules).toHaveBeenCalledTimes(1);

    // 正向：关键词命中 lastUserTexts
    const hit = engine.match(makeTexts({ lastUserTexts: ["please use magic-token here"] }), null);
    expect(hit?.rule).toBe(rule);
    expect(hit?.matchedIn).toBe("user");

    // 反向：无关键词命中
    const miss = engine.match(makeTexts({ lastUserTexts: ["nothing relevant"] }), null);
    expect(miss).toBeNull();
  });

  test("reload() failure keeps previous rules and lastReloadTime, logs error", async () => {
    const rule = makeRule({ keyword: "magic-token" });
    mocks.getActiveKeywordRoutingRules
      .mockResolvedValueOnce([rule])
      .mockRejectedValueOnce(new Error("db down"));

    const engine = await importFreshEngine();
    await engine.reload();
    const statsAfterSuccess = engine.getStats();

    await engine.reload(); // 第二次 reload 失败

    expect(mocks.logger.error).toHaveBeenCalledWith(
      "[KeywordRoutingRuleCache] Failed to reload keyword routing rules:",
      expect.any(Error)
    );

    // 旧缓存保留，匹配仍可用（降级可用语义）
    const hit = engine.match(makeTexts({ lastUserTexts: ["with magic-token inside"] }), null);
    expect(hit?.rule).toBe(rule);

    // lastReloadTime 仅在成功时更新（与敏感词引擎语义一致）
    const statsAfterFailure = engine.getStats();
    expect(statsAfterFailure.ruleCount).toBe(1);
    expect(statsAfterFailure.lastReloadTime).toBe(statsAfterSuccess.lastReloadTime);
    expect(statsAfterFailure.isLoading).toBe(false);
  });

  test("a reload requested while another is in-flight is queued, not dropped", async () => {
    let resolveFirstLoad: ((value: KeywordRoutingRule[]) => void) | undefined;

    // 第一次加载挂起并返回旧快照（1 条规则），第二次加载返回用户刚保存的新快照（2 条规则）
    mocks.getActiveKeywordRoutingRules
      .mockImplementationOnce(
        () =>
          new Promise<KeywordRoutingRule[]>((resolve) => {
            resolveFirstLoad = resolve;
          })
      )
      .mockResolvedValueOnce([makeRule(), makeRule()]);

    const engine = await importFreshEngine();

    const firstReload = engine.reload(); // 启动加载（挂起中）
    const secondReload = engine.reload(); // 在途中再次请求 -> 排队补跑

    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveFirstLoad?.([makeRule()]);
    await Promise.all([firstReload, secondReload]);

    // 在途中的 reload 请求不能被静默丢弃：仓库总共读取两次，
    // 最终缓存反映最新快照（2 条规则）而非旧快照（1 条）
    expect(mocks.getActiveKeywordRoutingRules).toHaveBeenCalledTimes(2);
    expect(engine.getStats().ruleCount).toBe(2);
  });

  test("isEmpty() is true before load, false after; getStats() shape", async () => {
    mocks.getActiveKeywordRoutingRules.mockResolvedValueOnce([makeRule(), makeRule()]);

    const engine = await importFreshEngine();

    expect(engine.isEmpty()).toBe(true);
    expect(engine.getStats()).toEqual({
      ruleCount: 0,
      lastReloadTime: 0,
      isLoading: false,
    });

    await engine.reload();

    expect(engine.isEmpty()).toBe(false);
    expect(engine.getStats()).toEqual({
      ruleCount: 2,
      lastReloadTime: expect.any(Number),
      isLoading: false,
    });
    expect(engine.getStats().lastReloadTime).toBeGreaterThan(0);
  });

  test("local keywordRoutingRulesUpdated event triggers reload", async () => {
    mocks.getActiveKeywordRoutingRules.mockResolvedValueOnce([makeRule()]);

    const engine = await importFreshEngine();
    expect(engine.isEmpty()).toBe(true);

    mocks.eventEmitter.emit("keywordRoutingRulesUpdated");
    // 等待事件触发的异步 reload 完成
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.getActiveKeywordRoutingRules).toHaveBeenCalledTimes(1);
    expect(engine.isEmpty()).toBe(false);
  });

  test("engine subscribes to the keyword routing Redis invalidation channel", async () => {
    mocks.getActiveKeywordRoutingRules.mockResolvedValue([makeRule()]);

    await importFreshEngine();

    expect(mocks.subscribeCacheInvalidation).toHaveBeenCalledTimes(1);
    expect(mocks.redisSubscription.channel).toBe("cch:cache:keyword_routing_rules:updated");
    expect(mocks.redisSubscription.handler).toBeTypeOf("function");
  });

  test("Redis invalidation message triggers reload via the subscribed handler", async () => {
    mocks.getActiveKeywordRoutingRules.mockResolvedValueOnce([makeRule()]);

    const engine = await importFreshEngine();
    expect(engine.isEmpty()).toBe(true);

    // 模拟收到 Redis 失效通知（跨进程路径，绕过本地 eventEmitter）
    mocks.redisSubscription.handler?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.getActiveKeywordRoutingRules).toHaveBeenCalledTimes(1);
    expect(engine.isEmpty()).toBe(false);
  });

  test("destroy() removes the local event listener and invokes the Redis cleanup", async () => {
    mocks.getActiveKeywordRoutingRules.mockResolvedValue([makeRule()]);

    const engine = await importFreshEngine();
    expect(mocks.redisSubscription.cleanup).not.toHaveBeenCalled();

    engine.destroy();

    // Redis 订阅清理函数被调用
    expect(mocks.redisSubscription.cleanup).toHaveBeenCalledTimes(1);

    // 本地事件监听已移除：再发事件不会触发 reload
    mocks.eventEmitter.emit("keywordRoutingRulesUpdated");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.getActiveKeywordRoutingRules).not.toHaveBeenCalled();
  });
});
