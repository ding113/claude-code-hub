"use client";

import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface LimitRuleDisplayItem {
  type: string;
  value: number;
  mode?: string;
  time?: string;
}

export interface LimitRulesDisplayProps {
  rules: LimitRuleDisplayItem[];
  onRemove: (type: string) => void;
  /**
   * i18n strings passed from parent.
   * Expected keys (optional):
   * - limitTypes.{limit5h|limitDaily|limitWeekly|limitMonthly|limitTotal|limitSessions}
   * - limit5h.mode.fixed, limit5h.mode.rolling
   * - daily.mode.fixed, daily.mode.rolling
   * - actions.remove
   */
  translations: Record<string, unknown>;
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

function formatValue(raw: number): string {
  if (!Number.isFinite(raw)) return String(raw);
  if (Number.isInteger(raw)) return String(raw);
  return raw.toFixed(2).replace(/\.00$/, "");
}

export function LimitRulesDisplay({ rules, onRemove, translations }: LimitRulesDisplayProps) {
  if (!rules || rules.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rules.map((rule) => {
        const typeLabel = getTranslation(translations, `limitTypes.${rule.type}`, rule.type);
        const formattedValue = formatValue(rule.value);

        const resetModePath =
          rule.type === "limit5h"
            ? "limit5h.mode"
            : rule.type === "limitDaily"
              ? "daily.mode"
              : null;
        const resetDetail =
          resetModePath && rule.mode
            ? rule.mode === "fixed"
              ? rule.type === "limitDaily"
                ? `${getTranslation(translations, `${resetModePath}.fixed`, "fixed")} ${rule.time || "00:00"}`
                : getTranslation(translations, `${resetModePath}.fixed`, "fixed")
              : getTranslation(translations, `${resetModePath}.rolling`, "rolling")
            : null;

        return (
          <Card key={rule.type} className="gap-2 border-border py-3 px-3 shadow-none">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <Badge variant="secondary" className="max-w-full truncate">
                  {typeLabel}
                </Badge>
                <div className="text-sm font-medium tabular-nums">{formattedValue}</div>
                {resetDetail && <div className="text-xs text-muted-foreground">{resetDetail}</div>}
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={cn("shrink-0 text-muted-foreground hover:text-foreground")}
                onClick={() => onRemove(rule.type)}
                aria-label={getTranslation(translations, "actions.remove", "Remove")}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
