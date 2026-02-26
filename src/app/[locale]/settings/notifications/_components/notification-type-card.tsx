"use client";

import { AlertTriangle, Database, DollarSign, Settings2, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { isCacheHitRateAlertSettingsWindowMode } from "@/lib/webhook/types";
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
  IconComponent: typeof AlertTriangle | typeof TrendingUp | typeof DollarSign | typeof Database;
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
    case "cache_hit_rate_alert":
      return {
        iconColor: "text-blue-400",
        iconBgColor: "bg-blue-500/10",
        borderColor: "border-blue-500/20 hover:border-blue-500/30",
        IconComponent: Database,
      };
  }
}

const settingsControlClassName = cn(
  "w-full bg-muted/50 border border-border rounded-lg py-2 px-3 text-sm text-foreground",
  "focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all",
  "disabled:opacity-50 disabled:cursor-not-allowed"
);

function LabeledControl({
  id,
  label,
  children,
}: {
  id: string;
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

type SafeNumberOnChange = NonNullable<ComponentProps<"input">["onChange"]>;

type NumberInputConstraints = {
  min?: number;
  max?: number;
  integer?: boolean;
};

function safeNumberOnChange(
  onValidNumber: (value: number) => void,
  constraints: NumberInputConstraints = {}
): SafeNumberOnChange {
  return (e) => {
    const nextValue = e.currentTarget.valueAsNumber;
    if (!Number.isFinite(nextValue)) return;
    if (constraints.integer && !Number.isInteger(nextValue)) return;
    if (constraints.min !== undefined && nextValue < constraints.min) return;
    if (constraints.max !== undefined && nextValue > constraints.max) return;
    onValidNumber(nextValue);
  };
}

function createSettingsPatch<K extends keyof NotificationSettingsState>(
  key: K,
  value: NotificationSettingsState[K]
): Pick<NotificationSettingsState, K> {
  return { [key]: value } as Pick<NotificationSettingsState, K>;
}

/**
 * Controlled number input that allows temporary empty state while editing.
 *
 * The standard pattern of `value={state}` + `onChange={guard}` on `<input type="number">`
 * causes the input to "snap back" when the user clears it (backspace), because `valueAsNumber`
 * is `NaN` and the guard rejects the update. This component uses local string state to allow
 * the field to be cleared, then reverts to the last valid value on blur.
 */
function NumberInput({
  value,
  onValueChange,
  constraints,
  ...inputProps
}: Omit<ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: number;
  onValueChange: (value: number) => void;
  constraints?: NumberInputConstraints;
}) {
  const [localValue, setLocalValue] = useState(String(value));

  useEffect(() => {
    setLocalValue(String(value));
  }, [value]);

  return (
    <input
      {...inputProps}
      type="number"
      value={localValue}
      onChange={(e) => {
        const raw = e.currentTarget.value;
        setLocalValue(raw);

        const num = e.currentTarget.valueAsNumber;
        if (!Number.isFinite(num)) return;
        if (constraints?.integer && !Number.isInteger(num)) return;
        if (constraints?.min !== undefined && num < constraints.min) return;
        if (constraints?.max !== undefined && num > constraints.max) return;
        onValueChange(num);
      }}
      onBlur={() => {
        setLocalValue(String(value));
      }}
    />
  );
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

  type EnabledKey =
    | "circuitBreakerEnabled"
    | "dailyLeaderboardEnabled"
    | "costAlertEnabled"
    | "cacheHitRateAlertEnabled";

  type TypeMeta = {
    title: string;
    description: string;
    enabled: boolean;
    enabledKey: EnabledKey;
    enableLabel: string;
  };

  const meta = useMemo<TypeMeta>(() => {
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
      case "cache_hit_rate_alert":
        return {
          title: t("notifications.cacheHitRateAlert.title"),
          description: t("notifications.cacheHitRateAlert.description"),
          enabled: settings.cacheHitRateAlertEnabled,
          enabledKey: "cacheHitRateAlertEnabled" as const,
          enableLabel: t("notifications.cacheHitRateAlert.enable"),
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
            onCheckedChange={(checked) =>
              onUpdateSettings(createSettingsPatch(meta.enabledKey, checked))
            }
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
                <NumberInput
                  id="dailyLeaderboardTopN"
                  min={1}
                  max={20}
                  value={settings.dailyLeaderboardTopN}
                  disabled={!settings.enabled}
                  onValueChange={(v) => onUpdateSettings({ dailyLeaderboardTopN: v })}
                  constraints={{ integer: true, min: 1, max: 20 }}
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
                  onChange={safeNumberOnChange(
                    (nextValue) => onUpdateSettings({ costAlertThreshold: nextValue }),
                    { min: 0.5, max: 1.0 }
                  )}
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
                <NumberInput
                  id="costAlertCheckInterval"
                  min={10}
                  max={1440}
                  value={settings.costAlertCheckInterval}
                  disabled={!settings.enabled}
                  onValueChange={(v) => onUpdateSettings({ costAlertCheckInterval: v })}
                  constraints={{ integer: true, min: 10, max: 1440 }}
                  className={cn(
                    "w-full bg-muted/50 border border-border rounded-lg py-2 px-3 text-sm text-foreground",
                    "focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                />
              </div>
            </div>
          )}

          {type === "cache_hit_rate_alert" && (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <LabeledControl
                  id="cacheHitRateAlertWindowMode"
                  label={t("notifications.cacheHitRateAlert.windowMode")}
                >
                  <select
                    id="cacheHitRateAlertWindowMode"
                    value={settings.cacheHitRateAlertWindowMode}
                    disabled={!settings.enabled}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      if (!isCacheHitRateAlertSettingsWindowMode(nextValue)) return;
                      onUpdateSettings({ cacheHitRateAlertWindowMode: nextValue });
                    }}
                    className={settingsControlClassName}
                  >
                    <option value="auto">
                      {t("notifications.cacheHitRateAlert.windowModeAuto")}
                    </option>
                    <option value="5m">5m</option>
                    <option value="30m">30m</option>
                    <option value="1h">1h</option>
                    <option value="1.5h">1.5h</option>
                  </select>
                </LabeledControl>

                <LabeledControl
                  id="cacheHitRateAlertCheckInterval"
                  label={t("notifications.cacheHitRateAlert.checkInterval")}
                >
                  <NumberInput
                    id="cacheHitRateAlertCheckInterval"
                    min={1}
                    max={1440}
                    value={settings.cacheHitRateAlertCheckInterval}
                    disabled={!settings.enabled}
                    onValueChange={(v) => onUpdateSettings({ cacheHitRateAlertCheckInterval: v })}
                    constraints={{ integer: true, min: 1, max: 1440 }}
                    className={settingsControlClassName}
                  />
                </LabeledControl>

                <LabeledControl
                  id="cacheHitRateAlertHistoricalLookbackDays"
                  label={t("notifications.cacheHitRateAlert.historicalLookbackDays")}
                >
                  <NumberInput
                    id="cacheHitRateAlertHistoricalLookbackDays"
                    min={1}
                    max={90}
                    value={settings.cacheHitRateAlertHistoricalLookbackDays}
                    disabled={!settings.enabled}
                    onValueChange={(v) =>
                      onUpdateSettings({
                        cacheHitRateAlertHistoricalLookbackDays: v,
                      })
                    }
                    constraints={{ integer: true, min: 1, max: 90 }}
                    className={settingsControlClassName}
                  />
                </LabeledControl>

                <LabeledControl
                  id="cacheHitRateAlertCooldownMinutes"
                  label={t("notifications.cacheHitRateAlert.cooldownMinutes")}
                >
                  <NumberInput
                    id="cacheHitRateAlertCooldownMinutes"
                    min={0}
                    max={1440}
                    value={settings.cacheHitRateAlertCooldownMinutes}
                    disabled={!settings.enabled}
                    onValueChange={(v) => onUpdateSettings({ cacheHitRateAlertCooldownMinutes: v })}
                    constraints={{ integer: true, min: 0, max: 1440 }}
                    className={settingsControlClassName}
                  />
                </LabeledControl>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <LabeledControl
                  id="cacheHitRateAlertAbsMin"
                  label={t("notifications.cacheHitRateAlert.absMin")}
                >
                  <NumberInput
                    id="cacheHitRateAlertAbsMin"
                    min={0}
                    max={1}
                    step={0.01}
                    value={settings.cacheHitRateAlertAbsMin}
                    disabled={!settings.enabled}
                    onValueChange={(v) => onUpdateSettings({ cacheHitRateAlertAbsMin: v })}
                    constraints={{ min: 0, max: 1 }}
                    className={settingsControlClassName}
                  />
                </LabeledControl>

                <LabeledControl
                  id="cacheHitRateAlertDropAbs"
                  label={t("notifications.cacheHitRateAlert.dropAbs")}
                >
                  <NumberInput
                    id="cacheHitRateAlertDropAbs"
                    min={0}
                    max={1}
                    step={0.01}
                    value={settings.cacheHitRateAlertDropAbs}
                    disabled={!settings.enabled}
                    onValueChange={(v) => onUpdateSettings({ cacheHitRateAlertDropAbs: v })}
                    constraints={{ min: 0, max: 1 }}
                    className={settingsControlClassName}
                  />
                </LabeledControl>

                <LabeledControl
                  id="cacheHitRateAlertDropRel"
                  label={t("notifications.cacheHitRateAlert.dropRel")}
                >
                  <NumberInput
                    id="cacheHitRateAlertDropRel"
                    min={0}
                    max={1}
                    step={0.01}
                    value={settings.cacheHitRateAlertDropRel}
                    disabled={!settings.enabled}
                    onValueChange={(v) => onUpdateSettings({ cacheHitRateAlertDropRel: v })}
                    constraints={{ min: 0, max: 1 }}
                    className={settingsControlClassName}
                  />
                </LabeledControl>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <LabeledControl
                  id="cacheHitRateAlertMinEligibleRequests"
                  label={t("notifications.cacheHitRateAlert.minEligibleRequests")}
                >
                  <NumberInput
                    id="cacheHitRateAlertMinEligibleRequests"
                    min={1}
                    max={100000}
                    value={settings.cacheHitRateAlertMinEligibleRequests}
                    disabled={!settings.enabled}
                    onValueChange={(v) =>
                      onUpdateSettings({
                        cacheHitRateAlertMinEligibleRequests: v,
                      })
                    }
                    constraints={{ integer: true, min: 1, max: 100000 }}
                    className={settingsControlClassName}
                  />
                </LabeledControl>

                <LabeledControl
                  id="cacheHitRateAlertMinEligibleTokens"
                  label={t("notifications.cacheHitRateAlert.minEligibleTokens")}
                >
                  <NumberInput
                    id="cacheHitRateAlertMinEligibleTokens"
                    min={0}
                    value={settings.cacheHitRateAlertMinEligibleTokens}
                    disabled={!settings.enabled}
                    onValueChange={(v) =>
                      onUpdateSettings({
                        cacheHitRateAlertMinEligibleTokens: v,
                      })
                    }
                    constraints={{ integer: true, min: 0 }}
                    className={settingsControlClassName}
                  />
                </LabeledControl>

                <LabeledControl
                  id="cacheHitRateAlertTopN"
                  label={t("notifications.cacheHitRateAlert.topN")}
                >
                  <NumberInput
                    id="cacheHitRateAlertTopN"
                    min={1}
                    max={100}
                    value={settings.cacheHitRateAlertTopN}
                    disabled={!settings.enabled}
                    onValueChange={(v) => onUpdateSettings({ cacheHitRateAlertTopN: v })}
                    constraints={{ integer: true, min: 1, max: 100 }}
                    className={settingsControlClassName}
                  />
                </LabeledControl>
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
