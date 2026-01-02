"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getBindingsForTypeAction, updateBindingsAction } from "@/actions/notification-bindings";
import {
  getNotificationSettingsAction,
  testWebhookAction,
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
  useLegacyMode: boolean;

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
    useLegacyMode: Boolean(raw?.useLegacyMode),
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
      throw new Error(result.error || "加载推送目标失败");
    }
    setTargets(result.data as WebhookTargetState[]);
  }, []);

  const refreshBindingsForType = useCallback(async (type: NotificationType) => {
    const result = await getBindingsForTypeAction(type);
    if (!result.ok) {
      throw new Error(result.error || "加载通知绑定失败");
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
      setLoadError(error instanceof Error ? error.message : "加载失败");
    } finally {
      setIsLoading(false);
    }
  }, [refreshBindingsForType, refreshSettings, refreshTargets]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const updateSettings = useCallback(
    async (patch: Partial<NotificationSettingsState>) => {
      const result = await updateNotificationSettingsAction({
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.useLegacyMode !== undefined ? { useLegacyMode: patch.useLegacyMode } : {}),
        ...(patch.circuitBreakerEnabled !== undefined
          ? { circuitBreakerEnabled: patch.circuitBreakerEnabled }
          : {}),
        ...(patch.circuitBreakerWebhook !== undefined
          ? {
              circuitBreakerWebhook: patch.circuitBreakerWebhook?.trim()
                ? patch.circuitBreakerWebhook.trim()
                : null,
            }
          : {}),
        ...(patch.dailyLeaderboardEnabled !== undefined
          ? { dailyLeaderboardEnabled: patch.dailyLeaderboardEnabled }
          : {}),
        ...(patch.dailyLeaderboardWebhook !== undefined
          ? {
              dailyLeaderboardWebhook: patch.dailyLeaderboardWebhook?.trim()
                ? patch.dailyLeaderboardWebhook.trim()
                : null,
            }
          : {}),
        ...(patch.dailyLeaderboardTime !== undefined
          ? { dailyLeaderboardTime: patch.dailyLeaderboardTime }
          : {}),
        ...(patch.dailyLeaderboardTopN !== undefined
          ? { dailyLeaderboardTopN: patch.dailyLeaderboardTopN }
          : {}),
        ...(patch.costAlertEnabled !== undefined
          ? { costAlertEnabled: patch.costAlertEnabled }
          : {}),
        ...(patch.costAlertWebhook !== undefined
          ? {
              costAlertWebhook: patch.costAlertWebhook?.trim()
                ? patch.costAlertWebhook.trim()
                : null,
            }
          : {}),
        ...(patch.costAlertThreshold !== undefined
          ? { costAlertThreshold: patch.costAlertThreshold.toString() }
          : {}),
        ...(patch.costAlertCheckInterval !== undefined
          ? { costAlertCheckInterval: patch.costAlertCheckInterval }
          : {}),
      } as any);

      if (!result.success) {
        return { ok: false, error: result.error || "保存失败" } as ClientActionResult<void>;
      }

      if (result.data) {
        setSettings(toClientSettings(result.data));
      } else {
        await refreshSettings();
      }

      return { ok: true } as ClientActionResult<void>;
    },
    [refreshSettings]
  );

  const testLegacyWebhook = useCallback(async (type: NotificationType, webhookUrl: string) => {
    const trimmed = webhookUrl.trim();
    if (!trimmed) {
      return { ok: false, error: "请先填写 Webhook URL" } as ClientActionResult<void>;
    }

    const jobType = (() => {
      switch (type) {
        case "circuit_breaker":
          return "circuit-breaker" as const;
        case "daily_leaderboard":
          return "daily-leaderboard" as const;
        case "cost_alert":
          return "cost-alert" as const;
      }
    })();

    const result = await testWebhookAction(trimmed, jobType);
    return result.success
      ? ({ ok: true } as ClientActionResult<void>)
      : ({ ok: false, error: result.error || "测试失败" } as ClientActionResult<void>);
  }, []);

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
      return result as ClientActionResult<void>;
    },
    [refreshBindingsForType]
  );

  const createTarget = useCallback(
    async (input: any) => {
      const result = await createWebhookTargetAction(input);
      if (result.ok) {
        await Promise.all([
          refreshTargets(),
          ...NOTIFICATION_TYPES.map((type) => refreshBindingsForType(type)),
          refreshSettings(),
        ]);
      }
      return result as ClientActionResult<WebhookTargetState>;
    },
    [refreshBindingsForType, refreshSettings, refreshTargets]
  );

  const updateTarget = useCallback(
    async (id: number, input: any) => {
      const result = await updateWebhookTargetAction(id, input);
      if (result.ok) {
        await Promise.all([
          refreshTargets(),
          ...NOTIFICATION_TYPES.map((type) => refreshBindingsForType(type)),
        ]);
      }
      return result as ClientActionResult<WebhookTargetState>;
    },
    [refreshBindingsForType, refreshTargets]
  );

  const deleteTarget = useCallback(
    async (id: number) => {
      const result = await deleteWebhookTargetAction(id);
      if (result.ok) {
        await Promise.all([
          refreshTargets(),
          ...NOTIFICATION_TYPES.map((type) => refreshBindingsForType(type)),
        ]);
      }
      return result as ClientActionResult<void>;
    },
    [refreshBindingsForType, refreshTargets]
  );

  const testTarget = useCallback(
    async (id: number, type: NotificationType) => {
      const result = await testWebhookTargetAction(id, type);
      if (result.ok) {
        await refreshTargets();
      }
      return result as ClientActionResult<{ latencyMs: number }>;
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
    testLegacyWebhook,
  };
}
