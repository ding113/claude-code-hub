import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 受控的依赖 mock（在 beforeEach 中通过 vi.doMock 装配，跨 resetModules 复用同一组 spy）
const mockGetNotificationSettings = vi.fn();
const mockGenerateDailyLeaderboard = vi.fn();
const mockGenerateCostAlerts = vi.fn();
const mockSendWebhookMessage = vi.fn();
const mockGetEnabledBindingsByType = vi.fn(async () => []);

const queueAdd = vi.fn(async () => ({}));
const queueGetRepeatableJobs = vi.fn(async () => [] as Array<{ key: string }>);
const queueRemoveRepeatableByKey = vi.fn(async () => {});

type MockJob = {
  id: string;
  timestamp: number;
  data: Record<string, unknown>;
  update: (data: unknown) => Promise<void>;
};

class MockQueue {
  processHandler: ((job: MockJob) => Promise<unknown>) | null = null;
  add = queueAdd;
  getRepeatableJobs = queueGetRepeatableJobs;
  removeRepeatableByKey = queueRemoveRepeatableByKey;
  process = vi.fn((fn: (job: MockJob) => Promise<unknown>) => {
    this.processHandler = fn;
  });
  on = vi.fn();
  close = vi.fn(async () => {});

  constructor() {
    capturedQueue = this;
  }
}

let capturedQueue: MockQueue | null = null;

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    enabled: false,
    useLegacyMode: true,
    circuitBreakerEnabled: false,
    circuitBreakerWebhook: null,
    dailyLeaderboardEnabled: false,
    dailyLeaderboardWebhook: null,
    dailyLeaderboardTime: "18:00",
    dailyLeaderboardTopN: 5,
    costAlertEnabled: false,
    costAlertWebhook: null,
    costAlertThreshold: "0.80",
    costAlertCheckInterval: 60,
    cacheHitRateAlertEnabled: false,
    cacheHitRateAlertWebhook: null,
    cacheHitRateAlertWindowMode: "auto",
    cacheHitRateAlertCheckInterval: 5,
    cacheHitRateAlertHistoricalLookbackDays: 7,
    cacheHitRateAlertMinEligibleRequests: 20,
    cacheHitRateAlertMinEligibleTokens: 0,
    cacheHitRateAlertAbsMin: "0.05",
    cacheHitRateAlertDropRel: "0.3",
    cacheHitRateAlertDropAbs: "0.1",
    cacheHitRateAlertCooldownMinutes: 30,
    cacheHitRateAlertTopN: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  capturedQueue = null;
  process.env.REDIS_URL = "redis://localhost:6379";

  vi.doMock("bull", () => ({ default: MockQueue }));

  vi.doMock("@/repository/notifications", () => ({
    getNotificationSettings: mockGetNotificationSettings,
  }));

  vi.doMock("@/repository/notification-bindings", () => ({
    getEnabledBindingsByType: mockGetEnabledBindingsByType,
    getBindingById: vi.fn(async () => null),
  }));

  vi.doMock("@/repository/webhook-targets", () => ({
    getWebhookTargetById: vi.fn(async () => ({ isEnabled: true })),
  }));

  vi.doMock("@/lib/notification/tasks/daily-leaderboard", () => ({
    generateDailyLeaderboard: mockGenerateDailyLeaderboard,
  }));

  vi.doMock("@/lib/notification/tasks/cost-alert", () => ({
    generateCostAlerts: mockGenerateCostAlerts,
  }));

  vi.doMock("@/lib/notification/tasks/cache-hit-rate-alert", () => ({
    applyCacheHitRateAlertCooldownToPayload: vi.fn(),
    buildCacheHitRateAlertCooldownKey: vi.fn(),
    commitCacheHitRateAlertCooldown: vi.fn(),
    generateCacheHitRateAlertPayload: vi.fn(),
  }));

  vi.doMock("@/lib/webhook", () => ({
    buildCacheHitRateAlertMessage: vi.fn(() => ({})),
    buildCircuitBreakerMessage: vi.fn(() => ({})),
    buildCostAlertMessage: vi.fn(() => ({})),
    buildDailyLeaderboardMessage: vi.fn(() => ({})),
    sendWebhookMessage: mockSendWebhookMessage,
  }));

  vi.doMock("@/lib/utils/timezone-resolver", () => ({
    resolveSystemTimezone: vi.fn(async () => "UTC"),
  }));

  vi.doMock("@/lib/logger", () => ({
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    },
  }));

  mockSendWebhookMessage.mockResolvedValue({ success: true });
  mockGenerateDailyLeaderboard.mockResolvedValue({ date: "2026-06-02", entries: [] });
  mockGenerateCostAlerts.mockResolvedValue([{ providerName: "p" }]);
  mockGetEnabledBindingsByType.mockResolvedValue([]);
  queueGetRepeatableJobs.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

