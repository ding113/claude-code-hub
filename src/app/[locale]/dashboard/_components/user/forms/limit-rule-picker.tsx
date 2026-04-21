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
  | "limitRpm"
  | "limit5h"
  | "limitDaily"
  | "limitWeekly"
  | "limitMonthly"
  | "limitTotal"
  | "limitSessions";

export type DailyResetMode = "fixed" | "rolling";
export type LimitResetMode = DailyResetMode;

export interface LimitRulePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (type: LimitType, value: number, mode?: LimitResetMode, time?: string) => void;
  /** Types that are already configured (used for showing overwrite hint). */
  existingTypes: string[];
  /**
   * i18n strings passed from parent.
   * Expected keys (optional):
   * - title, description, cancel, confirm
   * - fields.type.label, fields.type.placeholder
   * - fields.value.label, fields.value.placeholder
   * - limit5h.mode.label, limit5h.mode.fixed, limit5h.mode.rolling
   * - limit5h.mode.helperFixed, limit5h.mode.helperRolling
   * - daily.mode.label, daily.mode.fixed, daily.mode.rolling
   * - daily.mode.helperFixed, daily.mode.helperRolling
   * - daily.time.label, daily.time.placeholder
   * - limitTypes.{limit5h|limitDaily|limitWeekly|limitMonthly|limitTotal|limitSessions}
   * - errors.missingType, errors.invalidValue, errors.invalidTime
   * - overwriteHint
   */
  translations: Record<string, unknown>;
}

const LIMIT_TYPE_OPTIONS: Array<{ type: LimitType; fallbackLabel: string }> = [
  { type: "limitRpm", fallbackLabel: "RPM limit" },
  { type: "limit5h", fallbackLabel: "5h limit" },
  { type: "limitDaily", fallbackLabel: "Daily limit" },
  { type: "limitWeekly", fallbackLabel: "Weekly limit" },
  { type: "limitMonthly", fallbackLabel: "Monthly limit" },
  { type: "limitTotal", fallbackLabel: "Total limit" },
  { type: "limitSessions", fallbackLabel: "Concurrent sessions" },
];

const QUICK_VALUES = [10, 50, 100, 500] as const;
const SESSION_QUICK_VALUES = [0, 5, 10, 15, 20] as const;
const RPM_QUICK_VALUES = [0, 30, 60, 120, 300] as const;

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

function getResetConfig(type: LimitType | "") {
  switch (type) {
    case "limit5h":
      return {
        modePath: "limit5h.mode",
        timePath: null,
        defaultMode: "rolling" as const,
      };
    case "limitDaily":
      return {
        modePath: "daily.mode",
        timePath: "daily.time",
        defaultMode: "fixed" as const,
      };
    default:
      return null;
  }
}

