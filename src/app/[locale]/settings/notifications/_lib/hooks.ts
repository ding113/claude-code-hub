"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getBindingsForTypeAction, updateBindingsAction } from "@/actions/notification-bindings";
import {
  getNotificationSettingsAction,
  updateNotificationSettingsAction,
} from "@/actions/notifications";
import {
  createWebhookTargetAction,
  deleteWebhookTargetAction,
  getWebhookTargetsAction,
  testWebhookTargetAction,
  updateWebhookTargetAction,
} from "@/actions/webhook-targets";
import {
  type CacheHitRateAlertSettingsWindowMode,
  isCacheHitRateAlertSettingsWindowMode,
} from "@/lib/webhook/types";
import type { NotificationType, WebhookProviderType } from "./schemas";

export interface ClientActionResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface NotificationSettingsState {
  enabled: boolean;

  circuitBreakerEnabled: boolean;
  circuitBreakerWebhook: string;
  dailyLeaderboardEnabled: boolean;
  dailyLeaderboardWebhook: string;
  dailyLeaderboardTime: string;
  dailyLeaderboardTopN: number;

  costAlertEnabled: boolean;
  costAlertWebhook: string;
  costAlertThreshold: number;
  costAlertCheckInterval: number;

  cacheHitRateAlertEnabled: boolean;
  cacheHitRateAlertWindowMode: CacheHitRateAlertSettingsWindowMode;
  cacheHitRateAlertCheckInterval: number;
  cacheHitRateAlertHistoricalLookbackDays: number;
  cacheHitRateAlertMinEligibleRequests: number;
  cacheHitRateAlertMinEligibleTokens: number;
  cacheHitRateAlertAbsMin: number;
  cacheHitRateAlertDropRel: number;
  cacheHitRateAlertDropAbs: number;
  cacheHitRateAlertCooldownMinutes: number;
  cacheHitRateAlertTopN: number;
}

export interface WebhookTestResult {
  success: boolean;
  error?: string;
  latencyMs?: number;
}

export interface WebhookTargetState {
  id: number;
  name: string;
  providerType: WebhookProviderType;

  webhookUrl: string | null;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  dingtalkSecret: string | null;
  customTemplate: Record<string, unknown> | null;
  customHeaders: Record<string, string> | null;
  proxyUrl: string | null;
  proxyFallbackToDirect: boolean;

  isEnabled: boolean;
  lastTestAt: string | Date | null;
  lastTestResult: WebhookTestResult | null;
}

export interface WebhookTargetCreateInput {
  name: string;
  providerType: WebhookProviderType;
  webhookUrl?: string | null;
  telegramBotToken?: string | null;
  telegramChatId?: string | null;
  dingtalkSecret?: string | null;
  customTemplate?: Record<string, unknown> | null;
  customHeaders?: Record<string, string> | null;
  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;
  isEnabled?: boolean;
}

export type WebhookTargetUpdateInput = Partial<WebhookTargetCreateInput>;

export interface NotificationBindingState {
  id: number;
  notificationType: NotificationType;
  targetId: number;
  isEnabled: boolean;
  scheduleCron: string | null;
  scheduleTimezone: string | null;
  templateOverride: Record<string, unknown> | null;
  createdAt: string | Date | null;
  target: WebhookTargetState;
}

export const NOTIFICATION_TYPES: NotificationType[] = [
  "circuit_breaker",
  "daily_leaderboard",
  "cost_alert",
  "cache_hit_rate_alert",
];

const INT32_MAX = 2_147_483_647;

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = toFiniteNumber(value);
  if (n == null) return fallback;
  const intValue = Math.trunc(n);
  return clampNumber(intValue, min, max);
}

function toBoundedFloat(value: unknown, fallback: number, min: number, max: number): number {
  const n = toFiniteNumber(value);
  if (n == null) return fallback;
  return clampNumber(n, min, max);
}

function normalizeIntPatch(value: number, min: number, max: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value)) return undefined;
  if (value < min || value > max) return undefined;
  return value;
}

function normalizeFloatPatch(value: number, min: number, max: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  if (value < min || value > max) return undefined;
  return value;
}