/** 初始化队列并返回捕获的 process 处理器 */
async function loadProcessor() {
  const mod = await import("@/lib/notification/notification-queue");
  // addNotificationJob 内部触发 getNotificationQueue()，注册并捕获 process 处理器
  await mod.addNotificationJob("daily-leaderboard", "https://example.com/hook", {
    date: "2026-06-02",
    entries: [],
  } as never);
  if (!capturedQueue?.processHandler) {
    throw new Error("process handler not captured");
  }
  return capturedQueue.processHandler;
}

function makeJob(data: Record<string, unknown>): MockJob {
  return { id: "job-1", timestamp: 1000, data, update: vi.fn(async () => {}) };
}

describe("notification queue processor - daily-leaderboard", () => {
  it("skips sending when the master switch is off (issue #1236)", async () => {
    mockGetNotificationSettings.mockResolvedValue(
      makeSettings({ enabled: false, dailyLeaderboardEnabled: true })
    );

    const handler = await loadProcessor();
    const result = await handler(
      makeJob({ type: "daily-leaderboard", webhookUrl: "https://example.com/hook" })
    );

    expect(result).toEqual({ success: true, skipped: true });
    expect(mockGenerateDailyLeaderboard).not.toHaveBeenCalled();
    expect(mockSendWebhookMessage).not.toHaveBeenCalled();
  });

  it("skips sending when the daily-leaderboard sub-switch is off", async () => {
    mockGetNotificationSettings.mockResolvedValue(
      makeSettings({ enabled: true, dailyLeaderboardEnabled: false })
    );

    const handler = await loadProcessor();
    const result = await handler(
      makeJob({ type: "daily-leaderboard", webhookUrl: "https://example.com/hook" })
    );

    expect(result).toEqual({ success: true, skipped: true });
    expect(mockSendWebhookMessage).not.toHaveBeenCalled();
  });

  it("sends when both master and sub-switch are enabled", async () => {
    mockGetNotificationSettings.mockResolvedValue(
      makeSettings({ enabled: true, dailyLeaderboardEnabled: true })
    );

    const handler = await loadProcessor();
    const result = await handler(
      makeJob({ type: "daily-leaderboard", webhookUrl: "https://example.com/hook" })
    );

    expect(result).toEqual({ success: true });
    expect(mockGenerateDailyLeaderboard).toHaveBeenCalledTimes(1);
    expect(mockSendWebhookMessage).toHaveBeenCalledTimes(1);
  });
});

describe("notification queue processor - cost-alert", () => {
  it("skips sending when the master switch is off", async () => {
    mockGetNotificationSettings.mockResolvedValue(
      makeSettings({ enabled: false, costAlertEnabled: true })
    );

    const handler = await loadProcessor();
    const result = await handler(
      makeJob({ type: "cost-alert", webhookUrl: "https://example.com/hook" })
    );

    expect(result).toEqual({ success: true, skipped: true });
    expect(mockGenerateCostAlerts).not.toHaveBeenCalled();
    expect(mockSendWebhookMessage).not.toHaveBeenCalled();
  });

  it("skips sending when the cost-alert sub-switch is off", async () => {
    mockGetNotificationSettings.mockResolvedValue(
      makeSettings({ enabled: true, costAlertEnabled: false })
    );

    const handler = await loadProcessor();
    const result = await handler(
      makeJob({ type: "cost-alert", webhookUrl: "https://example.com/hook" })
    );

    expect(result).toEqual({ success: true, skipped: true });
    expect(mockSendWebhookMessage).not.toHaveBeenCalled();
  });

  it("sends when both master and sub-switch are enabled", async () => {
    mockGetNotificationSettings.mockResolvedValue(
      makeSettings({ enabled: true, costAlertEnabled: true })
    );

    const handler = await loadProcessor();
    const result = await handler(
      makeJob({ type: "cost-alert", webhookUrl: "https://example.com/hook" })
    );

    expect(result).toEqual({ success: true });
    expect(mockGenerateCostAlerts).toHaveBeenCalledTimes(1);
    expect(mockSendWebhookMessage).toHaveBeenCalledTimes(1);
  });
});