export function LimitRulePicker({
  open,
  onOpenChange,
  onConfirm,
  existingTypes,
  translations,
}: LimitRulePickerProps) {
  const t = (path: string, fallback: string): string =>
    getTranslation(translations, path, fallback);

  // Keep existingTypeSet for showing overwrite hint, but no longer filter availableTypes
  const existingTypeSet = useMemo(() => new Set(existingTypes), [existingTypes]);
  // All types are always available - selecting an existing type will overwrite it
  const availableTypes = LIMIT_TYPE_OPTIONS;

  const [type, setType] = useState<LimitType | "">("");
  const [rawValue, setRawValue] = useState("");
  const [resetMode, setResetMode] = useState<LimitResetMode>("rolling");
  const [resetTime, setResetTime] = useState("00:00");
  const [error, setError] = useState<string | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (!open) return;
    const first = availableTypes[0]?.type ?? "";
    setType((prev) => (prev ? prev : first));
    setRawValue("");
    setResetMode("rolling");
    setResetTime("00:00");
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!type) return;
    const resetConfig = getResetConfig(type);
    if (!resetConfig) {
      setResetMode("rolling");
      setResetTime("00:00");
      return;
    }

    setResetMode(resetConfig.defaultMode);
    setResetTime("00:00");
  }, [type]);

  const numericValue = useMemo(() => {
    const trimmed = rawValue.trim();
    if (!trimmed) return Number.NaN;
    return Number(trimmed);
  }, [rawValue]);

  const resetConfig = getResetConfig(type);
  const needsTime = Boolean(resetConfig?.timePath) && resetMode === "fixed";

  const canConfirm =
    type !== "" &&
    Number.isFinite(numericValue) &&
    numericValue >= 0 &&
    (!needsTime || isValidTime(resetTime));

  const handleCancel = () => onOpenChange(false);

  const handleSubmit = () => {
    setError(null);

    if (!type) {
      setError(t("errors.missingType", "Please select a limit type"));
      return;
    }

    if (!Number.isFinite(numericValue) || numericValue < 0) {
      setError(t("errors.invalidValue", "Please enter a valid value"));
      return;
    }

    if (needsTime && !isValidTime(resetTime)) {
      setError(t("errors.invalidTime", "Please enter a valid time (HH:mm)"));
      return;
    }

    if (resetConfig) {
      onConfirm(type, numericValue, resetMode, needsTime ? resetTime : undefined);
    } else {
      onConfirm(type, numericValue);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>{t("title", "Add limit rule")}</DialogTitle>
          <DialogDescription>
            {t("description", "Select limit type and set value")}
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
              <Label>{t("fields.type.label", "Limit type")}</Label>
              <Select value={type} onValueChange={(val) => setType(val as LimitType)}>
                <SelectTrigger>
                  <SelectValue placeholder={t("fields.type.placeholder", "Select")} />
                </SelectTrigger>
                <SelectContent>
                  {availableTypes.map((opt) => (
                    <SelectItem key={opt.type} value={opt.type}>
                      {t(`limitTypes.${opt.type}`, opt.fallbackLabel)}
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
                      "This type already exists, saving will overwrite"
                    )}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t("fields.value.label", "Value")}</Label>
              <Input
                type="number"
                min={0}
                step={type === "limitSessions" || type === "limitRpm" ? 1 : 0.01}
                inputMode="decimal"
                autoFocus
                value={rawValue}
                onChange={(e) => setRawValue(e.target.value)}
                placeholder={getTranslation(
                  translations,
                  "fields.value.placeholder",
                  "Enter value"
                )}
                aria-invalid={Boolean(error)}
              />

              <div className="flex flex-wrap gap-2">
                {(type === "limitSessions"
                  ? SESSION_QUICK_VALUES
                  : type === "limitRpm"
                    ? RPM_QUICK_VALUES
                    : QUICK_VALUES
                ).map((v) => (
                  <Button
                    key={v}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRawValue(String(v))}
                  >
                    {v === 0
                      ? t("quickValues.unlimited", "Unlimited")
                      : type === "limitSessions" || type === "limitRpm"
                        ? v
                        : `$${v}`}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {resetConfig && (
            <div className={cn("grid gap-4", needsTime ? "sm:grid-cols-2" : "")}>
              <div className="space-y-2">
                <Label>{t(`${resetConfig.modePath}.label`, "Reset mode")}</Label>
                <Select
                  value={resetMode}
                  onValueChange={(val) => setResetMode(val as LimitResetMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">
                      {t(`${resetConfig.modePath}.fixed`, "fixed")}
                    </SelectItem>
                    <SelectItem value="rolling">
                      {t(`${resetConfig.modePath}.rolling`, "rolling")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t(
                    `${resetConfig.modePath}.${resetMode === "fixed" ? "helperFixed" : "helperRolling"}`,
                    resetMode === "fixed" ? "fixed window" : "rolling window"
                  )}
                </p>
              </div>

              {needsTime && resetConfig.timePath && (
                <div className="space-y-2">
                  <Label>{t(`${resetConfig.timePath}.label`, "Reset time")}</Label>
                  <Input
                    type="time"
                    step={60}
                    value={resetTime}
                    onChange={(e) => setResetTime(e.target.value)}
                    placeholder={t(`${resetConfig.timePath}.placeholder`, "HH:mm")}
                    aria-invalid={Boolean(error)}
                  />
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCancel}>
              {t("cancel", "Cancel")}
            </Button>
            <Button type="submit" disabled={!canConfirm}>
              {t("confirm", "Save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
