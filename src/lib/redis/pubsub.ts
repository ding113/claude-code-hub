import "server-only";

import type Redis from "ioredis";
import { logger } from "@/lib/logger";
import { getRedisClient } from "./client";

export const CHANNEL_ERROR_RULES_UPDATED = "cch:cache:error_rules:updated";
export const CHANNEL_REQUEST_FILTERS_UPDATED = "cch:cache:request_filters:updated";
export const CHANNEL_SENSITIVE_WORDS_UPDATED = "cch:cache:sensitive_words:updated";
export const CHANNEL_PROVIDER_GROUPS_UPDATED = "cch:cache:provider_groups:updated";
export const CHANNEL_SYSTEM_SETTINGS_UPDATED = "cch:cache:system_settings:updated";
// API Key 集合发生变化（典型：创建新 key）时，通知各实例重建 Vacuum Filter，避免误拒绝
export const CHANNEL_API_KEYS_UPDATED = "cch:cache:api_keys:updated";

/**
 * Redis Pub/Sub 不会补发断线期间的消息。每次首次订阅或重连成功后，统一派发此
 * 合成消息，让订阅方从权威存储重新加载或清空本地缓存。
 */
export const CACHE_INVALIDATION_RESYNC_MESSAGE = "cch:cache:resync";

type CacheInvalidationCallback = (message: string) => void;

interface CacheInvalidationRegistration {
  callback: CacheInvalidationCallback;
  needsResync: boolean;
}

let subscriberClient: Redis | null = null;
let subscriberReady: Promise<Redis> | null = null;
const subscriptions = new Map<string, Set<CacheInvalidationRegistration>>();
const subscribedChannels = new Set<string>();
const channelSubscribeInFlight = new Map<string, Promise<boolean>>();

const SUBSCRIBER_CONNECT_TIMEOUT_MS = 10_000;
const SUBSCRIBER_CONNECT_BACKOFF_BASE_MS = 1_000;
const SUBSCRIBER_CONNECT_BACKOFF_MAX_MS = 60_000;

let subscriberConnectFailures = 0;
let subscriberNextConnectAt = 0;
let subscriptionRetryFailures = 0;
let subscriptionRetryTimer: ReturnType<typeof setTimeout> | null = null;

function computeSubscriberConnectBackoffMs(consecutiveFailures: number): number {
  if (!Number.isFinite(consecutiveFailures) || consecutiveFailures <= 0) return 0;

  const exponent = Math.min(consecutiveFailures - 1, 10);
  const backoffMs = SUBSCRIBER_CONNECT_BACKOFF_BASE_MS * 2 ** exponent;
  return Math.min(SUBSCRIBER_CONNECT_BACKOFF_MAX_MS, backoffMs);
}

function hasDesiredSubscriptions(): boolean {
  for (const registrations of subscriptions.values()) {
    if (registrations.size > 0) return true;
  }
  return false;
}

function allDesiredChannelsSubscribed(): boolean {
  for (const [channel, registrations] of subscriptions) {
    if (registrations.size > 0 && !subscribedChannels.has(channel)) return false;
  }
  return true;
}

function markAllSubscriptionsForResync(): void {
  for (const registrations of subscriptions.values()) {
    for (const registration of registrations) {
      registration.needsResync = true;
    }
  }
}

function invokeCallback(
  channel: string,
  registration: CacheInvalidationRegistration,
  message: string
): void {
  try {
    registration.callback(message);
  } catch (error) {
    logger.error("[RedisPubSub] Callback error", { channel, error });
  }
}

function dispatchPendingResync(channel: string): void {
  const registrations = subscriptions.get(channel);
  if (!registrations || registrations.size === 0) return;

  let count = 0;
  for (const registration of registrations) {
    if (!registration.needsResync) continue;

    // 在执行回调前清标记，避免回调同步触发订阅检查时重复派发。
    registration.needsResync = false;
    count++;
    invokeCallback(channel, registration, CACHE_INVALIDATION_RESYNC_MESSAGE);
  }

  if (count > 0) {
    logger.info("[RedisPubSub] Forced cache resync after subscription recovery", {
      channel,
      callbackCount: count,
    });
  }
}

function clearSubscriptionRetryTimer(): void {
  if (!subscriptionRetryTimer) return;
  clearTimeout(subscriptionRetryTimer);
  subscriptionRetryTimer = null;
}

function markSubscriptionsHealthy(): void {
  if (!allDesiredChannelsSubscribed()) return;
  subscriptionRetryFailures = 0;
  clearSubscriptionRetryTimer();
}

function scheduleSubscriptionRetry(): void {
  if (!hasDesiredSubscriptions() || subscriptionRetryTimer) return;

  subscriptionRetryFailures++;
  const retryBackoffMs = computeSubscriberConnectBackoffMs(subscriptionRetryFailures);
  const connectBackoffMs = Math.max(0, subscriberNextConnectAt - Date.now());
  const delayMs = Math.max(retryBackoffMs, connectBackoffMs);

  subscriptionRetryTimer = setTimeout(() => {
    subscriptionRetryTimer = null;
    void reconcileSubscriptions();
  }, delayMs);
  subscriptionRetryTimer.unref?.();

  logger.warn("[RedisPubSub] Scheduled persistent subscription retry", {
    delayMs,
    consecutiveFailures: subscriptionRetryFailures,
  });
}

