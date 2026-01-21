"use client";

import { AlertTriangle, DollarSign, Settings2, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type {
  ClientActionResult,
  NotificationBindingState,
  NotificationSettingsState,
  WebhookTargetState,
} from "../_lib/hooks";
import type { NotificationType } from "../_lib/schemas";
import { BindingSelector } from "./binding-selector";

interface NotificationTypeCardProps {
  type: NotificationType;
  settings: NotificationSettingsState;
  targets: WebhookTargetState[];
  bindings: NotificationBindingState[];
  onUpdateSettings: (
    patch: Partial<NotificationSettingsState>
  ) => Promise<ClientActionResult<void>>;
  onSaveBindings: BindingSelectorProps["onSave"];
}

type BindingSelectorProps = ComponentProps<typeof BindingSelector>;

interface TypeConfig {
  iconColor: string;
  iconBgColor: string;
  borderColor: string;
  IconComponent: typeof AlertTriangle | typeof TrendingUp | typeof DollarSign;
}

function getTypeConfig(type: NotificationType): TypeConfig {
  switch (type) {
    case "circuit_breaker":
      return {
        iconColor: "text-red-400",
        iconBgColor: "bg-red-500/10",
        borderColor: "border-red-500/20 hover:border-red-500/30",
        IconComponent: AlertTriangle,
      };
    case "daily_leaderboard":
      return {
        iconColor: "text-green-400",
        iconBgColor: "bg-green-500/10",
        borderColor: "border-border/50 hover:border-border",
        IconComponent: TrendingUp,
      };
    case "cost_alert":
      return {
        iconColor: "text-yellow-400",
        iconBgColor: "bg-yellow-500/10",
        borderColor: "border-border/50 hover:border-border",
        IconComponent: DollarSign,
      };
  }
}

export function NotificationTypeCard({
  type,
  settings,
  targets,
  bindings,
  onUpdateSettings,
  onSaveBindings,
}: NotificationTypeCardProps) {
  const t = useTranslations("settings");
  const typeConfig = getTypeConfig(type);

  const meta = useMemo(() => {
    switch (type) {
      case "circuit_breaker":
        return {
          title: t("notifications.circuitBreaker.title"),
          description: t("notifications.circuitBreaker.description"),
          enabled: settings.circuitBreakerEnabled,
          enabledKey: "circuitBreakerEnabled" as const,
          enableLabel: t("notifications.circuitBreaker.enable"),
        };
      case "daily_leaderboard":
        return {
          title: t("notifications.dailyLeaderboard.title"),
          description: t("notifications.dailyLeaderboard.description"),
          enabled: settings.dailyLeaderboardEnabled,
          enabledKey: "dailyLeaderboardEnabled" as const,
          enableLabel: t("notifications.dailyLeaderboard.enable"),
        };
      case "cost_alert":
        return {
          title: t("notifications.costAlert.title"),
          description: t("notifications.costAlert.description"),
          enabled: settings.costAlertEnabled,
          enabledKey: "costAlertEnabled" as const,
          enableLabel: t("notifications.costAlert.enable"),
        };
    }
  }, [settings, t, type]);

  const enabled = meta.enabled;

  const bindingEnabledCount = useMemo(() => {
    return bindings.filter((b) => b.isEnabled && b.target.isEnabled).length;
  }, [bindings]);

  const IconComponent = typeConfig.IconComponent;

  return (
    <div
      className={cn(
        "rounded-xl border bg-card/30 backdrop-blur-sm transition-colors",
        typeConfig.borderColor
      )}
    >
      {/* Compact Header with toggle */}
      <div className="p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              "w-10 h-10 flex items-center justify-center rounded-xl shrink-0",
              typeConfig.iconBgColor
            )}
          >
            <IconComponent className={cn("h-5 w-5", typeConfig.iconColor)} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground">{meta.title}</p>
              <Badge variant="secondary" className="text-[10px]">
                {bindings.length}
              </Badge>
              {bindingEnabledCount > 0 && (
                <Badge variant="default" className="text-[10px]">
                  {bindingEnabledCount}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{meta.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span
            className={cn(
              "text-xs font-medium px-2 py-0.5 rounded-full",
              enabled ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground"
            )}
          >
            {enabled ? t("notifications.global.on") : t("notifications.global.off")}
          </span>
          <Switch
            id={`${type}-enabled`}
            checked={enabled}
            disabled={!settings.enabled}
            onCheckedChange={(checked) => onUpdateSettings({ [meta.enabledKey]: checked } as any)}
          />
        </div>
      </div>

      {/* Expandable content when enabled */}
      {enabled && (
        <div className="border-t border-border/50 p-4 space-y-4">
          {/* Type-specific settings */}
          {type === "daily_leaderboard" && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <label
                  htmlFor="dailyLeaderboardTime"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t("notifications.dailyLeaderboard.time")}
                </label>
                <input
                  id="dailyLeaderboardTime"
                  type="time"
                  value={settings.dailyLeaderboardTime}
                  disabled={!settings.enabled}
                  onChange={(e) => onUpdateSettings({ dailyLeaderboardTime: e.target.value })}
                  className={cn(
                    "w-full bg-muted/50 border border-border rounded-lg py-2 px-3 text-sm text-foreground",
                    "focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="dailyLeaderboardTopN"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t("notifications.dailyLeaderboard.topN")}
                </label>
                <input
                  id="dailyLeaderboardTopN"
                  type="number"
                  min={1}
                  max={20}
                  value={settings.dailyLeaderboardTopN}
                  disabled={!settings.enabled}
                  onChange={(e) =>
                    onUpdateSettings({ dailyLeaderboardTopN: Number(e.target.value) })
                  }
                  className={cn(
                    "w-full bg-muted/50 border border-border rounded-lg py-2 px-3 text-sm text-foreground",
                    "focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                />
              </div>
            </div>
          )}

          {type === "cost_alert" && (
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t("notifications.costAlert.threshold")}
                  </label>
                  <span className="text-sm font-mono font-semibold text-primary">
                    {Math.round(settings.costAlertThreshold * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={1.0}
                  step={0.05}
                  value={settings.costAlertThreshold}
                  disabled={!settings.enabled}
                  onChange={(e) => onUpdateSettings({ costAlertThreshold: Number(e.target.value) })}
                  className="w-full h-1.5 bg-muted rounded-full appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed accent-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="costAlertCheckInterval"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t("notifications.costAlert.interval")}
                </label>
                <input
                  id="costAlertCheckInterval"
                  type="number"
                  min={10}
                  max={1440}
                  value={settings.costAlertCheckInterval}
                  disabled={!settings.enabled}
                  onChange={(e) =>
                    onUpdateSettings({ costAlertCheckInterval: Number(e.target.value) })
                  }
                  className={cn(
                    "w-full bg-muted/50 border border-border rounded-lg py-2 px-3 text-sm text-foreground",
                    "focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                />
              </div>
            </div>
          )}

          {/* Bindings */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">
                {t("notifications.bindings.title")}
              </span>
            </div>
            <BindingSelector
              type={type}
              targets={targets}
              bindings={bindings}
              onSave={onSaveBindings}
            />
          </div>
        </div>
      )}
    </div>
  );
}
