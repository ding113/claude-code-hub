import "server-only";

import { randomUUID } from "node:crypto";
import type { Job } from "bull";
import Queue from "bull";
import { logger } from "@/lib/logger";
import { buildRedisQueueOptions } from "@/lib/redis/bull-queue-options";
import { prepareUserStatisticsResetFixed5h } from "@/lib/redis/cost-cache-cleanup";
import {
  executeUserStatisticsReset,
  findUserStatisticsResetKeyIds,
  UserStatisticsResetError,
} from "./reset-service";
import {
  claimActiveUserStatisticsReset,
  deleteUserStatisticsResetStatus,
  getUserStatisticsResetStatus,
  releaseActiveUserStatisticsReset,
  setUserStatisticsResetStatus,
} from "./reset-status-store";
import type {
  UserStatisticsResetJobData,
  UserStatisticsResetRecord,
  UserStatisticsResetStoredRecord,
} from "./types";

let resetQueue: Queue.Queue<UserStatisticsResetJobData> | null = null;
const RESET_JOB_NAME = "reset";
const STALLED_FAILURE_REASON = "job stalled more than allowable limit";

function errorCode(error: unknown): string {
  return error instanceof UserStatisticsResetError
    ? error.code
    : "USER_STATISTICS_RESET_OPERATION_FAILED";
}

function createQueuedRecord(input: UserStatisticsResetJobData): UserStatisticsResetStoredRecord {
  return {
    ...input,
    fixed5hKeyIds: input.fixed5hKeyIds ?? [],
    fixed5hPreparationVersion: input.fixed5hPreparationVersion ?? null,
    status: "queued",
    startedAt: null,
    completedAt: null,
    deletedMessageRequests: 0,
    deletedUsageLedger: 0,
    errorCode: null,
  };
}

function toPublicRecord(record: UserStatisticsResetStoredRecord): UserStatisticsResetRecord {
  const {
    fixed5hKeyIds: _fixed5hKeyIds,
    fixed5hPreparationVersion: _fixed5hPreparationVersion,
    ...publicRecord
  } = record;
  return publicRecord;
}

type PreparedResetJobData = UserStatisticsResetJobData & {
  fixed5hKeyIds: number[];
  fixed5hPreparationVersion: 1;
};

async function ensurePreparedReset(
  jobData: UserStatisticsResetJobData,
  current: UserStatisticsResetStoredRecord
): Promise<{ jobData: PreparedResetJobData; record: UserStatisticsResetStoredRecord }> {
  if (current.fixed5hPreparationVersion === 1) {
    return {
      jobData: {
        resetId: current.resetId,
        userId: current.userId,
        requestedAt: current.requestedAt,
        fixed5hKeyIds: current.fixed5hKeyIds,
        fixed5hPreparationVersion: 1,
      },
      record: current,
    };
  }

  if (jobData.fixed5hPreparationVersion === 1) {
    const preparedRecord: UserStatisticsResetStoredRecord = {
      ...current,
      requestedAt: jobData.requestedAt,
      fixed5hKeyIds: jobData.fixed5hKeyIds ?? [],
      fixed5hPreparationVersion: 1,
    };
    await setUserStatisticsResetStatus(preparedRecord);
    return {
      jobData: {
        resetId: jobData.resetId,
        userId: jobData.userId,
        requestedAt: jobData.requestedAt,
        fixed5hKeyIds: preparedRecord.fixed5hKeyIds,
        fixed5hPreparationVersion: 1,
      },
      record: preparedRecord,
    };
  }

  const fixed5hKeyIds = await findUserStatisticsResetKeyIds(jobData.userId);
  const requestedAt = await prepareUserStatisticsResetFixed5h({
    resetId: jobData.resetId,
    userId: jobData.userId,
    keyIds: fixed5hKeyIds,
  });
  if (!requestedAt) throw new Error("USER_STATISTICS_RESET_FIXED_5H_PREPARE_FAILED");

  const preparedJobData: PreparedResetJobData = {
    ...jobData,
    requestedAt,
    fixed5hKeyIds,
    fixed5hPreparationVersion: 1,
  };
  const preparedRecord: UserStatisticsResetStoredRecord = {
    ...current,
    ...preparedJobData,
  };
  await setUserStatisticsResetStatus(preparedRecord);
  return { jobData: preparedJobData, record: preparedRecord };
}

