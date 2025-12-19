"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type LimitType =
  | "limit5h"
  | "limitDaily"
  | "limitWeekly"
  | "limitMonthly"
  | "limitTotal"
  | "limitSessions";

export type DailyResetMode = "fixed" | "rolling";

export interface LimitRulePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (type: LimitType, value: number, mode?: DailyResetMode, time?: string) => void;
  /** Types that are already configured (used for showing overwrite hint). */
  existingTypes: string[];
  /**
   * i18n strings passed from parent.
   * Expected keys (optional):
   * - title, description, cancel, confirm
   * - fields.type.label, fields.type.placeholder
   * - fields.value.label, fields.value.placeholder
   * - daily.mode.label, daily.mode.fixed, daily.mode.rolling
   * - daily.time.label, daily.time.placeholder
   * - limitTypes.{limit5h|limitDaily|limitWeekly|limitMonthly|limitTotal|limitSessions}
   * - errors.missingType, errors.invalidValue, errors.invalidTime
   * - overwriteHint
   */
  translations: Record<string, unknown>;
}

const LIMIT_TYPE_OPTIONS: Array<{ type: LimitType; fallbackLabel: string }> = [
  { type: "limit5h", fallbackLabel: "5小时限额" },
  { type: "limitDaily", fallbackLabel: "每日限额" },
  { type: "limitWeekly", fallbackLabel: "周限额" },
  { type: "limitMonthly", fallbackLabel: "月限额" },
  { type: "limitTotal", fallbackLabel: "总限额" },
  { type: "limitSessions", fallbackLabel: "并发 Session" },
];

const QUICK_VALUES = [10, 50, 100, 500] as const;
const SESSION_QUICK_VALUES = [5, 10, 15, 20] as const;

function getTranslation(translations: Record<string, unknown>, path: string, fallback: string) {
  const value = path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, translations);
  return typeof value === "string" && value.trim() ? value : fallback;
}

function isValidTime(value: string) {
  return /^\d{2}:\d{2}$/.test(value);
}

export function LimitRulePicker({
  open,
  onOpenChange,
  onConfirm,
  existingTypes,
  translations,
}: LimitRulePickerProps) {
  // Keep existingTypeSet for showing overwrite hint, but no longer filter availableTypes
  const existingTypeSet = useMemo(() => new Set(existingTypes), [existingTypes]);
  // All types are always available - selecting an existing type will overwrite it
  const availableTypes = LIMIT_TYPE_OPTIONS;

  const [type, setType] = useState<LimitType | "">("");
  const [rawValue, setRawValue] = useState("");
  const [dailyMode, setDailyMode] = useState<DailyResetMode>("fixed");
  const [dailyTime, setDailyTime] = useState("00:00");
  const [error, setError] = useState<string | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (!open) return;
    const first = availableTypes[0]?.type ?? "";
    setType((prev) => (prev ? prev : first));
    setRawValue("");
    setDailyMode("fixed");
    setDailyTime("00:00");
    setError(null);
  }, [open, availableTypes]);

  const numericValue = useMemo(() => {
    const trimmed = rawValue.trim();
    if (!trimmed) return Number.NaN;
    return Number(trimmed);
  }, [rawValue]);

  const isDaily = type === "limitDaily";
  const needsTime = isDaily && dailyMode === "fixed";

  const canConfirm =
    type !== "" &&
    Number.isFinite(numericValue) &&
    numericValue >= 0 &&
    (!needsTime || isValidTime(dailyTime));

  const handleCancel = () => onOpenChange(false);

  const handleSubmit = () => {
    setError(null);

    if (!type) {
      setError(getTranslation(translations, "errors.missingType", "请选择限额类型"));
      return;
    }

    if (!Number.isFinite(numericValue) || numericValue < 0) {
      setError(getTranslation(translations, "errors.invalidValue", "请输入有效数值"));
      return;
    }

    if (needsTime && !isValidTime(dailyTime)) {
      setError(getTranslation(translations, "errors.invalidTime", "请输入有效时间 (HH:mm)"));
      return;
    }

    if (type === "limitDaily") {
      onConfirm(type, numericValue, dailyMode, dailyMode === "fixed" ? dailyTime : undefined);
    } else {
      onConfirm(type, numericValue);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>{getTranslation(translations, "title", "添加限额规则")}</DialogTitle>
          <DialogDescription>
            {getTranslation(translations, "description", "选择限额类型并设置数值")}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleSubmit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{getTranslation(translations, "fields.type.label", "限额类型")}</Label>
              <Select value={type} onValueChange={(val) => setType(val as LimitType)}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={getTranslation(translations, "fields.type.placeholder", "请选择")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableTypes.map((opt) => (
                    <SelectItem key={opt.type} value={opt.type}>
                      {getTranslation(translations, `limitTypes.${opt.type}`, opt.fallbackLabel)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {type && existingTypeSet.has(type) && (
                <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {getTranslation(
                      translations,
                      "overwriteHint",
                      "此类型已存在，保存将覆盖原有值"
                    )}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>{getTranslation(translations, "fields.value.label", "数值")}</Label>
              <Input
                type="number"
                min={0}
                step={type === "limitSessions" ? 1 : 0.01}
                inputMode="decimal"
                autoFocus
                value={rawValue}
                onChange={(e) => setRawValue(e.target.value)}
                placeholder={getTranslation(translations, "fields.value.placeholder", "请输入")}
                aria-invalid={Boolean(error)}
              />

              <div className="flex flex-wrap gap-2">
                {(type === "limitSessions" ? SESSION_QUICK_VALUES : QUICK_VALUES).map((v) => (
                  <Button
                    key={v}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRawValue(String(v))}
                  >
                    {type === "limitSessions" ? v : `$${v}`}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {isDaily && (
            <div className={cn("grid gap-4", dailyMode === "fixed" ? "sm:grid-cols-2" : "")}>
              <div className="space-y-2">
                <Label>{getTranslation(translations, "daily.mode.label", "每日模式")}</Label>
                <Select
                  value={dailyMode}
                  onValueChange={(val) => setDailyMode(val as DailyResetMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">
                      {getTranslation(translations, "daily.mode.fixed", "fixed")}
                    </SelectItem>
                    <SelectItem value="rolling">
                      {getTranslation(translations, "daily.mode.rolling", "rolling")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {dailyMode === "fixed" && (
                <div className="space-y-2">
                  <Label>{getTranslation(translations, "daily.time.label", "重置时间")}</Label>
                  <Input
                    type="time"
                    step={60}
                    value={dailyTime}
                    onChange={(e) => setDailyTime(e.target.value)}
                    placeholder={getTranslation(translations, "daily.time.placeholder", "HH:mm")}
                    aria-invalid={Boolean(error)}
                  />
                </div>
              )}

              {dailyMode === "rolling" && (
                <p className="text-xs text-muted-foreground">
                  {getTranslation(translations, "daily.mode.helperRolling", "rolling 24h")}
                </p>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCancel}>
              {getTranslation(translations, "cancel", "取消")}
            </Button>
            <Button type="submit" disabled={!canConfirm}>
              {getTranslation(translations, "confirm", "保存")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
