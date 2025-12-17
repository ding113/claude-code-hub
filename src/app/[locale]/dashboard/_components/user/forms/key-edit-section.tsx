"use client";

import { format } from "date-fns";
import { Calendar, Gauge, Key, Plus, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DatePickerField } from "@/components/form/date-picker-field";
import { TextField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { type DailyResetMode, LimitRulePicker, type LimitType } from "./limit-rule-picker";
import { type LimitRuleDisplayItem, LimitRulesDisplay } from "./limit-rules-display";
import { ProviderGroupSelect } from "./provider-group-select";
import { QuickExpirePicker } from "./quick-expire-picker";

export interface KeyEditSectionProps {
  keyData: {
    id: number;
    name: string;
    isEnabled?: boolean;
    expiresAt?: Date | null;
    canLoginWebUi?: boolean;
    providerGroup?: string | null;
    cacheTtlPreference?: "inherit" | "5m" | "1h";
    // 所有限额字段
    limit5hUsd?: number | null;
    limitDailyUsd?: number | null;
    dailyResetMode?: "fixed" | "rolling";
    dailyResetTime?: string;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
    limitTotalUsd?: number | null;
    limitConcurrentSessions?: number;
  };
  /** providerGroup 为 admin-only 字段：非管理员仅可查看不可编辑 */
  isAdmin?: boolean;
  onChange: (field: string, value: any) => void;
  scrollRef?: React.RefObject<HTMLDivElement>;
  translations: {
    sections: {
      basicInfo: string;
      expireTime: string;
      limitRules: string;
      specialFeatures: string;
    };
    fields: {
      keyName: { label: string; placeholder: string };
      balanceQueryPage: { label: string; description: string };
      providerGroup: { label: string; placeholder: string };
      cacheTtl: { label: string; options: Record<string, string> };
      enableStatus?: { label: string; description: string };
    };
    limitRules: any;
    quickExpire: any;
  };
}

function getTranslation(translations: Record<string, unknown>, path: string, fallback: string) {
  const value = path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, translations);
  return typeof value === "string" && value.trim() ? value : fallback;
}

function toEndOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function parseDateStringEndOfDay(value: string): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return toEndOfDay(new Date(year, month - 1, day));
}

function formatDateInput(date?: Date | null): string {
  if (!date) return "";
  try {
    return format(date, "yyyy-MM-dd");
  } catch {
    return "";
  }
}

const TTL_ORDER = ["inherit", "5m", "1h"] as const;

