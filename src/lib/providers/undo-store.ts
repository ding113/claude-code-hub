import "server-only";

import { PROVIDER_BATCH_PATCH_ERROR_CODES } from "@/lib/provider-batch-patch-error-codes";

const UNDO_SNAPSHOT_TTL_MS = 10_000;

export interface UndoSnapshot {
  operationId: string;
  operationType: "batch_edit" | "single_edit" | "single_delete";
  preimage: unknown;
  providerIds: number[];
  createdAt: string;
}

export interface StoreUndoResult {
  undoAvailable: boolean;
  undoToken?: string;
  expiresAt?: string;
}

export type ConsumeUndoResult =
  | {
      ok: true;
      snapshot: UndoSnapshot;
    }
  | {
      ok: false;
      code: "UNDO_EXPIRED" | "UNDO_CONFLICT";
    };

interface UndoStoreEntry {
  snapshot: UndoSnapshot;
  expiresAtMs: number;
  cleanupTimer: ReturnType<typeof setTimeout>;
}

const undoSnapshotStore = new Map<string, UndoStoreEntry>();

function removeUndoEntry(token: string, entry?: UndoStoreEntry): void {
  const resolved = entry ?? undoSnapshotStore.get(token);
  if (!resolved) {
    return;
  }

  clearTimeout(resolved.cleanupTimer);
  undoSnapshotStore.delete(token);
}

export async function storeUndoSnapshot(snapshot: UndoSnapshot): Promise<StoreUndoResult> {
  try {
    const nowMs = Date.now();
    const undoToken = crypto.randomUUID();
    const expiresAtMs = nowMs + UNDO_SNAPSHOT_TTL_MS;

    const cleanupTimer = setTimeout(() => {
      undoSnapshotStore.delete(undoToken);
    }, UNDO_SNAPSHOT_TTL_MS);
    cleanupTimer.unref?.();

    undoSnapshotStore.set(undoToken, {
      snapshot,
      expiresAtMs,
      cleanupTimer,
    });

    return {
      undoAvailable: true,
      undoToken,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  } catch {
    return { undoAvailable: false };
  }
}

export async function consumeUndoToken(token: string): Promise<ConsumeUndoResult> {
  try {
    const entry = undoSnapshotStore.get(token);
    if (!entry) {
      return {
        ok: false,
        code: PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_EXPIRED,
      };
    }

    removeUndoEntry(token, entry);

    if (entry.expiresAtMs <= Date.now()) {
      return {
        ok: false,
        code: PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_EXPIRED,
      };
    }

    return {
      ok: true,
      snapshot: entry.snapshot,
    };
  } catch {
    return {
      ok: false,
      code: PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_EXPIRED,
    };
  }
}
