import "server-only";

import type Redis from "ioredis";
import { logger } from "@/lib/logger";
import { getRedisClient } from "./client";

export const CHANNEL_ERROR_RULES_UPDATED = "cch:cache:error_rules:updated";
export const CHANNEL_REQUEST_FILTERS_UPDATED = "cch:cache:request_filters:updated";

type CacheInvalidationCallback = () => void;

let subscriberClient: Redis | null = null;
const subscriptions = new Map<string, Set<CacheInvalidationCallback>>();

function ensureSubscriber(baseClient: Redis): Redis {
  if (subscriberClient) return subscriberClient;

  // 订阅必须使用独立连接（Pub/Sub 模式下连接不能再执行普通命令）
  subscriberClient = baseClient.duplicate();

  subscriberClient.on("message", (channel: string) => {
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

  subscriberClient.on("error", (error) => {
    logger.warn("[RedisPubSub] Subscriber connection error", { error });
  });

  return subscriberClient;
}

/**
 * 发布缓存失效通知（失败不抛错，自动降级）
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
 * 订阅缓存失效通知（失败不抛错，自动降级）
 *
 * 返回取消订阅函数（用于释放回调引用）
 */
export async function subscribeCacheInvalidation(
  channel: string,
  callback: CacheInvalidationCallback
): Promise<() => void> {
  const baseClient = getRedisClient();
  if (!baseClient) return () => {};

  try {
    const sub = ensureSubscriber(baseClient);

    const existing = subscriptions.get(channel);
    const isFirstSubscriberForChannel = !existing;

    // Fix: 先订阅 Redis，成功后再更新本地状态，避免订阅失败时状态污染
    if (isFirstSubscriberForChannel) {
      await sub.subscribe(channel);
    }

    // 订阅成功后才更新本地状态
    const callbacks = existing ?? new Set<CacheInvalidationCallback>();
    callbacks.add(callback);
    subscriptions.set(channel, callbacks);

    return () => {
      const cbs = subscriptions.get(channel);
      if (!cbs) return;

      cbs.delete(callback);

      if (cbs.size === 0) {
        subscriptions.delete(channel);
        if (subscriberClient) {
          const currentSubscriber = subscriberClient;
          try {
            void currentSubscriber.unsubscribe(channel).catch((error) => {
              logger.warn("[RedisPubSub] Failed to unsubscribe cache invalidation", {
                channel,
                error,
              });
            });
          } catch (error) {
            logger.warn("[RedisPubSub] Failed to unsubscribe cache invalidation", {
              channel,
              error,
            });
          }
        }
      }
    };
  } catch (error) {
    logger.warn("[RedisPubSub] Failed to subscribe cache invalidation", { channel, error });
    return () => {};
  }
}

/**
 * 关闭订阅者连接（用于优雅退出）
 */
export async function closeSubscriber(): Promise<void> {
  if (subscriberClient) {
    try {
      await subscriberClient.quit();
    } catch (error) {
      logger.warn("[RedisPubSub] Failed to close subscriber", { error });
    }
    subscriberClient = null;
    subscriptions.clear();
  }
}
