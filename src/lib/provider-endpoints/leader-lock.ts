import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis";

export type LeaderLockType = "redis" | "memory";

export interface LeaderLock {
  key: string;
  lockId: string;
  lockType: LeaderLockType;
}

const inMemoryLocks = new Map<string, { owner: string; expiresAt: number }>();

function generateLockId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cleanupExpiredMemoryLocks(now: number): void {
  for (const [key, lock] of inMemoryLocks.entries()) {
    if (lock.expiresAt <= now) {
      inMemoryLocks.delete(key);
    }
  }
}

export async function acquireLeaderLock(key: string, ttlMs: number): Promise<LeaderLock | null> {
  const lockId = generateLockId();
  const redis = getRedisClient({ allowWhenRateLimitDisabled: true });

  if (redis && redis.status === "ready") {
    try {
      const luaScript = "return redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2])";
      const result = (await redis.eval(luaScript, 1, key, lockId, ttlMs.toString())) as
        | string
        | null;

      if (result === "OK") {
        return { key, lockId, lockType: "redis" };
      }

      return null;
    } catch (error) {
      logger.warn("[LeaderLock] Redis acquire failed, falling back to memory lock", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const now = Date.now();
  cleanupExpiredMemoryLocks(now);

  const existing = inMemoryLocks.get(key);
  if (existing) {
    return null;
  }

  inMemoryLocks.set(key, { owner: lockId, expiresAt: now + ttlMs });
  return { key, lockId, lockType: "memory" };
}

export async function renewLeaderLock(lock: LeaderLock, ttlMs: number): Promise<boolean> {
  const redis = getRedisClient({ allowWhenRateLimitDisabled: true });

  if (lock.lockType === "memory") {
    // If Redis becomes available, force callers to re-acquire a distributed lock.
    if (redis && redis.status === "ready") {
      return false;
    }

    const now = Date.now();
    cleanupExpiredMemoryLocks(now);

    const existing = inMemoryLocks.get(lock.key);
    if (!existing || existing.owner !== lock.lockId) {
      return false;
    }

    existing.expiresAt = now + ttlMs;
    inMemoryLocks.set(lock.key, existing);
    return true;
  }

  if (!redis || redis.status !== "ready") {
    return false;
  }

  try {
    const luaScript = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('PEXPIRE', KEYS[1], ARGV[2])
      else
        return 0
      end
    `;

    const result = (await redis.eval(luaScript, 1, lock.key, lock.lockId, ttlMs.toString())) as
      | number
      | null;

    return result === 1;
  } catch (error) {
    logger.warn("[LeaderLock] Redis renew failed", {
      key: lock.key,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function releaseLeaderLock(lock: LeaderLock): Promise<void> {
  if (lock.lockType === "memory") {
    const existing = inMemoryLocks.get(lock.key);
    if (existing && existing.owner === lock.lockId) {
      inMemoryLocks.delete(lock.key);
    }
    return;
  }

  const redis = getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis || redis.status !== "ready") {
    return;
  }

  try {
    const luaScript = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      else
        return 0
      end
    `;

    await redis.eval(luaScript, 1, lock.key, lock.lockId);
  } catch (error) {
    logger.warn("[LeaderLock] Redis release failed", {
      key: lock.key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function startLeaderLockKeepAlive(opts: {
  getLock: () => LeaderLock | undefined;
  clearLock: () => void;
  ttlMs: number;
  logTag: string;
  onLost: () => void;
}): { stop: () => void } {
  let stopped = false;
  let renewing = false;
  let intervalId: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (intervalId) clearInterval(intervalId);
  };

  const tick = async () => {
    if (stopped || renewing) return;

    const current = opts.getLock();
    if (!current) {
      stop();
      opts.onLost();
      return;
    }

    renewing = true;
    try {
      const ok = await renewLeaderLock(current, opts.ttlMs);
      if (!ok) {
        opts.clearLock();
        stop();
        opts.onLost();
        logger.warn(`[${opts.logTag}] Lost leader lock during operation`, {
          key: current.key,
          lockType: current.lockType,
        });
      }
    } finally {
      renewing = false;
    }
  };

  const intervalMs = Math.max(1000, Math.floor(opts.ttlMs / 2));
  intervalId = setInterval(() => {
    void tick();
  }, intervalMs);

  const timer = intervalId as unknown as { unref?: () => void };
  timer.unref?.();

  return { stop };
}
