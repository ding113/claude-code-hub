"use client";

import { format } from "date-fns";
import { Calendar, Gauge, Key, Plus, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DatePickerField } from "@/components/form/date-picker-field";
import { TagInputField, TextField } from "@/components/form/form-field";
import { Badge } from "@/components/ui/badge";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
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
  /** Admin 可自由编辑 providerGroup */
  isAdmin?: boolean;
  /** 是否是最后一个启用的 key (用于禁用 Switch 防止全部禁用) */
  isLastEnabledKey?: boolean;
  userProviderGroup?: string;
  onChange: {
    (field: string, value: any): void;
    (batch: Record<string, any>): void;
  };
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  translations: {
    sections: {
      basicInfo: string;
      expireTime: string;
      limitRules: string;
      specialFeatures: string;
    };
    fields: {
      keyName: { label: string; placeholder: string };
      balanceQueryPage: {
        label: string;
        description: string;
        descriptionEnabled: string;
        descriptionDisabled: string;
      };
      providerGroup: {
        label: string;
        placeholder: string;
        selectHint?: string;
        editHint?: string;
        allGroups?: string;
        noGroupHint?: string;
      };
      cacheTtl: { label: string; options: Record<string, string> };
      enableStatus?: {
        label: string;
        description: string;
        cannotDisableTooltip?: string;
      };
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

function normalizeGroupList(value?: string | null): string {
  const groups = (value ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  if (groups.length === 0) return PROVIDER_GROUP.DEFAULT;
  return Array.from(new Set(groups)).sort().join(",");
}

const TTL_ORDER = ["inherit", "5m", "1h"] as const;

export function KeyEditSection({
  keyData,
  isAdmin = false,
  isLastEnabledKey = false,
  userProviderGroup,
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
        // Batch update to avoid race condition
        onChange({
          limitDailyUsd: null,
          dailyResetMode: "fixed",
          dailyResetTime: "00:00",
        });
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
        // Batch update to avoid race condition
        onChange({
          limitDailyUsd: value,
          dailyResetMode: nextMode,
          dailyResetTime:
            nextMode === "fixed"
              ? (time ?? keyData.dailyResetTime ?? "00:00")
              : keyData.dailyResetTime,
        });
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

  const normalizedUserProviderGroup = useMemo(
    () => normalizeGroupList(userProviderGroup),
    [userProviderGroup]
  );
  const userGroups = useMemo(
    () => (normalizedUserProviderGroup ? normalizedUserProviderGroup.split(",") : []),
    [normalizedUserProviderGroup]
  );
  const normalizedKeyProviderGroup = useMemo(
    () => normalizeGroupList(keyData.providerGroup),
    [keyData.providerGroup]
  );
  const keyGroupOptions = useMemo(() => {
    if (!normalizedKeyProviderGroup) return [];
    return normalizedKeyProviderGroup.split(",").filter(Boolean);
  }, [normalizedKeyProviderGroup]);
  const _extraKeyGroupOption = useMemo(() => {
    if (!normalizedKeyProviderGroup) return null;
    if (normalizedKeyProviderGroup === normalizedUserProviderGroup) return null;
    if (userGroups.includes(normalizedKeyProviderGroup)) return null;
    return normalizedKeyProviderGroup;
  }, [normalizedKeyProviderGroup, normalizedUserProviderGroup, userGroups]);

  // 普通用户选择分组时，自动移除 default
  const handleUserProviderGroupChange = useCallback(
    (newValue: string) => {
      const groups = newValue
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean);
      // 如果有多个分组且包含 default，移除 default
      if (groups.length > 1 && groups.includes(PROVIDER_GROUP.DEFAULT)) {
        const withoutDefault = groups.filter((g) => g !== PROVIDER_GROUP.DEFAULT);
        onChange("providerGroup", withoutDefault.join(","));
      } else {
        onChange("providerGroup", newValue);
      }
    },
    [onChange]
  );

  return (
    <div ref={scrollRef} className="space-y-3 scroll-mt-24">
      {/* 基本信息区域 */}
      <section className="rounded-lg border border-border bg-card/50 p-3 space-y-3">
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
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center">
                <Switch
                  id={`key-enable-${keyData.id}`}
                  checked={keyData.isEnabled ?? true}
                  disabled={isLastEnabledKey}
                  onCheckedChange={(checked) => onChange("isEnabled", checked)}
                />
              </div>
            </TooltipTrigger>
            {isLastEnabledKey && (
              <TooltipContent>
                <p className="text-xs">
                  {translations.fields.enableStatus?.cannotDisableTooltip ||
                    "Cannot disable the last enabled key"}
                </p>
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      </section>

      {/* 到期时间区域 */}
      <section className="rounded-lg border border-border bg-card/50 p-3 space-y-3">
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
      <section className="rounded-lg border border-border bg-card/50 p-3 space-y-3">
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
          "rounded-lg border border-border bg-muted/30 px-3 py-3 space-y-3",
          "shadow-none"
        )}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h4 className="text-sm font-semibold">{translations.sections.specialFeatures}</h4>
        </div>

        {/* Balance Query Page toggle uses inverted logic by design:
            - canLoginWebUi=true means user accesses full WebUI (switch OFF)
            - canLoginWebUi=false means user uses independent balance page (switch ON)
            The switch represents "enable independent page" which is !canLoginWebUi */}
        <div className="flex items-start justify-between gap-4 rounded-lg border border-dashed border-border bg-background px-4 py-3">
          <div>
            <Label htmlFor={`key-${keyData.id}-balance-page`} className="text-sm font-medium">
              {translations.fields.balanceQueryPage.label}
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              {keyData.canLoginWebUi
                ? translations.fields.balanceQueryPage.descriptionDisabled
                : translations.fields.balanceQueryPage.descriptionEnabled}
            </p>
          </div>
          <Switch
            id={`key-${keyData.id}-balance-page`}
            checked={!(keyData.canLoginWebUi ?? false)}
            onCheckedChange={(checked) => onChange("canLoginWebUi", !checked)}
          />
        </div>

        {isAdmin ? (
          <ProviderGroupSelect
            value={keyData.providerGroup || PROVIDER_GROUP.DEFAULT}
            onChange={(val) => onChange("providerGroup", val)}
            disabled={false}
            translations={{
              label: translations.fields.providerGroup.label,
              placeholder: translations.fields.providerGroup.placeholder,
            }}
          />
        ) : userGroups.length > 0 ? (
          <div className="space-y-2">
            {keyData.id > 0 ? (
              // 编辑模式：只读显示
              <>
                <Label>{translations.fields.providerGroup.label}</Label>
                <div className="flex flex-wrap gap-1 p-2 border rounded-md bg-muted/50">
                  {keyGroupOptions.length > 0 ? (
                    keyGroupOptions.map((group) => (
                      <Badge key={group} variant="secondary" className="text-xs">
                        {group}
                      </Badge>
                    ))
                  ) : (
                    <Badge variant="outline" className="text-xs">
                      {PROVIDER_GROUP.DEFAULT}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {translations.fields.providerGroup.editHint || "已有密钥的分组不可修改"}
                </p>
              </>
            ) : (
              // 创建模式：多选
              <TagInputField
                label={translations.fields.providerGroup.label}
                placeholder={translations.fields.providerGroup.placeholder || "选择分组"}
                value={keyData.providerGroup || PROVIDER_GROUP.DEFAULT}
                onChange={handleUserProviderGroupChange}
                suggestions={userGroups}
                maxTags={userGroups.length + 1}
                maxTagLength={50}
                description={
                  translations.fields.providerGroup.selectHint || "选择此 Key 可使用的供应商分组"
                }
              />
            )}
          </div>
        ) : keyGroupOptions.length > 0 ? (
          <div className="space-y-2">
            <Label>{translations.fields.providerGroup.label}</Label>
            <div className="flex flex-wrap gap-2">
              {keyGroupOptions.map((group) => (
                <Badge
                  key={group}
                  variant="secondary"
                  className="text-xs font-mono max-w-[280px] truncate"
                  title={group}
                >
                  {group}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {translations.fields.providerGroup.editHint || "已有密钥的分组不可修改"}
            </p>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            {translations.fields.providerGroup.noGroupHint || "您没有分组限制，可以访问所有供应商"}
          </div>
        )}

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