function toClientSettings(raw: any): NotificationSettingsState {
  const cacheHitRateAlertWindowMode = isCacheHitRateAlertSettingsWindowMode(
    raw?.cacheHitRateAlertWindowMode
  )
    ? raw.cacheHitRateAlertWindowMode
    : "auto";

  return {
    enabled: Boolean(raw?.enabled),
    circuitBreakerEnabled: Boolean(raw?.circuitBreakerEnabled),
    circuitBreakerWebhook: raw?.circuitBreakerWebhook || "",
    dailyLeaderboardEnabled: Boolean(raw?.dailyLeaderboardEnabled),
    dailyLeaderboardWebhook: raw?.dailyLeaderboardWebhook || "",
    dailyLeaderboardTime: raw?.dailyLeaderboardTime || "09:00",
    dailyLeaderboardTopN: toBoundedInt(raw?.dailyLeaderboardTopN, 5, 1, 20),
    costAlertEnabled: Boolean(raw?.costAlertEnabled),
    costAlertWebhook: raw?.costAlertWebhook || "",
    costAlertThreshold: toBoundedFloat(raw?.costAlertThreshold, 0.8, 0.5, 1.0),
    costAlertCheckInterval: toBoundedInt(raw?.costAlertCheckInterval, 60, 10, 1440),
    cacheHitRateAlertEnabled: Boolean(raw?.cacheHitRateAlertEnabled),
    cacheHitRateAlertWindowMode,
    cacheHitRateAlertCheckInterval: toBoundedInt(raw?.cacheHitRateAlertCheckInterval, 5, 1, 1440),
    cacheHitRateAlertHistoricalLookbackDays: toBoundedInt(
      raw?.cacheHitRateAlertHistoricalLookbackDays,
      7,
      1,
      90
    ),
    cacheHitRateAlertMinEligibleRequests: toBoundedInt(
      raw?.cacheHitRateAlertMinEligibleRequests,
      20,
      1,
      100000
    ),
    cacheHitRateAlertMinEligibleTokens: toBoundedInt(
      raw?.cacheHitRateAlertMinEligibleTokens,
      0,
      0,
      INT32_MAX
    ),
    cacheHitRateAlertAbsMin: toBoundedFloat(raw?.cacheHitRateAlertAbsMin, 0.05, 0, 1),
    cacheHitRateAlertDropRel: toBoundedFloat(raw?.cacheHitRateAlertDropRel, 0.3, 0, 1),
    cacheHitRateAlertDropAbs: toBoundedFloat(raw?.cacheHitRateAlertDropAbs, 0.1, 0, 1),
    cacheHitRateAlertCooldownMinutes: toBoundedInt(
      raw?.cacheHitRateAlertCooldownMinutes,
      30,
      0,
      1440
    ),
    cacheHitRateAlertTopN: toBoundedInt(raw?.cacheHitRateAlertTopN, 10, 1, 100),
  };
}

