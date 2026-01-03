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
];

function toClientSettings(raw: any): NotificationSettingsState {
  return {
    enabled: Boolean(raw?.enabled),
    circuitBreakerEnabled: Boolean(raw?.circuitBreakerEnabled),
    circuitBreakerWebhook: raw?.circuitBreakerWebhook || "",
    dailyLeaderboardEnabled: Boolean(raw?.dailyLeaderboardEnabled),
    dailyLeaderboardWebhook: raw?.dailyLeaderboardWebhook || "",
    dailyLeaderboardTime: raw?.dailyLeaderboardTime || "09:00",
    dailyLeaderboardTopN: Number(raw?.dailyLeaderboardTopN || 5),
    costAlertEnabled: Boolean(raw?.costAlertEnabled),
    costAlertWebhook: raw?.costAlertWebhook || "",
    costAlertThreshold: parseFloat(raw?.costAlertThreshold || "0.80"),
    costAlertCheckInterval: Number(raw?.costAlertCheckInterval || 60),
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
    setTargets(result.data as WebhookTargetState[]);
  }, []);

  const refreshBindingsForType = useCallback(async (type: NotificationType) => {
    const result = await getBindingsForTypeAction(type);
    if (!result.ok) {
      throw new Error(result.error || "LOAD_BINDINGS_FAILED");
    }
    setBindingsByType((prev) => ({ ...prev, [type]: result.data as NotificationBindingState[] }));
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
        payload.dailyLeaderboardTopN = patch.dailyLeaderboardTopN;
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
        payload.costAlertThreshold = patch.costAlertThreshold.toString();
      }
      if (patch.costAlertCheckInterval !== undefined) {
        payload.costAlertCheckInterval = patch.costAlertCheckInterval;
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
