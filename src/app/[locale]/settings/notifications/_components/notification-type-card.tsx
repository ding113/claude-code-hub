"use client";

import { AlertTriangle, DollarSign, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
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

function getIcon(type: NotificationType) {
  switch (type) {
    case "circuit_breaker":
      return <AlertTriangle className="h-5 w-5 text-destructive" />;
    case "daily_leaderboard":
      return <TrendingUp className="h-5 w-5" />;
    case "cost_alert":
      return <DollarSign className="h-5 w-5" />;
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            {getIcon(type)}
            <span>{meta.title}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              {t("notifications.bindings.boundCount", { count: bindings.length })}
            </Badge>
            <Badge variant={bindingEnabledCount > 0 ? "default" : "secondary"}>
              {t("notifications.bindings.enabledCount", { count: bindingEnabledCount })}
            </Badge>
          </div>
        </CardTitle>
        <CardDescription>{meta.description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={`${type}-enabled`}>{meta.enableLabel}</Label>
          <Switch
            id={`${type}-enabled`}
            checked={enabled}
            disabled={!settings.enabled}
            onCheckedChange={(checked) => onUpdateSettings({ [meta.enabledKey]: checked } as any)}
          />
        </div>

        {type === "daily_leaderboard" ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dailyLeaderboardTime">
                {t("notifications.dailyLeaderboard.time")}
              </Label>
              <Input
                id="dailyLeaderboardTime"
                type="time"
                value={settings.dailyLeaderboardTime}
                disabled={!settings.enabled || !enabled}
                onChange={(e) => onUpdateSettings({ dailyLeaderboardTime: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dailyLeaderboardTopN">
                {t("notifications.dailyLeaderboard.topN")}
              </Label>
              <Input
                id="dailyLeaderboardTopN"
                type="number"
                min={1}
                max={20}
                value={settings.dailyLeaderboardTopN}
                disabled={!settings.enabled || !enabled}
                onChange={(e) => onUpdateSettings({ dailyLeaderboardTopN: Number(e.target.value) })}
              />
            </div>
          </div>
        ) : null}

        {type === "cost_alert" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Label>{t("notifications.costAlert.threshold")}</Label>
                <Badge variant="secondary">{Math.round(settings.costAlertThreshold * 100)}%</Badge>
              </div>
              <Slider
                value={[settings.costAlertThreshold]}
                min={0.5}
                max={1.0}
                step={0.05}
                disabled={!settings.enabled || !enabled}
                onValueChange={([v]) => onUpdateSettings({ costAlertThreshold: v })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="costAlertCheckInterval">
                {t("notifications.costAlert.interval")}
              </Label>
              <Input
                id="costAlertCheckInterval"
                type="number"
                min={10}
                max={1440}
                value={settings.costAlertCheckInterval}
                disabled={!settings.enabled || !enabled}
                onChange={(e) =>
                  onUpdateSettings({ costAlertCheckInterval: Number(e.target.value) })
                }
              />
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label>{t("notifications.bindings.title")}</Label>
          <BindingSelector
            type={type}
            targets={targets}
            bindings={bindings}
            onSave={onSaveBindings}
          />
        </div>
      </CardContent>
    </Card>
  );
}