describe("notification queue processor - circuit-breaker", () => {
  const data = {
    providerName: "OpenAI",
    providerId: 1,
    failureCount: 5,
    retryAt: "2026-06-02T12:30:00Z",
  };

  it("skips sending when the master switch is off", async () => {
    mockGetNotificationSettings.mockResolvedValue(
      makeSettings({ enabled: false, circuitBreakerEnabled: true })
    );

    const handler = await loadProcessor();
    const result = await handler(
      makeJob({ type: "circuit-breaker", webhookUrl: "https://example.com/hook", data })
    );

    expect(result).toEqual({ success: true, skipped: true });
    expect(mockSendWebhookMessage).not.toHaveBeenCalled();
  });

  it("skips sending when the circuit-breaker sub-switch is off", async () => {
    mockGetNotificationSettings.mockResolvedValue(
      makeSettings({ enabled: true, circuitBreakerEnabled: false })
    );

    const handler = await loadProcessor();
    const result = await handler(
      makeJob({ type: "circuit-breaker", webhookUrl: "https://example.com/hook", data })
    );

    expect(result).toEqual({ success: true, skipped: true });
    expect(mockSendWebhookMessage).not.toHaveBeenCalled();
  });

  it("sends when both master and sub-switch are enabled", async () => {
    mockGetNotificationSettings.mockResolvedValue(
      makeSettings({ enabled: true, circuitBreakerEnabled: true })
    );

    const handler = await loadProcessor();
    const result = await handler(
      makeJob({ type: "circuit-breaker", webhookUrl: "https://example.com/hook", data })
    );

    expect(result).toEqual({ success: true });
    expect(mockSendWebhookMessage).toHaveBeenCalledTimes(1);
  });
});

