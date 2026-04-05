"use client";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProviderModelRedirectMatchType } from "@/types/provider";

export interface MatchTypeOption {
  value: ProviderModelRedirectMatchType;
  label: string;
}

// Get match type options with translated labels.
// Caller must provide useTranslations() result since namespace differs.
export function getMatchTypeOptions(t: (key: string) => string): MatchTypeOption[] {
  return [
    { value: "exact", label: t("matchTypeExact") },
    { value: "prefix", label: t("matchTypePrefix") },
    { value: "suffix", label: t("matchTypeSuffix") },
    { value: "contains", label: t("matchTypeContains") },
    { value: "regex", label: t("matchTypeRegex") },
  ];
}

// Shared match type badge display
export function MatchTypeBadge({
  matchType,
  options,
}: {
  matchType: ProviderModelRedirectMatchType;
  options: MatchTypeOption[];
}) {
  return (
    <Badge variant="secondary" className="text-xs">
      {options.find((o) => o.value === matchType)?.label ?? matchType}
    </Badge>
  );
}

// Shared match type select dropdown
export function MatchTypeSelect({
  value,
  onChange,
  disabled,
  options,
}: {
  value: ProviderModelRedirectMatchType;
  onChange: (value: ProviderModelRedirectMatchType) => void;
  disabled?: boolean;
  options: MatchTypeOption[];
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as ProviderModelRedirectMatchType)}
      disabled={disabled}
    >
      <SelectTrigger className="w-[140px] h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
