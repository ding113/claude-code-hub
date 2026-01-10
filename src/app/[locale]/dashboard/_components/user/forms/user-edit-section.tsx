"use client";

import { Calendar, Gauge, Loader2, ShieldCheck, ShieldOff, User } from "lucide-react";
import { useMemo, useState } from "react";
import { DatePickerField } from "@/components/form/date-picker-field";
import { ArrayTagInputField, TextField } from "@/components/form/form-field";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { cn } from "@/lib/utils";
import { AccessRestrictionsSection } from "./access-restrictions-section";
import { type DailyResetMode, LimitRulePicker, type LimitType } from "./limit-rule-picker";
import { type LimitRuleDisplayItem, LimitRulesDisplay } from "./limit-rules-display";
import { ProviderGroupSelect } from "./provider-group-select";
import { QuickExpirePicker } from "./quick-expire-picker";

export interface UserEditSectionProps {
  user: {
    id: number;
    name: string;
    description?: string;
    tags?: string[];
    expiresAt?: Date | null;
    providerGroup?: string | null;
    // 所有限额字段
    rpm?: number | null;
    limit5hUsd?: number | null;
    dailyQuota?: number | null; // 新增：用户每日限额
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
    limitTotalUsd?: number | null;
    limitConcurrentSessions?: number | null;
    dailyResetMode?: "fixed" | "rolling";
    dailyResetTime?: string;
    // 访问限制字段
    allowedClients?: string[];
    allowedModels?: string[];
  };
  isEnabled?: boolean;
  onToggleEnabled?: () => Promise<void>;
  showProviderGroup?: boolean;
  modelSuggestions?: string[];
  onChange: {
    (field: string, value: any): void;
    (batch: Record<string, any>): void;
  };
  translations: {
    sections: {
      basicInfo: string;
      expireTime: string;
      limitRules: string;
      accessRestrictions: string;
    };
    fields: {
      username: { label: string; placeholder: string };
      description: { label: string; placeholder: string };
      tags: { label: string; placeholder: string };
      providerGroup?: {
        label: string;
        placeholder: string;
        providersSuffix?: string;
        tagInputErrors?: {
          empty?: string;
          duplicate?: string;
          too_long?: string;
          invalid_format?: string;
          max_tags?: string;
        };
        errors?: {
          loadFailed?: string;
        };
      };
      enableStatus?: {
        label: string;
        enabledDescription: string;
        disabledDescription: string;
        confirmEnable: string;
        confirmDisable: string;
        confirmEnableTitle: string;
        confirmDisableTitle: string;
        confirmEnableDescription: string;
        confirmDisableDescription: string;
        cancel: string;
        processing: string;
      };
      allowedClients: {
        label: string;
        description: string;
        customLabel: string;
        customPlaceholder: string;
      };
      allowedModels: {
        label: string;
        placeholder: string;
        description: string;
      };
    };
    presetClients: Record<string, string>;
    limitRules: {
      addRule: string;
      ruleTypes: Record<string, string>;
      quickValues: Record<string, string>;
    };
    quickExpire: Record<string, string>;
  };
}

function formatYmdLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseYmdToEndOfDay(dateStr: string): Date | null {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split("-").map((v) => Number(v));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(23, 59, 59, 999);
  return date;
}

function toEndOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function UserEditSection({
  user,
  isEnabled,
  onToggleEnabled,
  showProviderGroup,
  modelSuggestions = [],
  onChange,
  translations,
}: UserEditSectionProps) {
  const [rulePickerOpen, setRulePickerOpen] = useState(false);
  const [toggleConfirmOpen, setToggleConfirmOpen] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  const emitChange = (fieldOrBatch: string | Record<string, any>, value?: any) => {
    if (typeof fieldOrBatch === "object") {
      onChange(fieldOrBatch);
    } else {
      onChange(fieldOrBatch, value);
    }
  };

  const handleToggleEnabled = async () => {
    if (!onToggleEnabled) return;
    setIsToggling(true);
    try {
      await onToggleEnabled();
      setToggleConfirmOpen(false);
    } finally {
      setIsToggling(false);
    }
  };

  const expiresAtValue = useMemo(() => {
    if (!user.expiresAt) return "";
    return formatYmdLocal(new Date(user.expiresAt));
  }, [user.expiresAt]);

  const rules = useMemo<LimitRuleDisplayItem[]>(() => {
    const items: LimitRuleDisplayItem[] = [];

    const add = (type: LimitType, value: unknown, extra?: Partial<LimitRuleDisplayItem>) => {
      const numeric = toNumberOrNull(value);
      if (!numeric || numeric <= 0) return;
      items.push({ type, value: numeric, ...extra });
    };

    // RPM: user.rpm > 0 表示有限制
    add("limitRpm", user.rpm);
    add("limit5h", user.limit5hUsd);
    // 新增：添加每日限额到 rules
    add("limitDaily", user.dailyQuota, {
      mode: user.dailyResetMode ?? "fixed",
      time: user.dailyResetTime ?? "00:00",
    });
    add("limitWeekly", user.limitWeeklyUsd);
    add("limitMonthly", user.limitMonthlyUsd);
    add("limitTotal", user.limitTotalUsd);
    add("limitSessions", user.limitConcurrentSessions);

    return items;
  }, [
    user.rpm,
    user.limit5hUsd,
    user.dailyQuota,
    user.dailyResetMode,
    user.dailyResetTime,
    user.limitWeeklyUsd,
    user.limitMonthlyUsd,
    user.limitTotalUsd,
    user.limitConcurrentSessions,
  ]);

  const existingTypes = useMemo(() => {
    // 现在允许用户设置每日限额，不再排除 limitDaily
    return rules.map((r) => r.type);
  }, [rules]);

  const limitRuleTranslations = useMemo(() => {
    return {
      title: translations.limitRules.addRule,
      limitTypes: translations.limitRules.ruleTypes,
      quickValues: translations.limitRules.quickValues,
    } satisfies Record<string, unknown>;
  }, [
    translations.limitRules.addRule,
    translations.limitRules.ruleTypes,
    translations.limitRules.quickValues,
  ]);

  const handleRemoveRule = (type: string) => {
    switch (type) {
      case "limitRpm":
        emitChange("rpm", 0); // 0 = 无限制
        return;
      case "limit5h":
        emitChange("limit5hUsd", null);
        return;
      case "limitDaily":
        // Batch update to avoid race condition
        emitChange({
          dailyQuota: null,
          dailyResetMode: "fixed",
          dailyResetTime: "00:00",
        });
        return;
      case "limitWeekly":
        emitChange("limitWeeklyUsd", null);
        return;
      case "limitMonthly":
        emitChange("limitMonthlyUsd", null);
        return;
      case "limitTotal":
        emitChange("limitTotalUsd", null);
        return;
      case "limitSessions":
        emitChange("limitConcurrentSessions", null);
        return;
      default:
        return;
    }
  };

  const handleAddRule = (type: LimitType, value: number, mode?: DailyResetMode, time?: string) => {
    switch (type) {
      case "limitRpm":
        emitChange("rpm", Math.floor(value)); // RPM 应为整数
        return;
      case "limit5h":
        emitChange("limit5hUsd", value);
        return;
      case "limitDaily":
        // Batch update to avoid race condition
        emitChange({
          dailyQuota: value,
          dailyResetMode: mode || "fixed",
          dailyResetTime: time || "00:00",
        });
        return;
      case "limitWeekly":
        emitChange("limitWeeklyUsd", value);
        return;
      case "limitMonthly":
        emitChange("limitMonthlyUsd", value);
        return;
      case "limitTotal":
        emitChange("limitTotalUsd", value);
        return;
      case "limitSessions":
        emitChange("limitConcurrentSessions", value);
        return;
      default:
        return;
    }
  };

  const enableStatusTranslations = translations.fields.enableStatus;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card/50 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h4 className="text-sm font-semibold">{translations.sections.basicInfo}</h4>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-3">
            <TextField
              label={translations.fields.username.label}
              placeholder={translations.fields.username.placeholder}
              value={user.name || ""}
              onChange={(val) => emitChange("name", val)}
              maxLength={64}
            />

            {/* Enable/Disable toggle - only show if onToggleEnabled is provided */}
            {onToggleEnabled && enableStatusTranslations && (
              <div
                className={cn(
                  "flex items-center justify-between rounded-md border p-3",
                  isEnabled ? "border-border bg-background" : "border-amber-500/30 bg-amber-500/5"
                )}
              >
                <div className="space-y-0.5">
                  <Label
                    htmlFor="user-enabled-toggle"
                    className="text-sm font-medium flex items-center gap-2 cursor-pointer"
                  >
                    {isEnabled ? (
                      <ShieldCheck className="h-4 w-4 text-green-600" />
                    ) : (
                      <ShieldOff className="h-4 w-4 text-amber-600" />
                    )}
                    {enableStatusTranslations.label || "Enable Status"}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {isEnabled
                      ? enableStatusTranslations.enabledDescription || "Currently enabled"
                      : enableStatusTranslations.disabledDescription || "Currently disabled"}
                  </p>
                </div>
                <Switch
                  id="user-enabled-toggle"
                  checked={isEnabled}
                  onCheckedChange={() => setToggleConfirmOpen(true)}
                  disabled={isToggling}
                />

                <AlertDialog open={toggleConfirmOpen} onOpenChange={setToggleConfirmOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {isEnabled
                          ? enableStatusTranslations.confirmDisableTitle || "Disable User"
                          : enableStatusTranslations.confirmEnableTitle || "Enable User"}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {isEnabled
                          ? enableStatusTranslations.confirmDisableDescription ||
                            `Are you sure you want to disable user "${user.name}"?`
                          : enableStatusTranslations.confirmEnableDescription ||
                            `Are you sure you want to enable user "${user.name}"?`}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={isToggling}>
                        {enableStatusTranslations.cancel || "Cancel"}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(e) => {
                          e.preventDefault();
                          handleToggleEnabled();
                        }}
                        disabled={isToggling}
                        className={cn(
                          isEnabled
                            ? "bg-amber-600 hover:bg-amber-700"
                            : "bg-green-600 hover:bg-green-700"
                        )}
                      >
                        {isToggling ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            {enableStatusTranslations.processing || "Processing..."}
                          </>
                        ) : isEnabled ? (
                          enableStatusTranslations.confirmDisable || "Disable"
                        ) : (
                          enableStatusTranslations.confirmEnable || "Enable"
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <TextField
              label={translations.fields.description.label}
              placeholder={translations.fields.description.placeholder}
              value={user.description || ""}
              onChange={(val) => emitChange("description", val)}
              maxLength={200}
            />

            <ArrayTagInputField
              label={translations.fields.tags.label}
              placeholder={translations.fields.tags.placeholder}
              value={user.tags || []}
              onChange={(val) => emitChange("tags", val)}
              maxTagLength={32}
              maxTags={20}
            />

            {showProviderGroup && translations.fields.providerGroup && (
              <ProviderGroupSelect
                value={user.providerGroup || PROVIDER_GROUP.DEFAULT}
                onChange={(val) => emitChange("providerGroup", val)}
                disabled={false}
                translations={translations.fields.providerGroup}
              />
            )}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card/50 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h4 className="text-sm font-semibold">{translations.sections.expireTime}</h4>
        </div>
        <div className="space-y-3">
          <DatePickerField
            label={translations.sections.expireTime}
            value={expiresAtValue}
            onChange={(val) => emitChange("expiresAt", val ? parseYmdToEndOfDay(val) : null)}
            className="max-w-md"
          />

          <QuickExpirePicker
            translations={translations.quickExpire}
            onSelect={(date) => emitChange("expiresAt", toEndOfDay(date))}
          />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card/50 p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h4 className="text-sm font-semibold">{translations.sections.limitRules}</h4>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setRulePickerOpen(true)}>
            {translations.limitRules.addRule}
          </Button>
        </div>

        <LimitRulesDisplay
          rules={rules}
          onRemove={handleRemoveRule}
          translations={limitRuleTranslations}
        />

        <LimitRulePicker
          open={rulePickerOpen}
          onOpenChange={setRulePickerOpen}
          onConfirm={handleAddRule}
          existingTypes={existingTypes}
          translations={limitRuleTranslations}
        />
      </section>

      <AccessRestrictionsSection
        allowedClients={user.allowedClients || []}
        allowedModels={user.allowedModels || []}
        modelSuggestions={modelSuggestions}
        onChange={onChange}
        translations={{
          sections: {
            accessRestrictions: translations.sections.accessRestrictions,
          },
          fields: {
            allowedClients: translations.fields.allowedClients,
            allowedModels: translations.fields.allowedModels,
          },
          presetClients: translations.presetClients,
        }}
      />
    </div>
  );
}
