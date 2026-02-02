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

function ensureSubscriber(baseClient: Redis): Promise<Redis> {
  if (subscriberReady) return subscriberReady;

  subscriberReady = new Promise<Redis>((resolve, reject) => {
    const sub = baseClient.duplicate();

    const onReady = () => {
      cleanup();
      subscriberClient = sub;

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
    };

    const onError = (error: Error) => {
      cleanup();
      logger.warn("[RedisPubSub] Subscriber connection error", { error });
      subscriberReady = null;
      reject(error);
    };

    const cleanup = () => {
      sub.off("ready", onReady);
      sub.off("error", onError);
    };

    sub.once("ready", onReady);
    sub.once("error", onError);

    // Timeout 10 seconds
    setTimeout(() => {
      if (sub.status !== "ready") {
        cleanup();
        subscriberReady = null;
        reject(new Error("Redis subscriber connection timeout"));
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

    const existing = subscriptions.get(channel);
    const isFirstSubscriberForChannel = !existing;
    const callbacks = existing ?? new Set<CacheInvalidationCallback>();
    callbacks.add(callback);
    subscriptions.set(channel, callbacks);

    if (isFirstSubscriberForChannel) {
      await sub.subscribe(channel);
      logger.info("[RedisPubSub] Subscribed to channel", { channel });
    }

    return () => {
      const cbs = subscriptions.get(channel);
      if (!cbs) return;

      cbs.delete(callback);

      if (cbs.size === 0) {
        subscriptions.delete(channel);
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
