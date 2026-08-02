import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  processHandler: null as null | ((job: any) => Promise<unknown>),
  failedHandler: null as null | ((job: any, error: Error) => Promise<void>),
  processName: null as string | null,
  queueOptions: null as any,
  add: vi.fn(),
  getJob: vi.fn(),
  close: vi.fn(),
  claim: vi.fn(),
  getStatus: vi.fn(),
  setStatus: vi.fn(),
  deleteStatus: vi.fn(),
  release: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("bull", () => ({
  default: class MockQueue {
    constructor(_name: string, options: unknown) {
      boundary.queueOptions = options;
    }
    process(name: string, handler: (job: any) => Promise<unknown>) {
      boundary.processName = name;
      boundary.processHandler = handler;
    }
    on(event: string, handler: (job: any, error: Error) => Promise<void>) {
      if (event === "failed") boundary.failedHandler = handler;
    }
    add = boundary.add;
    getJob = boundary.getJob;
    close = boundary.close;
  },
}));
vi.mock("@/lib/redis/bull-queue-options", () => ({
  buildRedisQueueOptions: () => ({ host: "redis" }),
}));
vi.mock("@/lib/user-statistics-reset/reset-status-store", () => ({
  claimActiveUserStatisticsReset: boundary.claim,
  getUserStatisticsResetStatus: boundary.getStatus,
  setUserStatisticsResetStatus: boundary.setStatus,
  deleteUserStatisticsResetStatus: boundary.deleteStatus,
  releaseActiveUserStatisticsReset: boundary.release,
}));
vi.mock("@/lib/user-statistics-reset/reset-service", () => ({
  executeUserStatisticsReset: boundary.execute,
  UserStatisticsResetError: class UserStatisticsResetError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
}));

import {
  enqueueUserStatisticsReset,
  startUserStatisticsResetQueue,
  stopUserStatisticsResetQueue,
} from "@/lib/user-statistics-reset/reset-queue";

const existing = {
  resetId: "00000000-0000-4000-8000-000000000002",
  userId: 42,
  status: "running" as const,
  requestedAt: "2026-08-02T12:00:00.000Z",
  startedAt: "2026-08-02T12:00:01.000Z",
  completedAt: null,
  deletedMessageRequests: 1000,
  deletedUsageLedger: 0,
  errorCode: null,
};

