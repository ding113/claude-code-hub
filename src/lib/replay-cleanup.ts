import "server-only";

import { getReplayStore, REPLAY_CLEANUP_BATCH_SIZE } from "@/app/v1/_lib/proxy/replay/replay-store";
import { withAdvisoryLock } from "@/lib/migrate";

const REPLAY_CLEANUP_LOCK_NAME = "claude-code-hub:replay-cleanup";
const REPLAY_CLEANUP_MAX_BATCHES = 5;
const REPLAY_CLEANUP_MAX_DURATION_MS = 30_000;

export type ReplayCleanupTickResult =
  | { status: "completed"; batches: number; deleted: number }
  | { status: "skipped_locked"; batches: 0; deleted: 0 }
  | { status: "skipped_running"; batches: 0; deleted: 0 };

let running = false;

export async function runReplayCleanupTick(): Promise<ReplayCleanupTickResult> {
  if (running) {
    return { status: "skipped_running", batches: 0, deleted: 0 };
  }

  running = true;
  try {
    const locked = await withAdvisoryLock(
      REPLAY_CLEANUP_LOCK_NAME,
      async () => {
        const cutoff = new Date();
        const startedAt = Date.now();
        let batches = 0;
        let deleted = 0;

        while (
          batches < REPLAY_CLEANUP_MAX_BATCHES &&
          Date.now() - startedAt < REPLAY_CLEANUP_MAX_DURATION_MS
        ) {
          const batchDeleted = await getReplayStore().cleanupExpired(cutoff);
          batches += 1;
          deleted += batchDeleted;
          if (batchDeleted < REPLAY_CLEANUP_BATCH_SIZE) {
            break;
          }
        }

        return { status: "completed" as const, batches, deleted };
      },
      { skipIfLocked: true }
    );

    return locked.ran
      ? (locked.result as ReplayCleanupTickResult)
      : { status: "skipped_locked", batches: 0, deleted: 0 };
  } finally {
    running = false;
  }
}
