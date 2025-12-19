"use client";

import { Button } from "@/components/ui/button";

export interface QuickExpirePickerProps {
  onSelect: (date: Date) => void;
  /**
   * i18n strings passed from parent.
   * Expected keys (optional):
   * - week, month, threeMonths, year
   */
  translations: Record<string, unknown>;
}

function getTranslation(translations: Record<string, unknown>, key: string, fallback: string) {
  const value = translations?.[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date: Date, months: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function addYears(date: Date, years: number) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

export function QuickExpirePicker({ onSelect, translations }: QuickExpirePickerProps) {
  const base = new Date();

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => onSelect(addDays(base, 7))}>
        {getTranslation(translations, "week", "一周后")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onSelect(addMonths(base, 1))}
      >
        {getTranslation(translations, "month", "一月后")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onSelect(addMonths(base, 3))}
      >
        {getTranslation(translations, "threeMonths", "三月后")}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => onSelect(addYears(base, 1))}>
        {getTranslation(translations, "year", "一年后")}
      </Button>
    </div>
  );
}
