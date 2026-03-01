import "server-only";

import { logger } from "@/lib/logger";
import { PROVIDER_BATCH_PATCH_ERROR_CODES } from "@/lib/provider-batch-patch-error-codes";
import { RedisKVStore } from "@/lib/redis/redis-kv-store";

const UNDO_SNAPSHOT_TTL_SECONDS = 30;

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

const store = new RedisKVStore<UndoSnapshot>({
  prefix: "cch:prov:undo:",
  defaultTtlSeconds: UNDO_SNAPSHOT_TTL_SECONDS,
});

export async function storeUndoSnapshot(snapshot: UndoSnapshot): Promise<StoreUndoResult> {
  try {
    const undoToken = crypto.randomUUID();
    const expiresAtMs = Date.now() + UNDO_SNAPSHOT_TTL_SECONDS * 1000;

    const stored = await store.set(undoToken, snapshot);
    if (!stored) {
      logger.warn("[undo-store] Failed to persist undo snapshot; undo unavailable", {
        operationId: snapshot.operationId,
      });
      return { undoAvailable: false };
    }

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
    const snapshot = await store.getAndDelete(token);
    if (!snapshot) {
      return {
        ok: false,
        code: PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_EXPIRED,
      };
    }

    return {
      ok: true,
      snapshot,
    };
  } catch {
    return {
      ok: false,
      code: PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_EXPIRED,
    };
  }
}