async function ensureChannelSubscribed(sub: Redis, channel: string): Promise<boolean> {
  const registrations = subscriptions.get(channel);
  if (!registrations || registrations.size === 0) return true;

  if (subscribedChannels.has(channel)) {
    dispatchPendingResync(channel);
    return true;
  }

  const existing = channelSubscribeInFlight.get(channel);
  if (existing) return existing;

  const subscribePromise = (async () => {
    try {
      await sub.subscribe(channel);

      // SUBSCRIBE 可能与断线或最后一个 cleanup 竞态；只有当前 ready 连接仍然有效时
      // 才能发布“已订阅”状态。
      if (subscriberClient !== sub || sub.status !== "ready") return false;

      const currentRegistrations = subscriptions.get(channel);
      if (!currentRegistrations || currentRegistrations.size === 0) {
        await Promise.resolve(sub.unsubscribe(channel)).catch(() => undefined);
        return true;
      }

      subscribedChannels.add(channel);
      logger.info("[RedisPubSub] Subscribed to channel", { channel });
      dispatchPendingResync(channel);
      return true;
    } catch (error) {
      logger.warn("[RedisPubSub] Failed to subscribe channel", { channel, error });
      return false;
    }
  })().finally(() => {
    if (channelSubscribeInFlight.get(channel) === subscribePromise) {
      channelSubscribeInFlight.delete(channel);
    }
  });

  channelSubscribeInFlight.set(channel, subscribePromise);
  return subscribePromise;
}

async function subscribeAllDesiredChannels(sub: Redis): Promise<boolean> {
  const channels = Array.from(subscriptions.entries())
    .filter(([, registrations]) => registrations.size > 0)
    .map(([channel]) => channel);

  const results = await Promise.all(
    channels.map((channel) => ensureChannelSubscribed(sub, channel))
  );
  const healthy = results.every(Boolean) && allDesiredChannelsSubscribed();

  if (healthy) {
    markSubscriptionsHealthy();
  } else {
    scheduleSubscriptionRetry();
  }

  return healthy;
}

async function reconcileSubscriptions(preferredSubscriber?: Redis): Promise<void> {
  if (!hasDesiredSubscriptions()) {
    subscriptionRetryFailures = 0;
    clearSubscriptionRetryTimer();
    return;
  }

  try {
    const baseClient = getRedisClient();
    if (!baseClient) {
      scheduleSubscriptionRetry();
      return;
    }

    const sub =
      preferredSubscriber && preferredSubscriber === subscriberClient
        ? preferredSubscriber
        : await ensureSubscriber(baseClient);
    await subscribeAllDesiredChannels(sub);
  } catch {
    // ensureSubscriber 已记录连接失败详情；这里只维持持久重试，避免按 channel 刷屏。
    scheduleSubscriptionRetry();
  }
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

      readySub.on("error", (error) => {
        if (subscriberClient !== readySub) return;
        logger.warn("[RedisPubSub] Subscriber connection error", { error });
      });
      readySub.on("close", () => {
        if (subscriberClient !== readySub) return;
        subscribedChannels.clear();
        markAllSubscriptionsForResync();
        scheduleSubscriptionRetry();
      });
      readySub.on("end", () => {
        if (subscriberClient !== readySub) return;
        subscribedChannels.clear();
        markAllSubscriptionsForResync();
        subscriberClient = null;
        subscriberReady = null;
        scheduleSubscriptionRetry();
      });
      readySub.on("ready", () => {
        if (subscriberClient !== readySub) return;
        void reconcileSubscriptions(readySub);
      });

      readySub.on("message", (channel: string, message: string) => {
        const registrations = subscriptions.get(channel);
        if (!registrations || registrations.size === 0) return;
        for (const registration of registrations) {
          invokeCallback(channel, registration, message);
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

      try {
        sub = baseClient.duplicate();
        sub.once("ready", onReady);
        sub.once("error", onError);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }

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
  try {
    const redis = getRedisClient();
    if (!redis) return;
    await redis.publish(channel, message ?? Date.now().toString());
  } catch (error) {
    logger.warn("[RedisPubSub] Failed to publish cache invalidation", { channel, error });
  }
}

/**
 * Subscribe to cache invalidation.
 *
 * Redis 已配置时，回调会先持久登记；即使首次连接失败也返回 cleanup，并由本模块
 * 在后台有界退避重试。首次订阅和每次断线恢复后会派发一条 RESYNC 合成消息，
 * 用于覆盖 Pub/Sub 天生无法补发的断线窗口。仅 Redis 未配置/被禁用时返回 null。
 */
export async function subscribeCacheInvalidation(
  channel: string,
  callback: CacheInvalidationCallback
): Promise<(() => void) | null> {
  const baseClient = getRedisClient();
  if (!baseClient) return null;

  const registration: CacheInvalidationRegistration = {
    callback,
    // 订阅建立前缓存可能已经加载；首次 SUBSCRIBE 成功也必须从权威存储对齐一次。
    needsResync: true,
  };
  const registrations = subscriptions.get(channel) ?? new Set<CacheInvalidationRegistration>();
  registrations.add(registration);
  subscriptions.set(channel, registrations);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;

    const current = subscriptions.get(channel);
    if (!current) return;

    current.delete(registration);
    if (current.size > 0) return;

    subscriptions.delete(channel);
    subscribedChannels.delete(channel);
    if (subscriberClient) {
      void Promise.resolve(subscriberClient.unsubscribe(channel)).catch(() => undefined);
    }

    if (!hasDesiredSubscriptions()) {
      subscriptionRetryFailures = 0;
      clearSubscriptionRetryTimer();
    }
  };

  try {
    const sub = await ensureSubscriber(baseClient);
    const subscribed = await ensureChannelSubscribed(sub, channel);
    if (subscribed) {
      markSubscriptionsHealthy();
    } else {
      scheduleSubscriptionRetry();
    }
  } catch {
    // 回调仍保留在 desired subscriptions 中，后台恢复后会自动订阅并强制 resync。
    scheduleSubscriptionRetry();
  }

  return cleanup;
}