describe("user statistics reset queue", () => {
  beforeEach(async () => {
    await stopUserStatisticsResetQueue();
    process.env.REDIS_URL = "redis://localhost:6379";
    boundary.processHandler = null;
    boundary.failedHandler = null;
    boundary.processName = null;
    boundary.queueOptions = null;
    for (const mock of [
      boundary.add,
      boundary.getJob,
      boundary.close,
      boundary.claim,
      boundary.getStatus,
      boundary.setStatus,
      boundary.deleteStatus,
      boundary.release,
      boundary.execute,
    ])
      mock.mockReset();
    boundary.add.mockResolvedValue({ id: "job" });
    boundary.getJob.mockResolvedValue({
      id: "job",
      getState: vi.fn().mockResolvedValue("waiting"),
    });
    boundary.setStatus.mockResolvedValue(undefined);
    boundary.deleteStatus.mockResolvedValue(undefined);
    boundary.release.mockResolvedValue(undefined);
  });

  it("returns the existing active reset instead of enqueueing a competitor", async () => {
    boundary.claim.mockResolvedValue({ acquired: false, resetId: existing.resetId });
    boundary.getStatus.mockResolvedValue(existing);

    await expect(enqueueUserStatisticsReset(42)).resolves.toEqual(existing);
    expect(boundary.deleteStatus).toHaveBeenCalledTimes(1);
    expect(boundary.add).not.toHaveBeenCalled();
  });

  it("configures five attempts with exponential 30 second backoff", async () => {
    boundary.claim.mockImplementation(async (_userId: number, resetId: string) => ({
      acquired: true,
      resetId,
    }));

    const queued = await enqueueUserStatisticsReset(42);

    expect(queued.status).toBe("queued");
    expect(boundary.queueOptions.defaultJobOptions).toMatchObject({
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000 },
    });
    expect(boundary.processName).toBe("reset");
    expect(boundary.add).toHaveBeenCalledWith(
      "reset",
      expect.objectContaining({ userId: 42, resetId: queued.resetId }),
      { jobId: queued.resetId }
    );
  });

  it("recreates a missing Bull job for an existing queued claim", async () => {
    const queued = { ...existing, status: "queued" as const, startedAt: null };
    boundary.claim.mockResolvedValue({ acquired: false, resetId: queued.resetId });
    boundary.getStatus.mockResolvedValue(queued);
    boundary.getJob.mockResolvedValue(null);

    await expect(enqueueUserStatisticsReset(42)).resolves.toEqual(queued);

    expect(boundary.add).toHaveBeenCalledWith(
      "reset",
      {
        resetId: queued.resetId,
        userId: queued.userId,
        requestedAt: queued.requestedAt,
      },
      { jobId: queued.resetId }
    );
  });

  it("releases a stale terminal claim and creates a new reset", async () => {
    boundary.claim
      .mockResolvedValueOnce({ acquired: false, resetId: existing.resetId })
      .mockImplementationOnce(async (_userId: number, resetId: string) => ({
        acquired: true,
        resetId,
      }));
    boundary.getStatus.mockResolvedValue({ ...existing, status: "completed" });

    const queued = await enqueueUserStatisticsReset(42);

    expect(queued.status).toBe("queued");
    expect(queued.resetId).not.toBe(existing.resetId);
    expect(boundary.release).toHaveBeenCalledWith(42, existing.resetId);
    expect(boundary.add).toHaveBeenCalledWith(
      "reset",
      expect.objectContaining({ resetId: queued.resetId }),
      { jobId: queued.resetId }
    );
  });

  it("releases a claim whose retained Bull job is already terminal", async () => {
    boundary.claim
      .mockResolvedValueOnce({ acquired: false, resetId: existing.resetId })
      .mockImplementationOnce(async (_userId: number, resetId: string) => ({
        acquired: true,
        resetId,
      }));
    boundary.getStatus.mockResolvedValue({ ...existing, status: "running" });
    boundary.getJob.mockResolvedValue({
      id: existing.resetId,
      getState: vi.fn().mockResolvedValue("failed"),
    });

    const queued = await enqueueUserStatisticsReset(42);

    expect(queued.resetId).not.toBe(existing.resetId);
    expect(boundary.release).toHaveBeenCalledWith(42, existing.resetId);
  });

  it("does not fail application startup when Redis is not configured", async () => {
    await stopUserStatisticsResetQueue();
    delete process.env.REDIS_URL;

    expect(startUserStatisticsResetQueue()).toBe(false);
    expect(boundary.processHandler).toBeNull();
  });

  it("moves a Bull job through running to completed and releases the active claim", async () => {
    boundary.claim.mockImplementation(async (_userId: number, resetId: string) => ({
      acquired: true,
      resetId,
    }));
    const queued = await enqueueUserStatisticsReset(42);
    boundary.getStatus.mockResolvedValue(queued);
    boundary.execute.mockResolvedValue({
      deletedMessageRequests: 2000,
      deletedUsageLedger: 1500,
    });

    await boundary.processHandler?.({
      data: queued,
      attemptsMade: 0,
      opts: { attempts: 5 },
    });

    expect(boundary.setStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "completed",
        deletedMessageRequests: 2000,
        deletedUsageLedger: 1500,
      })
    );
    expect(boundary.release).toHaveBeenCalledWith(42, queued.resetId);
  });

  it("keeps retryable failures active and records a stable final error", async () => {
    boundary.claim.mockImplementation(async (_userId: number, resetId: string) => ({
      acquired: true,
      resetId,
    }));
    const queued = await enqueueUserStatisticsReset(42);
    boundary.getStatus.mockResolvedValue(queued);
    boundary.execute.mockRejectedValue(new Error("database timeout"));

    await expect(
      boundary.processHandler?.({ data: queued, attemptsMade: 0, opts: { attempts: 5 } })
    ).rejects.toThrow("database timeout");
    expect(boundary.setStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "queued", errorCode: null })
    );
    expect(boundary.release).not.toHaveBeenCalled();

    boundary.setStatus.mockClear();
    await expect(
      boundary.processHandler?.({ data: queued, attemptsMade: 4, opts: { attempts: 5 } })
    ).rejects.toThrow("database timeout");
    expect(boundary.setStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "failed",
        errorCode: "USER_STATISTICS_RESET_OPERATION_FAILED",
      })
    );
    expect(boundary.release).toHaveBeenCalledWith(42, queued.resetId);
  });

  it("marks max-stalled jobs failed even when attemptsMade did not advance", async () => {
    startUserStatisticsResetQueue();
    boundary.getStatus.mockResolvedValue(existing);

    await boundary.failedHandler?.(
      {
        data: existing,
        attemptsMade: 0,
        opts: { attempts: 5 },
      },
      new Error("job stalled more than allowable limit")
    );

    expect(boundary.setStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "failed",
        errorCode: "USER_STATISTICS_RESET_OPERATION_FAILED",
      })
    );
    expect(boundary.release).toHaveBeenCalledWith(42, existing.resetId);
  });
});