function getResetQueue(): Queue.Queue<UserStatisticsResetJobData> {
  if (resetQueue) return resetQueue;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL environment variable is required for user statistics reset queue");
  }

  resetQueue = new Queue<UserStatisticsResetJobData>("user-statistics-reset", {
    redis: buildRedisQueueOptions(redisUrl, "[UserStatisticsResetQueue]"),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  });
  resetQueue.process(RESET_JOB_NAME, processUserStatisticsReset);
  resetQueue.on("failed", async (job, error) => {
    if (!job?.data?.resetId || !Number.isInteger(job.data.userId)) {
      logger.error("[UserStatisticsResetQueue] job failed without recoverable data", {
        error: error.message,
      });
      return;
    }
    logger.error("[UserStatisticsResetQueue] job failed", {
      resetId: job.data.resetId,
      userId: job.data.userId,
      attemptsMade: job.attemptsMade,
      error: error.message,
    });
    const attempts = job.opts?.attempts ?? 1;
    const isTerminal =
      (job.attemptsMade ?? 0) >= attempts || error.message === STALLED_FAILURE_REASON;
    if (isTerminal) {
      try {
        await recordFinalFailure(job.data, error);
      } catch (statusError) {
        logger.error("[UserStatisticsResetQueue] failed to persist terminal status", {
          resetId: job.data.resetId,
          userId: job.data.userId,
          error: statusError instanceof Error ? statusError.message : String(statusError),
        });
      }
    }
  });
  return resetQueue;
}

async function recordFinalFailure(
  jobData: UserStatisticsResetJobData,
  error: unknown
): Promise<void> {
  const current =
    (await getUserStatisticsResetStatus(jobData.resetId)) ?? createQueuedRecord(jobData);
  await setUserStatisticsResetStatus({
    ...current,
    status: "failed",
    completedAt: new Date().toISOString(),
    errorCode:
      current.status === "failed" && current.errorCode ? current.errorCode : errorCode(error),
  });
  try {
    await releaseActiveUserStatisticsReset(jobData.userId, jobData.resetId);
  } catch (releaseError) {
    logger.warn("[UserStatisticsResetQueue] failed reset retained an active claim", {
      resetId: jobData.resetId,
      userId: jobData.userId,
      error: releaseError instanceof Error ? releaseError.message : String(releaseError),
    });
  }
}

