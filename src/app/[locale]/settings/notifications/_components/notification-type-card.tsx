"use client";

import { AlertTriangle, DollarSign, Loader2, TestTube, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  onTestLegacyWebhook: (
    type: NotificationType,
    webhookUrl: string
  ) => Promise<ClientActionResult<void>>;
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
  onTestLegacyWebhook,
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
          webhookKey: "circuitBreakerWebhook" as const,
          webhookValue: settings.circuitBreakerWebhook,
          webhookLabel: t("notifications.circuitBreaker.webhook"),
          webhookPlaceholder: t("notifications.circuitBreaker.webhookPlaceholder"),
          webhookTestLabel: t("notifications.circuitBreaker.test"),
        };
      case "daily_leaderboard":
        return {
          title: t("notifications.dailyLeaderboard.title"),
          description: t("notifications.dailyLeaderboard.description"),
          enabled: settings.dailyLeaderboardEnabled,
          enabledKey: "dailyLeaderboardEnabled" as const,
          enableLabel: t("notifications.dailyLeaderboard.enable"),
          webhookKey: "dailyLeaderboardWebhook" as const,
          webhookValue: settings.dailyLeaderboardWebhook,
          webhookLabel: t("notifications.dailyLeaderboard.webhook"),
          webhookPlaceholder: t("notifications.dailyLeaderboard.webhookPlaceholder"),
          webhookTestLabel: t("notifications.dailyLeaderboard.test"),
        };
      case "cost_alert":
        return {
          title: t("notifications.costAlert.title"),
          description: t("notifications.costAlert.description"),
          enabled: settings.costAlertEnabled,
          enabledKey: "costAlertEnabled" as const,
          enableLabel: t("notifications.costAlert.enable"),
          webhookKey: "costAlertWebhook" as const,
          webhookValue: settings.costAlertWebhook,
          webhookLabel: t("notifications.costAlert.webhook"),
          webhookPlaceholder: t("notifications.costAlert.webhookPlaceholder"),
          webhookTestLabel: t("notifications.costAlert.test"),
        };
    }
  }, [settings, t, type]);

  const enabled = meta.enabled;
  const useLegacyMode = settings.useLegacyMode;

  const bindingEnabledCount = useMemo(() => {
    return bindings.filter((b) => b.isEnabled && b.target.isEnabled).length;
  }, [bindings]);

  const legacyWebhookInputRef = useRef<HTMLInputElement>(null);
  const [legacyWebhookUrl, setLegacyWebhookUrl] = useState(meta.webhookValue ?? "");
  const [isTestingLegacy, setIsTestingLegacy] = useState(false);

  useEffect(() => {
    if (
      typeof document !== "undefined" &&
      document.activeElement === legacyWebhookInputRef.current
    ) {
      return;
    }
    setLegacyWebhookUrl(meta.webhookValue ?? "");
  }, [meta.webhookValue]);

  const saveLegacyWebhook = async () => {
    const patch = { [meta.webhookKey]: legacyWebhookUrl } as Partial<NotificationSettingsState>;
    await onUpdateSettings(patch);
  };

  const testLegacyWebhook = async () => {
    setIsTestingLegacy(true);
    try {
      const result = await onTestLegacyWebhook(type, legacyWebhookUrl);
      if (result.ok) {
        toast.success(t("notifications.form.testSuccess"));
      } else {
        toast.error(result.error || t("notifications.form.testFailed"));
      }
    } finally {
      setIsTestingLegacy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            {getIcon(type)}
            <span>{meta.title}</span>
          </div>
          {!useLegacyMode ? (
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                {t("notifications.bindings.boundCount", { count: bindings.length })}
              </Badge>
              <Badge variant={bindingEnabledCount > 0 ? "default" : "secondary"}>
                {t("notifications.bindings.enabledCount", { count: bindingEnabledCount })}
              </Badge>
            </div>
          ) : null}
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

        {useLegacyMode ? (
          <div className="space-y-2">
            <Label htmlFor={`${type}-legacy-webhook`}>{meta.webhookLabel}</Label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                ref={legacyWebhookInputRef}
                id={`${type}-legacy-webhook`}
                value={legacyWebhookUrl}
                placeholder={meta.webhookPlaceholder}
                disabled={!settings.enabled || !enabled}
                onChange={(e) => setLegacyWebhookUrl(e.target.value)}
                onBlur={saveLegacyWebhook}
              />
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                disabled={!settings.enabled || !enabled || isTestingLegacy}
                onClick={testLegacyWebhook}
              >
                {isTestingLegacy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <TestTube className="mr-2 h-4 w-4" />
                )}
                {meta.webhookTestLabel}
              </Button>
            </div>
          </div>
        ) : null}

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

        {!useLegacyMode ? (
          <div className="space-y-2">
            <Label>{t("notifications.bindings.title")}</Label>
            <BindingSelector
              type={type}
              targets={targets}
              bindings={bindings}
              onSave={onSaveBindings}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