describe("scheduleNotifications", () => {
  it("removes all repeatable jobs when the master switch is off", async () => {
    mockGetNotificationSettings.mockResolvedValue(makeSettings({ enabled: false }));
    queueGetRepeatableJobs.mockResolvedValue([{ key: "k1" }, { key: "k2" }]);

    const { scheduleNotifications } = await import("@/lib/notification/notification-queue");
    await scheduleNotifications();

    expect(queueRemoveRepeatableByKey).toHaveBeenCalledWith("k1");
    expect(queueRemoveRepeatableByKey).toHaveBeenCalledWith("k2");
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("attempts to remove every repeatable job even when one removal fails (master off)", async () => {
    mockGetNotificationSettings.mockResolvedValue(makeSettings({ enabled: false }));
    queueGetRepeatableJobs.mockResolvedValue([{ key: "k1" }, { key: "k2" }]);
    queueRemoveRepeatableByKey.mockRejectedValueOnce(new Error("redis down"));

    const { scheduleNotifications } = await import("@/lib/notification/notification-queue");
    await expect(scheduleNotifications()).resolves.toBeUndefined();

    expect(queueRemoveRepeatableByKey).toHaveBeenCalledTimes(2);
  });

  it("aborts adding new jobs when an old repeatable cannot be removed (avoids double-firing)", async () => {
    mockGetNotificationSettings.mockResolvedValue(
      makeSettings({
        enabled: true,
        useLegacyMode: true,
        costAlertEnabled: true,
        costAlertWebhook: "https://example.com/hook",
      })
    );
    queueGetRepeatableJobs.mockResolvedValue([{ key: "stale" }]);
    queueRemoveRepeatableByKey.mockRejectedValueOnce(new Error("redis down"));

    const { scheduleNotifications } = await import("@/lib/notification/notification-queue");
    await scheduleNotifications();

    // 旧任务未能移除时不得新增任务，否则新旧任务会同时触发
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("uses {every} for an interval that does not divide 60 (legacy)", async () => {
    mockGetNotificationSettings.mockResolvedValue(
      makeSettings({
        enabled: true,
        useLegacyMode: true,
        costAlertEnabled: true,
        costAlertWebhook: "https://example.com/hook",
        costAlertCheckInterval: 45,
      })
    );

    const { scheduleNotifications } = await import("@/lib/notification/notification-queue");
    await scheduleNotifications();

    const costCall = queueAdd.mock.calls.find(
      (c) => (c[0] as { type?: string })?.type === "cost-alert"
    );
    expect((costCall?.[1] as { repeat?: unknown })?.repeat).toEqual({ every: 45 * 60 * 1000 });
  });

  it("schedules targets-mode cost-alert with binding jobId and tz (cron path)", async () => {
    mockGetNotificationSettings.mockResolvedValue(
      makeSettings({
        enabled: true,
        useLegacyMode: false,
        costAlertEnabled: true,
        costAlertCheckInterval: 30,
      })
    );
    mockGetEnabledBindingsByType.mockImplementation(async (type: string) =>
      type === "cost_alert"
        ? [{ id: 7, targetId: 3, scheduleCron: null, scheduleTimezone: "Asia/Tokyo" }]
        : []
    );

    const { scheduleNotifications } = await import("@/lib/notification/notification-queue");
    await scheduleNotifications();

    const costCall = queueAdd.mock.calls.find(
      (c) => (c[0] as { type?: string })?.type === "cost-alert"
    );
    expect(costCall?.[0]).toMatchObject({ type: "cost-alert", targetId: 3, bindingId: 7 });
    expect(costCall?.[1]).toMatchObject({
      repeat: { cron: "*/30 * * * *", tz: "Asia/Tokyo" },
      jobId: "cost-alert:7",
    });
  });

  it("schedules targets-mode cost-alert with {every} for interval >= 60 (drops tz)", async () => {
    mockGetNotificationSettings.mockResolvedValue(
      makeSettings({
        enabled: true,
        useLegacyMode: false,
        costAlertEnabled: true,
        costAlertCheckInterval: 120,
      })
    );
    mockGetEnabledBindingsByType.mockImplementation(async (type: string) =>
      type === "cost_alert"
        ? [{ id: 9, targetId: 4, scheduleCron: null, scheduleTimezone: "Asia/Tokyo" }]
        : []
    );

    const { scheduleNotifications } = await import("@/lib/notification/notification-queue");
    await scheduleNotifications();

    const costCall = queueAdd.mock.calls.find(
      (c) => (c[0] as { type?: string })?.type === "cost-alert"
    );
    expect((costCall?.[1] as { repeat?: unknown })?.repeat).toEqual({ every: 120 * 60 * 1000 });
  });

  it("uses {every} instead of */60 cron for cost-alert interval >= 60 (legacy)", async () => {
    mockGetNotificationSettings.mockResolvedValue(
      makeSettings({
        enabled: true,
        useLegacyMode: true,
        costAlertEnabled: true,
        costAlertWebhook: "https://example.com/hook",
        costAlertCheckInterval: 60,
      })
    );

    const { scheduleNotifications } = await import("@/lib/notification/notification-queue");
    await scheduleNotifications();

    const costCall = queueAdd.mock.calls.find(
      (c) => (c[0] as { type?: string })?.type === "cost-alert"
    );
    expect((costCall?.[1] as { repeat?: unknown })?.repeat).toEqual({ every: 60 * 60 * 1000 });
  });

  it("uses a step cron for cost-alert interval < 60 (legacy)", async () => {
    mockGetNotificationSettings.mockResolvedValue(
      makeSettings({
        enabled: true,
        useLegacyMode: true,
        costAlertEnabled: true,
        costAlertWebhook: "https://example.com/hook",
        costAlertCheckInterval: 30,
      })
    );

    const { scheduleNotifications } = await import("@/lib/notification/notification-queue");
    await scheduleNotifications();

    const costCall = queueAdd.mock.calls.find(
      (c) => (c[0] as { type?: string })?.type === "cost-alert"
    );
    expect((costCall?.[1] as { repeat?: unknown })?.repeat).toEqual({ cron: "*/30 * * * *" });
  });
});
