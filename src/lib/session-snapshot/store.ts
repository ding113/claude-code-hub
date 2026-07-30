import path from "node:path";
import {
  getCachedSystemSettings,
  getCachedSystemSettingsOnlyCache,
} from "@/lib/config/system-settings-cache";
import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis";
import type { SessionSnapshotStoreSetting } from "@/types/system-config";
import { FilesystemSessionSnapshotStore } from "./filesystem-store";
import type { SessionSnapshotData, SessionSnapshotKey, SessionSnapshotStore } from "./types";

class DisabledSessionSnapshotStore implements SessionSnapshotStore {
  enqueuePatch(): boolean {
    return false;
  }
  async get(): Promise<SessionSnapshotData | null> {
    return null;
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

class RedisSessionSnapshotStore implements SessionSnapshotStore {
  enqueuePatch(key: SessionSnapshotKey, patch: SessionSnapshotData, ttlSeconds: number): boolean {
    const redis = getRedisClient();
    if (redis?.status !== "ready") return false;
    const redisKey = this.buildKey(key);
    const pipeline = redis.pipeline();
    for (const [field, value] of Object.entries(patch)) {
      pipeline.hset(redisKey, field, JSON.stringify(value));
    }
    pipeline.expire(redisKey, ttlSeconds);
    void pipeline.exec().catch((error) => {
      logger.warn("[SessionSnapshot] Redis snapshot write dropped", { error });
    });
    return true;
  }

  async get(key: SessionSnapshotKey): Promise<SessionSnapshotData | null> {
    const redis = getRedisClient();
    if (redis?.status !== "ready") return null;
    const values = await redis.hgetall(this.buildKey(key));
    if (Object.keys(values).length === 0) return null;
    const result: SessionSnapshotData = {};
    for (const [field, value] of Object.entries(values)) {
      try {
        result[field] = JSON.parse(value) as unknown;
      } catch {
        result[field] = null;
      }
    }
    return result;
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  private buildKey(key: SessionSnapshotKey): string {
    return `session:${key.sessionId}:req:${key.sequence}:snapshot:${key.kind}:${key.phase}:v2`;
  }
}

const filesystemStore = new FilesystemSessionSnapshotStore({
  root: process.env.SESSION_SNAPSHOT_ROOT ?? path.join(process.cwd(), "data", "session-snapshots"),
});
const redisStore = new RedisSessionSnapshotStore();
const disabledStore = new DisabledSessionSnapshotStore();

let activeSelection: SessionSnapshotStoreSetting = "filesystem";
let activeStore: SessionSnapshotStore = filesystemStore;
let reconfigurePromise: Promise<void> = Promise.resolve();
let shuttingDown = false;

function resolveStore(selected: SessionSnapshotStoreSetting): SessionSnapshotStore {
  if (selected === "redis") return redisStore;
  if (selected === "disabled") return disabledStore;
  return filesystemStore;
}

export function getSessionSnapshotStore(): SessionSnapshotStore {
  if (shuttingDown) return disabledStore;
  const selected = getCachedSystemSettingsOnlyCache()?.sessionSnapshotStore ?? activeSelection;
  if (selected !== activeSelection) {
    void reconfigureSessionSnapshotStore(selected).catch((error) => {
      logger.warn("[SessionSnapshot] Runtime store reconfiguration failed", { error });
    });
    return resolveStore(selected);
  }
  return activeStore;
}

export function reconfigureSessionSnapshotStore(
  selected: SessionSnapshotStoreSetting
): Promise<void> {
  if (shuttingDown) return Promise.resolve();

  const target = resolveStore(selected);
  activeSelection = selected;
  activeStore = target;
  const previousTransition = reconfigurePromise.catch(() => undefined);
  reconfigurePromise = previousTransition.then(async () => {
    await target.start();
    if (activeStore !== target) return;

    const inactiveStores = [filesystemStore, redisStore, disabledStore].filter(
      (store) => store !== target
    );
    await Promise.all(inactiveStores.map((store) => store.stop()));
  });
  return reconfigurePromise;
}

export async function startSessionSnapshotStore(): Promise<void> {
  shuttingDown = false;
  const settings = await getCachedSystemSettings();
  await reconfigureSessionSnapshotStore(settings.sessionSnapshotStore);
}

export async function stopSessionSnapshotStores(): Promise<void> {
  shuttingDown = true;
  activeSelection = "disabled";
  activeStore = disabledStore;
  await reconfigurePromise.catch(() => undefined);
  await Promise.all([filesystemStore.stop(), redisStore.stop(), disabledStore.stop()]);
}

export type { SessionSnapshotData, SessionSnapshotKey, SessionSnapshotStore } from "./types";
