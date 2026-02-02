import "server-only";

import type Redis from "ioredis";
import { logger } from "@/lib/logger";
import { getRedisClient } from "./client";

export const CHANNEL_ERROR_RULES_UPDATED = "cch:cache:error_rules:updated";
export const CHANNEL_REQUEST_FILTERS_UPDATED = "cch:cache:request_filters:updated";
export const CHANNEL_SENSITIVE_WORDS_UPDATED = "cch:cache:sensitive_words:updated";

type CacheInvalidationCallback = () => void;

let subscriberClient: Redis | null = null;
let subscriberReady: Promise<Redis> | null = null;
const subscriptions = new Map<string, Set<CacheInvalidationCallback>>();
const subscribedChannels = new Set<string>();

function ensureSubscriber(baseClient: Redis): Promise<Redis> {
  if (subscriberReady) return subscriberReady;

  subscriberReady = new Promise<Redis>((resolve, reject) => {
    const sub = baseClient.duplicate();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    function cleanup(): void {
      sub.off("ready", onReady);
      sub.off("error", onError);

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    }

    function fail(error: Error): void {
      cleanup();
      subscriberReady = null;
      try {
        sub.disconnect();
      } catch {
        // ignore
      }
      reject(error);
    }

    function onReady(): void {
      cleanup();
      subscriberClient = sub;
      subscribedChannels.clear();

      sub.on("error", (error) => logger.warn("[RedisPubSub] Subscriber connection error", { error }));

      sub.on("message", (channel: string) => {
        const callbacks = subscriptions.get(channel);
        if (!callbacks || callbacks.size === 0) return;
        for (const cb of callbacks) {
          try {
            cb();
          } catch (error) {
            logger.error("[RedisPubSub] Callback error", { channel, error });
          }
        }
      });

      logger.info("[RedisPubSub] Subscriber connection ready");
      resolve(sub);
    }

    function onError(error: Error): void {
      logger.warn("[RedisPubSub] Subscriber connection error", { error });
      fail(error);
    }

    sub.once("ready", onReady);
    sub.once("error", onError);

    // Timeout 10 seconds
    timeoutId = setTimeout(() => {
      if (sub.status !== "ready") {
        fail(new Error("Redis subscriber connection timeout"));
      }
    }, 10000);
  });

  return subscriberReady;
}

/**
 * Publish cache invalidation (silent fail, auto-degrade)
 */
export async function publishCacheInvalidation(channel: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.publish(channel, Date.now().toString());
  } catch (error) {
    logger.warn("[RedisPubSub] Failed to publish cache invalidation", { channel, error });
  }
}

/**
 * Subscribe to cache invalidation
 * Returns cleanup function on success, null on failure
 */
export async function subscribeCacheInvalidation(
  channel: string,
  callback: CacheInvalidationCallback
): Promise<(() => void) | null> {
  const baseClient = getRedisClient();
  if (!baseClient) return null;

  try {
    const sub = await ensureSubscriber(baseClient);

    const callbacks = subscriptions.get(channel) ?? new Set<CacheInvalidationCallback>();
    callbacks.add(callback);
    subscriptions.set(channel, callbacks);

    if (!subscribedChannels.has(channel)) {
      try {
        await sub.subscribe(channel);
        subscribedChannels.add(channel);
        logger.info("[RedisPubSub] Subscribed to channel", { channel });
      } catch (error) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          subscriptions.delete(channel);
        }
        throw error;
      }
    }

    return () => {
      const cbs = subscriptions.get(channel);
      if (!cbs) return;

      cbs.delete(callback);

      if (cbs.size === 0) {
        subscriptions.delete(channel);
        subscribedChannels.delete(channel);
        if (subscriberClient) {
          void subscriberClient.unsubscribe(channel);
        }
      }
    };
  } catch (error) {
    logger.warn("[RedisPubSub] Failed to subscribe cache invalidation", { channel, error });
    return null;
  }
}
