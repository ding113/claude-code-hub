import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const queue = {
    add: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    getRepeatableJobs: vi.fn(async () => []),
    on: vi.fn(),
    process: vi.fn(),
    removeRepeatableByKey: vi.fn(async () => undefined),
  };
  const Queue = vi.fn(function MockQueue() {
    return queue;
  });

  return {
    Queue,
    getSystemSettings: vi.fn(),
    queue,
  };
});

vi.mock("bull", () => ({ default: mocks.Queue }));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/redis/bull-queue-options", () => ({
  buildRedisQueueOptions: vi.fn(() => ({})),
}));
vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mocks.getSystemSettings,
}));
vi.mock("@/lib/log-cleanup/service", () => ({
  cleanupLogs: vi.fn(),
}));

describe("log cleanup queue", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.REDIS_URL = "redis://localhost:6379";
    mocks.getSystemSettings.mockResolvedValue({
      enableAutoCleanup: true,
      cleanupRetentionDays: 30,
      cleanupBatchSize: 1000,
      cleanupSchedule: "0 2 * * *",
    });
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it("registers and enqueues the scheduled task with the same Bull job name", async () => {
    const { scheduleAutoCleanup } = await import("@/lib/log-cleanup/cleanup-queue");

    await scheduleAutoCleanup();

    expect(mocks.queue.process).toHaveBeenCalledWith("auto-cleanup", expect.any(Function));
    expect(mocks.queue.add).toHaveBeenCalledWith(
      "auto-cleanup",
      expect.objectContaining({ retentionDays: 30, batchSize: 1000 }),
      expect.objectContaining({ repeat: { cron: "0 2 * * *" } })
    );
  });
});