async function processUserStatisticsReset(job: Job<UserStatisticsResetJobData>) {
  let current =
    (await getUserStatisticsResetStatus(job.data.resetId)) ?? createQueuedRecord(job.data);
  const startedAt = current.startedAt ?? new Date().toISOString();
  let baseProgress = {
    deletedMessageRequests: current.deletedMessageRequests,
    deletedUsageLedger: current.deletedUsageLedger,
  };
  let attemptProgress = { deletedMessageRequests: 0, deletedUsageLedger: 0 };
  let preparedJobData: PreparedResetJobData | null = null;

  try {
    const prepared = await ensurePreparedReset(job.data, current);
    preparedJobData = prepared.jobData;
    current = {
      ...prepared.record,
      status: "running",
      startedAt,
      errorCode: null,
    };
    baseProgress = {
      deletedMessageRequests: current.deletedMessageRequests,
      deletedUsageLedger: current.deletedUsageLedger,
    };
    await setUserStatisticsResetStatus(current);
    const deleted = await executeUserStatisticsReset(preparedJobData, async (progress) => {
      attemptProgress = progress;
      current = {
        ...current,
        deletedMessageRequests:
          baseProgress.deletedMessageRequests + progress.deletedMessageRequests,
        deletedUsageLedger: baseProgress.deletedUsageLedger + progress.deletedUsageLedger,
      };
      await setUserStatisticsResetStatus(current);
    });
    attemptProgress = deleted;
    const completed: UserStatisticsResetStoredRecord = {
      ...current,
      deletedMessageRequests: baseProgress.deletedMessageRequests + deleted.deletedMessageRequests,
      deletedUsageLedger: baseProgress.deletedUsageLedger + deleted.deletedUsageLedger,
      status: "completed",
      startedAt,
      completedAt: new Date().toISOString(),
      errorCode: null,
    };
    await setUserStatisticsResetStatus(completed);
    try {
      await releaseActiveUserStatisticsReset(job.data.userId, job.data.resetId);
    } catch (error) {
      logger.warn("[UserStatisticsResetQueue] completed reset retained an active claim", {
        resetId: job.data.resetId,
        userId: job.data.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return completed;
  } catch (error) {
    const attempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade + 1 >= attempts;
    const errorProgress =
      error instanceof UserStatisticsResetError
        ? error.progress
        : { deletedMessageRequests: 0, deletedUsageLedger: 0 };
    const progress = {
      deletedMessageRequests: Math.max(
        attemptProgress.deletedMessageRequests,
        errorProgress.deletedMessageRequests
      ),
      deletedUsageLedger: Math.max(
        attemptProgress.deletedUsageLedger,
        errorProgress.deletedUsageLedger
      ),
    };
    try {
      await setUserStatisticsResetStatus({
        ...current,
        deletedMessageRequests:
          baseProgress.deletedMessageRequests + progress.deletedMessageRequests,
        deletedUsageLedger: baseProgress.deletedUsageLedger + progress.deletedUsageLedger,
        status: isFinalAttempt ? "failed" : "queued",
        startedAt,
        completedAt: isFinalAttempt ? new Date().toISOString() : null,
        errorCode: isFinalAttempt ? errorCode(error) : null,
      });
    } catch (statusError) {
      logger.error("[UserStatisticsResetQueue] failed to persist attempt status", {
        resetId: job.data.resetId,
        userId: job.data.userId,
        error: statusError instanceof Error ? statusError.message : String(statusError),
      });
    }
    if (isFinalAttempt) {
      try {
        await releaseActiveUserStatisticsReset(job.data.userId, job.data.resetId);
      } catch (releaseError) {
        logger.warn("[UserStatisticsResetQueue] failed reset retained an active claim", {
          resetId: job.data.resetId,
          userId: job.data.userId,
          error: releaseError instanceof Error ? releaseError.message : String(releaseError),
        });
      }
    }
    throw error;
  }
}

export async function enqueueUserStatisticsReset(
  userId: number,
  options: { requestedAt?: string; fixed5hKeyIds?: number[] } = {}
): Promise<UserStatisticsResetRecord> {
  return enqueueUserStatisticsResetWithReconciliation(userId, options, true);
}

async function enqueueUserStatisticsResetWithReconciliation(
  userId: number,
  options: { requestedAt?: string; fixed5hKeyIds?: number[] },
  allowReconciliation: boolean
): Promise<UserStatisticsResetRecord> {
  const queue = getResetQueue();
  const jobData: UserStatisticsResetJobData = {
    resetId: randomUUID(),
    userId,
    requestedAt: options.requestedAt ?? new Date().toISOString(),
    fixed5hKeyIds: options.fixed5hKeyIds ?? [],
  };
  const queued = createQueuedRecord(jobData);
  await setUserStatisticsResetStatus(queued);

  const claim = await claimActiveUserStatisticsReset(userId, jobData.resetId);
  if (!claim.acquired) {
    await deleteUserStatisticsResetStatus(jobData.resetId);
    const existing = await getUserStatisticsResetStatus(claim.resetId);
    const existingIsActive =
      existing?.userId === userId && ["queued", "running"].includes(existing.status);
    if (!existingIsActive) {
      await releaseActiveUserStatisticsReset(userId, claim.resetId);
      if (allowReconciliation) {
        return enqueueUserStatisticsResetWithReconciliation(userId, options, false);
      }
      throw new Error("USER_STATISTICS_RESET_ACTIVE_STATUS_MISSING");
    }

    const existingJob = await queue.getJob(existing.resetId);
    const existingJobState = existingJob ? await existingJob.getState() : null;
    if (existingJobState === "failed" || existingJobState === "completed") {
      await releaseActiveUserStatisticsReset(userId, existing.resetId);
      if (allowReconciliation) {
        return enqueueUserStatisticsResetWithReconciliation(userId, options, false);
      }
      throw new Error("USER_STATISTICS_RESET_ACTIVE_JOB_TERMINAL");
    }
    if (!existingJob) {
      const recovered = await ensurePreparedReset(
        {
          resetId: existing.resetId,
          userId: existing.userId,
          requestedAt: existing.requestedAt,
          fixed5hKeyIds: existing.fixed5hKeyIds,
          ...(existing.fixed5hPreparationVersion === 1
            ? { fixed5hPreparationVersion: 1 as const }
            : {}),
        },
        existing
      );
      await queue.add(RESET_JOB_NAME, recovered.jobData, { jobId: existing.resetId });
      return toPublicRecord(recovered.record);
    }
    return toPublicRecord(existing);
  }

  let preparedRecord: UserStatisticsResetStoredRecord | null = null;
  let enqueueAttempted = false;
  try {
    const requestedAt = await prepareUserStatisticsResetFixed5h({
      resetId: jobData.resetId,
      userId,
      keyIds: jobData.fixed5hKeyIds ?? [],
    });
    if (!requestedAt) throw new Error("USER_STATISTICS_RESET_FIXED_5H_PREPARE_FAILED");
    const preparedJobData: PreparedResetJobData = {
      ...jobData,
      requestedAt,
      fixed5hKeyIds: jobData.fixed5hKeyIds ?? [],
      fixed5hPreparationVersion: 1,
    };
    preparedRecord = {
      ...queued,
      ...preparedJobData,
    };
    await setUserStatisticsResetStatus(preparedRecord);
    enqueueAttempted = true;
    await queue.add(RESET_JOB_NAME, preparedJobData, { jobId: jobData.resetId });
    return toPublicRecord(preparedRecord);
  } catch (error) {
    if (enqueueAttempted && preparedRecord) {
      try {
        if (await queue.getJob(jobData.resetId)) {
          return toPublicRecord(preparedRecord);
        }
      } catch (reconciliationError) {
        logger.warn("[UserStatisticsResetQueue] ambiguous enqueue could not be reconciled", {
          resetId: jobData.resetId,
          userId,
          error:
            reconciliationError instanceof Error
              ? reconciliationError.message
              : String(reconciliationError),
        });
      }
    }
    logger.warn("[UserStatisticsResetQueue] reset remains queued after enqueue failure", {
      resetId: jobData.resetId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function findUserStatisticsReset(
  userId: number,
  resetId: string
): Promise<UserStatisticsResetRecord | null> {
  const record = await getUserStatisticsResetStatus(resetId);
  return record?.userId === userId ? toPublicRecord(record) : null;
}

export function startUserStatisticsResetQueue(): boolean {
  if (!process.env.REDIS_URL) {
    logger.warn("[UserStatisticsResetQueue] disabled because REDIS_URL is not configured");
    return false;
  }
  try {
    getResetQueue();
    return true;
  } catch (error) {
    logger.error("[UserStatisticsResetQueue] failed to start", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function stopUserStatisticsResetQueue(): Promise<void> {
  if (!resetQueue) return;
  await resetQueue.close();
  resetQueue = null;
}
