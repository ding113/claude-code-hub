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
  prepareFixed5h: vi.fn(),
  findKeyIds: vi.fn(),
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
vi.mock("@/lib/redis/cost-cache-cleanup", () => ({
  prepareUserStatisticsResetFixed5h: boundary.prepareFixed5h,
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
  findUserStatisticsResetKeyIds: boundary.findKeyIds,
  UserStatisticsResetError: class UserStatisticsResetError extends Error {
    constructor(
      readonly code: string,
      readonly progress = { deletedMessageRequests: 0, deletedUsageLedger: 0 }
    ) {
      super(code);
    }
  },
}));

import {
  enqueueUserStatisticsReset,
  startUserStatisticsResetQueue,
  stopUserStatisticsResetQueue,
} from "@/lib/user-statistics-reset/reset-queue";
import { UserStatisticsResetError } from "@/lib/user-statistics-reset/reset-service";

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
  fixed5hKeyIds: [9],
  fixed5hPreparationVersion: 1 as const,
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
      boundary.prepareFixed5h,
      boundary.findKeyIds,
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
    boundary.prepareFixed5h.mockResolvedValue("2026-08-02T12:00:00.000Z");
    boundary.findKeyIds.mockResolvedValue([9]);
  });

  it("returns the existing active reset instead of enqueueing a competitor", async () => {
    boundary.claim.mockResolvedValue({ acquired: false, resetId: existing.resetId });
    boundary.getStatus.mockResolvedValue(existing);

    await expect(enqueueUserStatisticsReset(42)).resolves.toEqual(
      expect.not.objectContaining({ fixed5hKeyIds: expect.anything() })
    );
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

    await expect(enqueueUserStatisticsReset(42)).resolves.toEqual(
      expect.not.objectContaining({ fixed5hKeyIds: expect.anything() })
    );

    expect(boundary.add).toHaveBeenCalledWith(
      "reset",
      {
        resetId: queued.resetId,
        userId: queued.userId,
        requestedAt: "2026-08-02T12:00:00.000Z",
        fixed5hKeyIds: queued.fixed5hKeyIds,
        fixed5hPreparationVersion: 1,
      },
      { jobId: queued.resetId }
    );
  });

  it("reconciles legacy queued records with current child key ids", async () => {
    const {
      fixed5hKeyIds: _fixed5hKeyIds,
      fixed5hPreparationVersion: _fixed5hPreparationVersion,
      ...legacyQueued
    } = {
      ...existing,
      status: "queued" as const,
      startedAt: null,
    };
    boundary.claim.mockResolvedValue({ acquired: false, resetId: legacyQueued.resetId });
    boundary.getStatus.mockResolvedValue(legacyQueued);
    boundary.getJob.mockResolvedValue(null);

    await expect(enqueueUserStatisticsReset(42)).resolves.toMatchObject({
      resetId: legacyQueued.resetId,
      requestedAt: "2026-08-02T12:00:00.000Z",
    });

    expect(boundary.prepareFixed5h).toHaveBeenCalledWith({
      resetId: legacyQueued.resetId,
      userId: 42,
      keyIds: [9],
    });
    expect(boundary.add).toHaveBeenCalledWith(
      "reset",
      expect.objectContaining({ fixed5hKeyIds: [9], fixed5hPreparationVersion: 1 }),
      { jobId: legacyQueued.resetId }
    );
  });

  it("keeps a prepared claim recoverable when Bull enqueue fails", async () => {
    let activeResetId = "";
    const storedRecords = new Map<string, any>();
    boundary.claim.mockImplementation(async (_userId: number, resetId: string) => {
      if (!activeResetId) {
        activeResetId = resetId;
        return { acquired: true, resetId };
      }
      return { acquired: false, resetId: activeResetId };
    });
    boundary.setStatus.mockImplementation(async (record) => {
      storedRecords.set(record.resetId, record);
    });
    boundary.getStatus.mockImplementation(async (resetId: string) => storedRecords.get(resetId));
    boundary.getJob.mockResolvedValue(null);
    boundary.add.mockRejectedValueOnce(new Error("redis timeout")).mockResolvedValueOnce({
      id: "recovered-job",
    });

    await expect(enqueueUserStatisticsReset(42, { fixed5hKeyIds: [9] })).rejects.toThrow(
      "redis timeout"
    );

    expect(storedRecords.get(activeResetId)).toMatchObject({
      resetId: activeResetId,
      status: "queued",
      requestedAt: "2026-08-02T12:00:00.000Z",
      fixed5hKeyIds: [9],
      fixed5hPreparationVersion: 1,
    });
    expect(boundary.release).not.toHaveBeenCalled();

    await expect(enqueueUserStatisticsReset(42)).resolves.toMatchObject({
      resetId: activeResetId,
      requestedAt: "2026-08-02T12:00:00.000Z",
    });

    expect(boundary.prepareFixed5h).toHaveBeenCalledTimes(1);
    expect(boundary.add).toHaveBeenLastCalledWith(
      "reset",
      expect.objectContaining({
        resetId: activeResetId,
        fixed5hKeyIds: [9],
        fixed5hPreparationVersion: 1,
      }),
      { jobId: activeResetId }
    );
  });

  it("accepts an ambiguous enqueue when the deterministic Bull job exists", async () => {
    boundary.claim.mockImplementation(async (_userId: number, resetId: string) => ({
      acquired: true,
      resetId,
    }));
    boundary.add.mockRejectedValueOnce(new Error("connection closed"));
    boundary.getJob.mockResolvedValueOnce({ id: "persisted-job" });

    await expect(enqueueUserStatisticsReset(42, { fixed5hKeyIds: [9] })).resolves.toMatchObject({
      status: "queued",
      requestedAt: "2026-08-02T12:00:00.000Z",
    });

    expect(boundary.release).not.toHaveBeenCalled();
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
    expect(boundary.prepareFixed5h).toHaveBeenCalledWith({
      resetId: queued.resetId,
      userId: 42,
      keyIds: [],
    });
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

  it("prepares a legacy Bull job before deleting statistics", async () => {
    startUserStatisticsResetQueue();
    const {
      fixed5hKeyIds: _fixed5hKeyIds,
      fixed5hPreparationVersion: _fixed5hPreparationVersion,
      ...legacyJobData
    } = existing;
    const legacyStatus = { ...legacyJobData, status: "queued" as const, startedAt: null };
    boundary.getStatus.mockResolvedValue(legacyStatus);
    boundary.findKeyIds.mockResolvedValue([9, 10]);
    boundary.execute.mockResolvedValue({
      deletedMessageRequests: 2,
      deletedUsageLedger: 3,
    });

    await boundary.processHandler?.({
      data: legacyJobData,
      attemptsMade: 0,
      opts: { attempts: 5 },
    });

    expect(boundary.findKeyIds).toHaveBeenCalledWith(42);
    expect(boundary.prepareFixed5h).toHaveBeenCalledWith({
      resetId: existing.resetId,
      userId: 42,
      keyIds: [9, 10],
    });
    expect(boundary.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedAt: "2026-08-02T12:00:00.000Z",
        fixed5hKeyIds: [9, 10],
        fixed5hPreparationVersion: 1,
      }),
      expect.any(Function)
    );
  });

  it("persists per-batch progress and does not regress completed state when claim release fails", async () => {
    boundary.claim.mockImplementation(async (_userId: number, resetId: string) => ({
      acquired: true,
      resetId,
    }));
    const queued = await enqueueUserStatisticsReset(42);
    boundary.getStatus.mockResolvedValue({ ...queued, fixed5hKeyIds: [] });
    boundary.execute.mockImplementation(async (_data, onProgress) => {
      await onProgress({ deletedMessageRequests: 1000, deletedUsageLedger: 0 });
      return { deletedMessageRequests: 1000, deletedUsageLedger: 5 };
    });
    boundary.release.mockRejectedValueOnce(new Error("redis unavailable"));

    await expect(
      boundary.processHandler?.({ data: queued, attemptsMade: 0, opts: { attempts: 5 } })
    ).resolves.toEqual(expect.objectContaining({ status: "completed" }));

    expect(boundary.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "running", deletedMessageRequests: 1000 })
    );
    expect(boundary.setStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "completed",
        deletedMessageRequests: 1000,
        deletedUsageLedger: 5,
      })
    );
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

  it("preserves the final business error when active claim release fails", async () => {
    boundary.claim.mockImplementation(async (_userId: number, resetId: string) => ({
      acquired: true,
      resetId,
    }));
    const queued = await enqueueUserStatisticsReset(42);
    boundary.getStatus.mockResolvedValue({
      ...queued,
      fixed5hKeyIds: [],
      fixed5hPreparationVersion: 1,
    });
    const resetError = new UserStatisticsResetError("USER_STATISTICS_RESET_CACHE_CLEANUP_FAILED", {
      deletedMessageRequests: 5,
      deletedUsageLedger: 7,
    });
    boundary.execute.mockRejectedValue(resetError);
    boundary.release.mockRejectedValueOnce(new Error("redis unavailable"));

    await expect(
      boundary.processHandler?.({ data: queued, attemptsMade: 4, opts: { attempts: 5 } })
    ).rejects.toBe(resetError);

    expect(boundary.setStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "failed",
        errorCode: "USER_STATISTICS_RESET_CACHE_CLEANUP_FAILED",
      })
    );
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

  it("keeps failed terminal status when releasing the active claim fails", async () => {
    startUserStatisticsResetQueue();
    boundary.getStatus.mockResolvedValue(existing);
    boundary.release.mockRejectedValueOnce(new Error("redis unavailable"));

    await expect(
      boundary.failedHandler?.(
        { data: existing, attemptsMade: 5, opts: { attempts: 5 } },
        new Error("database timeout")
      )
    ).resolves.toBeUndefined();

    expect(boundary.setStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "failed",
        errorCode: "USER_STATISTICS_RESET_OPERATION_FAILED",
      })
    );
  });
});
