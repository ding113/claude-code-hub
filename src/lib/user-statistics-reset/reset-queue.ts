import "server-only";

import { randomUUID } from "node:crypto";
import type { Job } from "bull";
import Queue from "bull";
import { logger } from "@/lib/logger";
import { buildRedisQueueOptions } from "@/lib/redis/bull-queue-options";
import { executeUserStatisticsReset, UserStatisticsResetError } from "./reset-service";
import {
  claimActiveUserStatisticsReset,
  deleteUserStatisticsResetStatus,
  getUserStatisticsResetStatus,
  releaseActiveUserStatisticsReset,
  setUserStatisticsResetStatus,
} from "./reset-status-store";
import type { UserStatisticsResetJobData, UserStatisticsResetRecord } from "./types";

let resetQueue: Queue.Queue<UserStatisticsResetJobData> | null = null;
const RESET_JOB_NAME = "reset";
const STALLED_FAILURE_REASON = "job stalled more than allowable limit";

function errorCode(error: unknown): string {
  return error instanceof UserStatisticsResetError
    ? error.code
    : "USER_STATISTICS_RESET_OPERATION_FAILED";
}

function createQueuedRecord(input: UserStatisticsResetJobData): UserStatisticsResetRecord {
  return {
    ...input,
    status: "queued",
    startedAt: null,
    completedAt: null,
    deletedMessageRequests: 0,
    deletedUsageLedger: 0,
    errorCode: null,
  };
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
    logger.error("[UserStatisticsResetQueue] job failed", {
      resetId: job.data.resetId,
      userId: job.data.userId,
      attemptsMade: job.attemptsMade,
      error: error.message,
    });
    const attempts = job.opts.attempts ?? 1;
    const isTerminal = job.attemptsMade >= attempts || error.message === STALLED_FAILURE_REASON;
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
    errorCode: errorCode(error),
  });
  await releaseActiveUserStatisticsReset(jobData.userId, jobData.resetId);
}

async function processUserStatisticsReset(job: Job<UserStatisticsResetJobData>) {
  let current =
    (await getUserStatisticsResetStatus(job.data.resetId)) ?? createQueuedRecord(job.data);
  const startedAt = current.startedAt ?? new Date().toISOString();
  current = {
    ...current,
    status: "running",
    startedAt,
    errorCode: null,
  };

  try {
    await setUserStatisticsResetStatus(current);
    const deleted = await executeUserStatisticsReset(job.data);
    const completed: UserStatisticsResetRecord = {
      ...current,
      deletedMessageRequests: current.deletedMessageRequests + deleted.deletedMessageRequests,
      deletedUsageLedger: current.deletedUsageLedger + deleted.deletedUsageLedger,
      status: "completed",
      startedAt,
      completedAt: new Date().toISOString(),
      errorCode: null,
    };
    await setUserStatisticsResetStatus(completed);
    await releaseActiveUserStatisticsReset(job.data.userId, job.data.resetId);
    return completed;
  } catch (error) {
    const attempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade + 1 >= attempts;
    const progress =
      error instanceof UserStatisticsResetError
        ? error.progress
        : { deletedMessageRequests: 0, deletedUsageLedger: 0 };
    await setUserStatisticsResetStatus({
      ...current,
      deletedMessageRequests: current.deletedMessageRequests + progress.deletedMessageRequests,
      deletedUsageLedger: current.deletedUsageLedger + progress.deletedUsageLedger,
      status: isFinalAttempt ? "failed" : "queued",
      startedAt,
      completedAt: isFinalAttempt ? new Date().toISOString() : null,
      errorCode: isFinalAttempt ? errorCode(error) : null,
    });
    if (isFinalAttempt) {
      await releaseActiveUserStatisticsReset(job.data.userId, job.data.resetId);
    }
    throw error;
  }
}

export async function enqueueUserStatisticsReset(
  userId: number
): Promise<UserStatisticsResetRecord> {
  return enqueueUserStatisticsResetWithReconciliation(userId, true);
}

async function enqueueUserStatisticsResetWithReconciliation(
  userId: number,
  allowReconciliation: boolean
): Promise<UserStatisticsResetRecord> {
  const queue = getResetQueue();
  const jobData: UserStatisticsResetJobData = {
    resetId: randomUUID(),
    userId,
    requestedAt: new Date().toISOString(),
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
        return enqueueUserStatisticsResetWithReconciliation(userId, false);
      }
      throw new Error("USER_STATISTICS_RESET_ACTIVE_STATUS_MISSING");
    }

    const existingJob = await queue.getJob(existing.resetId);
    const existingJobState = existingJob ? await existingJob.getState() : null;
    if (existingJobState === "failed" || existingJobState === "completed") {
      await releaseActiveUserStatisticsReset(userId, existing.resetId);
      if (allowReconciliation) {
        return enqueueUserStatisticsResetWithReconciliation(userId, false);
      }
      throw new Error("USER_STATISTICS_RESET_ACTIVE_JOB_TERMINAL");
    }
    if (!existingJob) {
      await queue.add(
        RESET_JOB_NAME,
        {
          resetId: existing.resetId,
          userId: existing.userId,
          requestedAt: existing.requestedAt,
        },
        { jobId: existing.resetId }
      );
    }
    return existing;
  }

  try {
    await queue.add(RESET_JOB_NAME, jobData, { jobId: jobData.resetId });
    return queued;
  } catch (error) {
    await setUserStatisticsResetStatus({
      ...queued,
      status: "failed",
      completedAt: new Date().toISOString(),
      errorCode: "USER_STATISTICS_RESET_QUEUE_FAILED",
    });
    await releaseActiveUserStatisticsReset(userId, jobData.resetId);
    throw error;
  }
}

export async function findUserStatisticsReset(
  userId: number,
  resetId: string
): Promise<UserStatisticsResetRecord | null> {
  const record = await getUserStatisticsResetStatus(resetId);
  return record?.userId === userId ? record : null;
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
