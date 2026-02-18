import "server-only";

import type Redis from "ioredis";
import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis";
import { DEFAULT_SESSION_TTL, type SessionData, type SessionStore } from "./index";

const SESSION_KEY_PREFIX = "cch:session:";
const MIN_TTL_SECONDS = 1;

type RedisSessionClient = Pick<Redis, "status" | "setex" | "get" | "del">;

export interface RedisSessionStoreOptions {
  defaultTtlSeconds?: number;
  redisClient?: RedisSessionClient | null;
}

function toLogError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeTtlSeconds(value: number | undefined): number {
  if (!Number.isFinite(value) || typeof value !== "number" || value <= 0) {
    return DEFAULT_SESSION_TTL;
  }

  return Math.max(MIN_TTL_SECONDS, Math.floor(value));
}

function buildSessionKey(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

function parseSessionData(raw: string): SessionData | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const obj = parsed as Record<string, unknown>;
    if (typeof obj.sessionId !== "string") return null;
    if (typeof obj.keyFingerprint !== "string") return null;
    if (typeof obj.userRole !== "string") return null;
    if (!Number.isInteger(obj.userId)) return null;
    if (!Number.isFinite(obj.createdAt) || typeof obj.createdAt !== "number") return null;
    if (!Number.isFinite(obj.expiresAt) || typeof obj.expiresAt !== "number") return null;

    return {
      sessionId: obj.sessionId,
      keyFingerprint: obj.keyFingerprint,
      userId: obj.userId as number,
      userRole: obj.userRole,
      createdAt: obj.createdAt,
      expiresAt: obj.expiresAt,
    };
  } catch {
    return null;
  }
}

function resolveRotateTtlSeconds(expiresAt: number): number {
  if (!Number.isFinite(expiresAt) || typeof expiresAt !== "number") {
    return DEFAULT_SESSION_TTL;
  }

  const remainingMs = expiresAt - Date.now();
  return Math.max(MIN_TTL_SECONDS, Math.ceil(remainingMs / 1000));
}

export class RedisSessionStore implements SessionStore {
  private readonly defaultTtlSeconds: number;
  private readonly redisClient?: RedisSessionClient | null;

  constructor(options: RedisSessionStoreOptions = {}) {
    this.defaultTtlSeconds = normalizeTtlSeconds(options.defaultTtlSeconds);
    this.redisClient = options.redisClient;
  }

  private resolveRedisClient(): RedisSessionClient | null {
    if (this.redisClient !== undefined) {
      return this.redisClient;
    }

    return getRedisClient({ allowWhenRateLimitDisabled: true }) as RedisSessionClient | null;
  }

  private getReadyRedis(): RedisSessionClient | null {
    const redis = this.resolveRedisClient();
    if (!redis || redis.status !== "ready") {
      return null;
    }

    return redis;
  }

  async create(
    data: Omit<SessionData, "sessionId" | "createdAt" | "expiresAt">,
    ttlSeconds = this.defaultTtlSeconds
  ): Promise<SessionData> {
    const ttl = normalizeTtlSeconds(ttlSeconds);
    const createdAt = Date.now();
    const sessionData: SessionData = {
      sessionId: `sid_${globalThis.crypto.randomUUID()}`,
      keyFingerprint: data.keyFingerprint,
      userId: data.userId,
      userRole: data.userRole,
      createdAt,
      expiresAt: createdAt + ttl * 1000,
    };

    const redis = this.getReadyRedis();
    if (!redis) {
      throw new Error("Redis not ready: session not persisted");
    }

    try {
      await redis.setex(buildSessionKey(sessionData.sessionId), ttl, JSON.stringify(sessionData));
    } catch (error) {
      logger.error("[AuthSessionStore] Failed to create session", {
        error: toLogError(error),
        sessionId: sessionData.sessionId,
      });
      throw error;
    }

    return sessionData;
  }

  async read(sessionId: string): Promise<SessionData | null> {
    const redis = this.getReadyRedis();
    if (!redis) {
      return null;
    }

    try {
      const value = await redis.get(buildSessionKey(sessionId));
      if (!value) {
        return null;
      }

      const parsed = parseSessionData(value);
      if (!parsed) {
        logger.warn("[AuthSessionStore] Invalid session payload", { sessionId });
        return null;
      }

      return parsed;
    } catch (error) {
      logger.error("[AuthSessionStore] Failed to read session", {
        error: toLogError(error),
        sessionId,
      });
      return null;
    }
  }

  async revoke(sessionId: string): Promise<boolean> {
    const redis = this.getReadyRedis();
    if (!redis) {
      logger.warn("[AuthSessionStore] Redis not ready during revoke", { sessionId });
      return false;
    }

    try {
      const deleted = await redis.del(buildSessionKey(sessionId));
      return deleted > 0;
    } catch (error) {
      logger.error("[AuthSessionStore] Failed to revoke session", {
        error: toLogError(error),
        sessionId,
      });
      return false;
    }
  }

  async rotate(oldSessionId: string): Promise<SessionData | null> {
    const oldSession = await this.read(oldSessionId);
    if (!oldSession) {
      return null;
    }

    const ttlSeconds = resolveRotateTtlSeconds(oldSession.expiresAt);
    let nextSession: SessionData;
    try {
      nextSession = await this.create(
        {
          keyFingerprint: oldSession.keyFingerprint,
          userId: oldSession.userId,
          userRole: oldSession.userRole,
        },
        ttlSeconds
      );
    } catch (error) {
      logger.error("[AuthSessionStore] Failed to create rotated session", {
        error: toLogError(error),
        oldSessionId,
      });
      return null;
    }

    const revoked = await this.revoke(oldSessionId);
    if (!revoked) {
      logger.warn(
        "[AuthSessionStore] Failed to revoke old session during rotate; old session will expire naturally",
        {
          oldSessionId,
          newSessionId: nextSession.sessionId,
        }
      );
    }

    return nextSession;
  }
}