export function useNotificationsPageData() {
  const [settings, setSettings] = useState<NotificationSettingsState | null>(null);
  const [targets, setTargets] = useState<WebhookTargetState[]>([]);
  const [bindingsByType, setBindingsByType] = useState<
    Record<NotificationType, NotificationBindingState[]>
  >(() => ({
    circuit_breaker: [],
    daily_leaderboard: [],
    cost_alert: [],
    cache_hit_rate_alert: [],
  }));

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshSettings = useCallback(async () => {
    const raw = await getNotificationSettingsAction();
    setSettings(toClientSettings(raw));
  }, []);

  const refreshTargets = useCallback(async () => {
    const result = await getWebhookTargetsAction();
    if (!result.ok) {
      throw new Error(result.error || "LOAD_TARGETS_FAILED");
    }
    setTargets(result.data);
  }, []);

  const refreshBindingsForType = useCallback(async (type: NotificationType) => {
    const result = await getBindingsForTypeAction(type);
    if (!result.ok) {
      throw new Error(result.error || "LOAD_BINDINGS_FAILED");
    }
    setBindingsByType((prev) => ({ ...prev, [type]: result.data }));
  }, []);

  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      await Promise.all([
        refreshSettings(),
        refreshTargets(),
        ...NOTIFICATION_TYPES.map((type) => refreshBindingsForType(type)),
      ]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "LOAD_FAILED");
    } finally {
      setIsLoading(false);
    }
  }, [refreshBindingsForType, refreshSettings, refreshTargets]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const updateSettings = useCallback(
    async (patch: Partial<NotificationSettingsState>): Promise<ClientActionResult<void>> => {
      type UpdatePayload = Parameters<typeof updateNotificationSettingsAction>[0];
      const payload: UpdatePayload = {};

      if (patch.enabled !== undefined) {
        payload.enabled = patch.enabled;
      }

      if (patch.circuitBreakerEnabled !== undefined) {
        payload.circuitBreakerEnabled = patch.circuitBreakerEnabled;
      }
      if (patch.circuitBreakerWebhook !== undefined) {
        payload.circuitBreakerWebhook = patch.circuitBreakerWebhook?.trim()
          ? patch.circuitBreakerWebhook.trim()
          : null;
      }

      if (patch.dailyLeaderboardEnabled !== undefined) {
        payload.dailyLeaderboardEnabled = patch.dailyLeaderboardEnabled;
      }
      if (patch.dailyLeaderboardWebhook !== undefined) {
        payload.dailyLeaderboardWebhook = patch.dailyLeaderboardWebhook?.trim()
          ? patch.dailyLeaderboardWebhook.trim()
          : null;
      }
      if (patch.dailyLeaderboardTime !== undefined) {
        payload.dailyLeaderboardTime = patch.dailyLeaderboardTime;
      }
      if (patch.dailyLeaderboardTopN !== undefined) {
        const nextValue = normalizeIntPatch(patch.dailyLeaderboardTopN, 1, 20);
        if (nextValue !== undefined) {
          payload.dailyLeaderboardTopN = nextValue;
        }
      }

      if (patch.costAlertEnabled !== undefined) {
        payload.costAlertEnabled = patch.costAlertEnabled;
      }
      if (patch.costAlertWebhook !== undefined) {
        payload.costAlertWebhook = patch.costAlertWebhook?.trim()
          ? patch.costAlertWebhook.trim()
          : null;
      }
      if (patch.costAlertThreshold !== undefined) {
        const nextValue = normalizeFloatPatch(patch.costAlertThreshold, 0.5, 1.0);
        if (nextValue !== undefined) {
          payload.costAlertThreshold = nextValue.toFixed(2);
        }
      }
      if (patch.costAlertCheckInterval !== undefined) {
        const nextValue = normalizeIntPatch(patch.costAlertCheckInterval, 10, 1440);
        if (nextValue !== undefined) {
          payload.costAlertCheckInterval = nextValue;
        }
      }

      if (patch.cacheHitRateAlertEnabled !== undefined) {
        payload.cacheHitRateAlertEnabled = patch.cacheHitRateAlertEnabled;
      }
      if (patch.cacheHitRateAlertWindowMode !== undefined) {
        payload.cacheHitRateAlertWindowMode = patch.cacheHitRateAlertWindowMode;
      }
      if (patch.cacheHitRateAlertCheckInterval !== undefined) {
        const nextValue = normalizeIntPatch(patch.cacheHitRateAlertCheckInterval, 1, 1440);
        if (nextValue !== undefined) {
          payload.cacheHitRateAlertCheckInterval = nextValue;
        }
      }
      if (patch.cacheHitRateAlertHistoricalLookbackDays !== undefined) {
        const nextValue = normalizeIntPatch(patch.cacheHitRateAlertHistoricalLookbackDays, 1, 90);
        if (nextValue !== undefined) {
          payload.cacheHitRateAlertHistoricalLookbackDays = nextValue;
        }
      }
      if (patch.cacheHitRateAlertMinEligibleRequests !== undefined) {
        const nextValue = normalizeIntPatch(patch.cacheHitRateAlertMinEligibleRequests, 1, 100000);
        if (nextValue !== undefined) {
          payload.cacheHitRateAlertMinEligibleRequests = nextValue;
        }
      }
      if (patch.cacheHitRateAlertMinEligibleTokens !== undefined) {
        const nextValue = normalizeIntPatch(patch.cacheHitRateAlertMinEligibleTokens, 0, INT32_MAX);
        if (nextValue !== undefined) {
          payload.cacheHitRateAlertMinEligibleTokens = nextValue;
        }
      }
      if (patch.cacheHitRateAlertAbsMin !== undefined) {
        const nextValue = normalizeFloatPatch(patch.cacheHitRateAlertAbsMin, 0, 1);
        if (nextValue !== undefined) {
          payload.cacheHitRateAlertAbsMin = nextValue.toFixed(4);
        }
      }
      if (patch.cacheHitRateAlertDropRel !== undefined) {
        const nextValue = normalizeFloatPatch(patch.cacheHitRateAlertDropRel, 0, 1);
        if (nextValue !== undefined) {
          payload.cacheHitRateAlertDropRel = nextValue.toFixed(4);
        }
      }
      if (patch.cacheHitRateAlertDropAbs !== undefined) {
        const nextValue = normalizeFloatPatch(patch.cacheHitRateAlertDropAbs, 0, 1);
        if (nextValue !== undefined) {
          payload.cacheHitRateAlertDropAbs = nextValue.toFixed(4);
        }
      }
      if (patch.cacheHitRateAlertCooldownMinutes !== undefined) {
        const nextValue = normalizeIntPatch(patch.cacheHitRateAlertCooldownMinutes, 0, 1440);
        if (nextValue !== undefined) {
          payload.cacheHitRateAlertCooldownMinutes = nextValue;
        }
      }
      if (patch.cacheHitRateAlertTopN !== undefined) {
        const nextValue = normalizeIntPatch(patch.cacheHitRateAlertTopN, 1, 100);
        if (nextValue !== undefined) {
          payload.cacheHitRateAlertTopN = nextValue;
        }
      }

      const result = await updateNotificationSettingsAction(payload);

      if (!result.ok) {
        return { ok: false, error: result.error || "SAVE_FAILED" };
      }

      setSettings(toClientSettings(result.data));
      return { ok: true };
    },
    []
  );

  const saveBindings = useCallback(
    async (
      type: NotificationType,
      bindings: Array<{
        targetId: number;
        isEnabled?: boolean;
        scheduleCron?: string | null;
        scheduleTimezone?: string | null;
        templateOverride?: Record<string, unknown> | null;
      }>
    ) => {
      const result = await updateBindingsAction(type, bindings);
      if (result.ok) {
        await refreshBindingsForType(type);
      }
      return result;
    },
    [refreshBindingsForType]
  );

  const createTarget = useCallback(
    async (input: WebhookTargetCreateInput): Promise<ClientActionResult<WebhookTargetState>> => {
      const result = await createWebhookTargetAction(input);
      if (result.ok) {
        await Promise.all([
          refreshTargets(),
          ...NOTIFICATION_TYPES.map((type) => refreshBindingsForType(type)),
          refreshSettings(),
        ]);
      }
      return result;
    },
    [refreshBindingsForType, refreshSettings, refreshTargets]
  );

  const updateTarget = useCallback(
    async (
      id: number,
      input: WebhookTargetUpdateInput
    ): Promise<ClientActionResult<WebhookTargetState>> => {
      const result = await updateWebhookTargetAction(id, input);
      if (result.ok) {
        await Promise.all([
          refreshTargets(),
          ...NOTIFICATION_TYPES.map((type) => refreshBindingsForType(type)),
        ]);
      }
      return result;
    },
    [refreshBindingsForType, refreshTargets]
  );

  const deleteTarget = useCallback(
    async (id: number): Promise<ClientActionResult<void>> => {
      const result = await deleteWebhookTargetAction(id);
      if (result.ok) {
        await Promise.all([
          refreshTargets(),
          ...NOTIFICATION_TYPES.map((type) => refreshBindingsForType(type)),
        ]);
      }
      return result;
    },
    [refreshBindingsForType, refreshTargets]
  );

  const testTarget = useCallback(
    async (
      id: number,
      type: NotificationType
    ): Promise<ClientActionResult<{ latencyMs: number }>> => {
      const result = await testWebhookTargetAction(id, type);
      if (result.ok) {
        await refreshTargets();
      }
      return result;
    },
    [refreshTargets]
  );

  const bindingsCount = useMemo(() => {
    return NOTIFICATION_TYPES.reduce((acc, type) => acc + (bindingsByType[type]?.length ?? 0), 0);
  }, [bindingsByType]);

  return {
    settings,
    targets,
    bindingsByType,
    bindingsCount,
    isLoading,
    loadError,

    refreshAll,
    refreshSettings,
    refreshTargets,
    refreshBindingsForType,

    updateSettings,
    saveBindings,

    createTarget,
    updateTarget,
    deleteTarget,
    testTarget,
  };
}
