"use client";

import { useMemo, useState, useTransition } from "react";
import { DatePickerField } from "@/components/form/date-picker-field";
import { ArrayTagInputField, TextField } from "@/components/form/form-field";
import { FormGroup } from "@/components/form/form-layout";
import { Button } from "@/components/ui/button";
import { type DailyResetMode, LimitRulePicker, type LimitType } from "./limit-rule-picker";
import { type LimitRuleDisplayItem, LimitRulesDisplay } from "./limit-rules-display";
import { QuickExpirePicker } from "./quick-expire-picker";

export interface UserEditSectionProps {
  user: {
    id: number;
    name: string;
    description?: string;
    tags?: string[];
    expiresAt?: Date | null;
    // 所有限额字段
    limit5hUsd?: number | null;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
    limitTotalUsd?: number | null;
    limitConcurrentSessions?: number | null;
    dailyResetMode?: "fixed" | "rolling";
    dailyResetTime?: string;
  };
  onChange: (field: string, value: any) => void;
  translations: {
    sections: {
      basicInfo: string;
      expireTime: string;
      limitRules: string;
    };
    fields: {
      username: { label: string; placeholder: string };
      description: { label: string; placeholder: string };
      tags: { label: string; placeholder: string };
    };
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

export function UserEditSection({ user, onChange, translations }: UserEditSectionProps) {
  const [isPending, startTransition] = useTransition();
  const [rulePickerOpen, setRulePickerOpen] = useState(false);

  const emitChange = (field: string, value: any) => {
    startTransition(() => {
      onChange(field, value);
    });
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

    add("limit5h", user.limit5hUsd);
    add("limitWeekly", user.limitWeeklyUsd);
    add("limitMonthly", user.limitMonthlyUsd);
    add("limitTotal", user.limitTotalUsd);
    add("limitSessions", user.limitConcurrentSessions);

    return items;
  }, [
    user.limit5hUsd,
    user.limitWeeklyUsd,
    user.limitMonthlyUsd,
    user.limitTotalUsd,
    user.limitConcurrentSessions,
  ]);

  const existingTypes = useMemo(() => {
    // User-level rules in this section do not manage the daily limit value.
    return [...rules.map((r) => r.type), "limitDaily"];
  }, [rules]);

  const limitRuleTranslations = useMemo(() => {
    return {
      title: translations.limitRules.addRule,
      limitTypes: translations.limitRules.ruleTypes,
    } satisfies Record<string, unknown>;
  }, [translations.limitRules.addRule, translations.limitRules.ruleTypes]);

  const handleRemoveRule = (type: string) => {
    switch (type) {
      case "limit5h":
        emitChange("limit5hUsd", null);
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
      case "limit5h":
        emitChange("limit5hUsd", value);
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
      case "limitDaily":
        // User-level daily limit value is handled outside this section.
        if (mode) emitChange("dailyResetMode", mode);
        if (time) emitChange("dailyResetTime", time);
        return;
      default:
        return;
    }
  };

  return (
    <div className="space-y-8">
      <FormGroup title={translations.sections.basicInfo}>
        <TextField
          label={translations.fields.username.label}
          placeholder={translations.fields.username.placeholder}
          value={user.name || ""}
          onChange={(val) => emitChange("name", val)}
          className="max-w-md"
          maxLength={64}
          disabled={isPending}
        />

        <TextField
          label={translations.fields.description.label}
          placeholder={translations.fields.description.placeholder}
          value={user.description || ""}
          onChange={(val) => emitChange("description", val)}
          className="max-w-md"
          maxLength={200}
          disabled={isPending}
        />

        <ArrayTagInputField
          label={translations.fields.tags.label}
          placeholder={translations.fields.tags.placeholder}
          value={user.tags || []}
          onChange={(val) => emitChange("tags", val)}
          className="max-w-md"
          maxTagLength={32}
          maxTags={20}
          disabled={isPending}
        />
      </FormGroup>

      <FormGroup title={translations.sections.expireTime}>
        <DatePickerField
          label={translations.sections.expireTime}
          value={expiresAtValue}
          onChange={(val) => emitChange("expiresAt", val ? parseYmdToEndOfDay(val) : null)}
          className="max-w-md"
          disabled={isPending}
        />

        <QuickExpirePicker
          translations={translations.quickExpire}
          onSelect={(date) => emitChange("expiresAt", toEndOfDay(date))}
        />
      </FormGroup>

      <FormGroup title={translations.sections.limitRules}>
        <LimitRulesDisplay
          rules={rules}
          onRemove={handleRemoveRule}
          translations={limitRuleTranslations}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="max-w-md"
            onClick={() => setRulePickerOpen(true)}
            disabled={isPending}
          >
            {translations.limitRules.addRule}
          </Button>
        </div>

        <LimitRulePicker
          open={rulePickerOpen}
          onOpenChange={setRulePickerOpen}
          onConfirm={handleAddRule}
          existingTypes={existingTypes}
          translations={limitRuleTranslations}
        />
      </FormGroup>
    </div>
  );
}
