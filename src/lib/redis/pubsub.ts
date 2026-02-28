import "server-only";

import type Redis from "ioredis";
import { logger } from "@/lib/logger";
import { getRedisClient } from "./client";

export const CHANNEL_ERROR_RULES_UPDATED = "cch:cache:error_rules:updated";
export const CHANNEL_REQUEST_FILTERS_UPDATED = "cch:cache:request_filters:updated";
export const CHANNEL_SENSITIVE_WORDS_UPDATED = "cch:cache:sensitive_words:updated";
// API Key 集合发生变化（典型：创建新 key）时，通知各实例重建 Vacuum Filter，避免误拒绝
export const CHANNEL_API_KEYS_UPDATED = "cch:cache:api_keys:updated";

type CacheInvalidationCallback = (message: string) => void;

let subscriberClient: Redis | null = null;
let subscriberReady: Promise<Redis> | null = null;
const subscriptions = new Map<string, Set<CacheInvalidationCallback>>();
const subscribedChannels = new Set<string>();

let resubscribeInFlight: Promise<void> | null = null;

const SUBSCRIBER_CONNECT_TIMEOUT_MS = 10000;
const SUBSCRIBER_CONNECT_BACKOFF_BASE_MS = 1000;
const SUBSCRIBER_CONNECT_BACKOFF_MAX_MS = 60000;

let subscriberConnectFailures = 0;
let subscriberNextConnectAt = 0;

function computeSubscriberConnectBackoffMs(consecutiveFailures: number): number {
  if (!Number.isFinite(consecutiveFailures) || consecutiveFailures <= 0) return 0;

  const exponent = Math.min(consecutiveFailures - 1, 10);
  const backoffMs = SUBSCRIBER_CONNECT_BACKOFF_BASE_MS * 2 ** exponent;
  return Math.min(SUBSCRIBER_CONNECT_BACKOFF_MAX_MS, backoffMs);
}

async function resubscribeAll(sub: Redis): Promise<void> {
  if (resubscribeInFlight) return resubscribeInFlight;

  resubscribeInFlight = (async () => {
    const channelsToSubscribe: string[] = [];
    for (const [channel, callbacks] of subscriptions) {
      if (!callbacks || callbacks.size === 0) continue;
      if (!subscribedChannels.has(channel)) {
        channelsToSubscribe.push(channel);
      }
    }

    if (channelsToSubscribe.length === 0) return;

    let successCount = 0;
    for (const channel of channelsToSubscribe) {
      try {
        await sub.subscribe(channel);
        subscribedChannels.add(channel);
        successCount++;
      } catch (error) {
        logger.warn("[RedisPubSub] Failed to resubscribe channel after reconnect", {
          channel,
          error,
        });
      }
    }

    if (successCount > 0) {
      logger.info("[RedisPubSub] Resubscribed to channels after reconnect", {
        count: successCount,
      });
    }
  })().finally(() => {
    resubscribeInFlight = null;
  });

  return resubscribeInFlight;
}

function ensureSubscriber(baseClient: Redis): Promise<Redis> {
  if (subscriberReady) return subscriberReady;

  const now = Date.now();
  const startDelayMs = Math.max(0, subscriberNextConnectAt - now);

  subscriberReady = new Promise<Redis>((resolve, reject) => {
    let sub: Redis | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let startDelayTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    function cleanup(): void {
      if (startDelayTimeoutId) {
        clearTimeout(startDelayTimeoutId);
        startDelayTimeoutId = null;
      }

      if (sub) {
        sub.off("ready", onReady);
        sub.off("error", onError);
      }

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    }

    function fail(error: Error): void {
      if (settled) return;
      settled = true;

      cleanup();
      subscriberReady = null;

      subscriberConnectFailures++;
      const backoffMs = computeSubscriberConnectBackoffMs(subscriberConnectFailures);
      subscriberNextConnectAt = Date.now() + backoffMs;

      logger.warn("[RedisPubSub] Subscriber connection failed", {
        error,
        consecutiveFailures: subscriberConnectFailures,
        nextRetryAt: new Date(subscriberNextConnectAt).toISOString(),
        backoffMs,
      });
      try {
        sub?.disconnect();
      } catch {
        // ignore
      }
      reject(error);
    }

    function onReady(): void {
      if (settled) return;
      settled = true;

      cleanup();
      if (!sub) {
        subscriberReady = null;
        reject(new Error("Redis subscriber connection ready without client"));
        return;
      }

      const readySub = sub;

      subscriberClient = readySub;
      subscribedChannels.clear();

      subscriberConnectFailures = 0;
      subscriberNextConnectAt = 0;

      readySub.on("error", (error) =>
        logger.warn("[RedisPubSub] Subscriber connection error", { error })
      );
      readySub.on("close", () => subscribedChannels.clear());
      readySub.on("end", () => subscribedChannels.clear());
      readySub.on("ready", () => void resubscribeAll(readySub));

      readySub.on("message", (channel: string, message: string) => {
        const callbacks = subscriptions.get(channel);
        if (!callbacks || callbacks.size === 0) return;
        for (const cb of callbacks) {
          try {
            cb(message);
          } catch (error) {
            logger.error("[RedisPubSub] Callback error", { channel, error });
          }
        }
      });

      logger.info("[RedisPubSub] Subscriber connection ready");
      resolve(readySub);
    }

    function onError(error: Error): void {
      fail(error);
    }

    function startConnection(): void {
      if (settled) return;

      sub = baseClient.duplicate();
      sub.once("ready", onReady);
      sub.once("error", onError);

      // Timeout 10 seconds
      timeoutId = setTimeout(() => {
        if (sub?.status !== "ready") {
          fail(new Error("Redis subscriber connection timeout"));
        }
      }, SUBSCRIBER_CONNECT_TIMEOUT_MS);
    }

    if (startDelayMs > 0) {
      startDelayTimeoutId = setTimeout(startConnection, startDelayMs);
    } else {
      startConnection();
    }
  });

  return subscriberReady;
}

/**
 * Publish cache invalidation (silent fail, auto-degrade)
 */
export async function publishCacheInvalidation(channel: string, message?: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.publish(channel, message ?? Date.now().toString());
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

  let sub: Redis;
  try {
    sub = await ensureSubscriber(baseClient);
  } catch {
    // ensureSubscriber 内部已记录连接失败与 backoff 信息，避免这里按 channel 重复刷屏
    return null;
  }

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
      logger.warn("[RedisPubSub] Failed to subscribe channel", { channel, error });
      return null;
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
}