export function KeyEditSection({
  keyData,
  isAdmin = false,
  onChange,
  scrollRef,
  translations,
}: KeyEditSectionProps) {
  const [limitPickerOpen, setLimitPickerOpen] = useState(false);

  useEffect(() => {
    if (!scrollRef?.current) return;
    scrollRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollRef]);

  const limitRules = useMemo<LimitRuleDisplayItem[]>(() => {
    const rules: LimitRuleDisplayItem[] = [];

    if (typeof keyData.limit5hUsd === "number" && keyData.limit5hUsd > 0) {
      rules.push({ type: "limit5h", value: keyData.limit5hUsd });
    }

    if (typeof keyData.limitDailyUsd === "number" && keyData.limitDailyUsd > 0) {
      rules.push({
        type: "limitDaily",
        value: keyData.limitDailyUsd,
        mode: keyData.dailyResetMode ?? "fixed",
        time: keyData.dailyResetTime ?? "00:00",
      });
    }

    if (typeof keyData.limitWeeklyUsd === "number" && keyData.limitWeeklyUsd > 0) {
      rules.push({ type: "limitWeekly", value: keyData.limitWeeklyUsd });
    }

    if (typeof keyData.limitMonthlyUsd === "number" && keyData.limitMonthlyUsd > 0) {
      rules.push({ type: "limitMonthly", value: keyData.limitMonthlyUsd });
    }

    if (typeof keyData.limitTotalUsd === "number" && keyData.limitTotalUsd > 0) {
      rules.push({ type: "limitTotal", value: keyData.limitTotalUsd });
    }

    if (
      typeof keyData.limitConcurrentSessions === "number" &&
      keyData.limitConcurrentSessions > 0
    ) {
      rules.push({ type: "limitSessions", value: keyData.limitConcurrentSessions });
    }

    return rules;
  }, [
    keyData.limit5hUsd,
    keyData.limitDailyUsd,
    keyData.dailyResetMode,
    keyData.dailyResetTime,
    keyData.limitWeeklyUsd,
    keyData.limitMonthlyUsd,
    keyData.limitTotalUsd,
    keyData.limitConcurrentSessions,
  ]);

  const existingLimitTypes = useMemo(() => limitRules.map((r) => r.type), [limitRules]);

  const handleRemoveLimitRule = (type: string) => {
    switch (type) {
      case "limit5h":
        onChange("limit5hUsd", null);
        return;
      case "limitDaily":
        onChange("limitDailyUsd", null);
        return;
      case "limitWeekly":
        onChange("limitWeeklyUsd", null);
        return;
      case "limitMonthly":
        onChange("limitMonthlyUsd", null);
        return;
      case "limitTotal":
        onChange("limitTotalUsd", null);
        return;
      case "limitSessions":
        onChange("limitConcurrentSessions", 0);
        return;
      default:
        return;
    }
  };

  const handleConfirmLimitRule = (
    type: LimitType,
    value: number,
    mode?: DailyResetMode,
    time?: string
  ) => {
    if (!Number.isFinite(value) || value <= 0) {
      handleRemoveLimitRule(type);
      return;
    }

    switch (type) {
      case "limit5h":
        onChange("limit5hUsd", value);
        return;
      case "limitDaily": {
        const nextMode: DailyResetMode = mode ?? keyData.dailyResetMode ?? "fixed";
        onChange("limitDailyUsd", value);
        onChange("dailyResetMode", nextMode);
        if (nextMode === "fixed") {
          onChange("dailyResetTime", time ?? keyData.dailyResetTime ?? "00:00");
        }
        return;
      }
      case "limitWeekly":
        onChange("limitWeeklyUsd", value);
        return;
      case "limitMonthly":
        onChange("limitMonthlyUsd", value);
        return;
      case "limitTotal":
        onChange("limitTotalUsd", value);
        return;
      case "limitSessions":
        onChange("limitConcurrentSessions", Math.max(0, Math.floor(value)));
        return;
      default:
        return;
    }
  };

  const expiresAtValue = useMemo(() => formatDateInput(keyData.expiresAt), [keyData.expiresAt]);

  const cacheTtlPreference = keyData.cacheTtlPreference ?? "inherit";
  const cacheTtlOptions = translations.fields.cacheTtl.options || {};

  const addRuleText = useMemo(
    () => getTranslation(translations.limitRules || {}, "actions.add", "添加规则"),
    [translations.limitRules]
  );

  return (
    <div ref={scrollRef} className="space-y-4 scroll-mt-24">
      {/* 基本信息区域 */}
      <section className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h4 className="text-sm font-semibold">{translations.sections.basicInfo}</h4>
        </div>
        <TextField
          label={translations.fields.keyName.label}
          placeholder={translations.fields.keyName.placeholder}
          required
          maxLength={64}
          value={keyData.name}
          onChange={(val) => onChange("name", val)}
        />
        <div className="flex items-center justify-between gap-4 py-1">
          <div className="space-y-0.5">
            <Label htmlFor={`key-enable-${keyData.id}`} className="text-sm font-medium">
              {translations.fields.enableStatus?.label || "Enable Status"}
            </Label>
            <p className="text-xs text-muted-foreground">
              {translations.fields.enableStatus?.description || "Disabled keys cannot be used"}
            </p>
          </div>
          <Switch
            id={`key-enable-${keyData.id}`}
            checked={keyData.isEnabled ?? true}
            onCheckedChange={(checked) => onChange("isEnabled", checked)}
          />
        </div>
      </section>

      {/* 到期时间区域 */}
      <section className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h4 className="text-sm font-semibold">{translations.sections.expireTime}</h4>
        </div>
        <DatePickerField
          label={translations.sections.expireTime}
          value={expiresAtValue}
          onChange={(val) => onChange("expiresAt", parseDateStringEndOfDay(val))}
        />
        <QuickExpirePicker
          translations={translations.quickExpire || {}}
          onSelect={(date) => onChange("expiresAt", toEndOfDay(date))}
        />
      </section>

      {/* 限额规则区域 */}
      <section className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h4 className="text-sm font-semibold">{translations.sections.limitRules}</h4>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLimitPickerOpen(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
            {addRuleText}
          </Button>
        </div>

        <LimitRulesDisplay
          rules={limitRules}
          onRemove={handleRemoveLimitRule}
          translations={translations.limitRules || {}}
        />

        <LimitRulePicker
          open={limitPickerOpen}
          onOpenChange={setLimitPickerOpen}
          onConfirm={handleConfirmLimitRule}
          existingTypes={existingLimitTypes}
          translations={translations.limitRules || {}}
        />
      </section>

      {/* 特殊功能区域 */}
      <section
        className={cn(
          "rounded-lg border border-border bg-muted/30 px-4 py-4 space-y-4",
          "shadow-none"
        )}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h4 className="text-sm font-semibold">{translations.sections.specialFeatures}</h4>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-dashed border-border bg-background px-4 py-3">
          <div>
            <Label htmlFor={`key-${keyData.id}-balance-page`} className="text-sm font-medium">
              {translations.fields.balanceQueryPage.label}
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              {translations.fields.balanceQueryPage.description}
            </p>
          </div>
          <Switch
            id={`key-${keyData.id}-balance-page`}
            checked={keyData.canLoginWebUi ?? true}
            onCheckedChange={(checked) => onChange("canLoginWebUi", checked)}
          />
        </div>

        <ProviderGroupSelect
          value={keyData.providerGroup || ""}
          onChange={(val) => onChange("providerGroup", val)}
          disabled={!isAdmin}
          translations={{
            label: translations.fields.providerGroup.label,
            placeholder: translations.fields.providerGroup.placeholder,
          }}
        />

        <div className="space-y-2">
          <Label>{translations.fields.cacheTtl.label}</Label>
          <Select
            value={cacheTtlPreference}
            onValueChange={(val) => onChange("cacheTtlPreference", val as "inherit" | "5m" | "1h")}
          >
            <SelectTrigger>
              <SelectValue placeholder={cacheTtlPreference} />
            </SelectTrigger>
            <SelectContent>
              {TTL_ORDER.filter((k) => k in cacheTtlOptions).map((k) => (
                <SelectItem key={k} value={k}>
                  {cacheTtlOptions[k]}
                </SelectItem>
              ))}
              {Object.entries(cacheTtlOptions)
                .filter(([k]) => !TTL_ORDER.includes(k as (typeof TTL_ORDER)[number]))
                .map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </section>
    </div>
  );
}
