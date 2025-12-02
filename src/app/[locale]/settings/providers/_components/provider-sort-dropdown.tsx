"use client";

import { ArrowUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type SortKey = "name" | "priority" | "weight" | "createdAt";

interface ProviderSortDropdownProps {
  value: SortKey;
  onChange: (value: SortKey) => void;
}

export function ProviderSortDropdown({ value, onChange }: ProviderSortDropdownProps) {
  const t = useTranslations("settings.providers.sort");
  const selectedValue = value ?? "priority";

  const SORT_OPTIONS: { value: SortKey; labelKey: string }[] = [
    { value: "name", labelKey: "byName" },
    { value: "priority", labelKey: "byPriority" },
    { value: "weight", labelKey: "byWeight" },
    { value: "createdAt", labelKey: "byCreatedAt" },
  ];

  return (
    <div className="flex items-center gap-2">
      <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
      <Select value={selectedValue} onValueChange={(nextValue) => onChange(nextValue as SortKey)}>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder={t("placeholder")} />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {t(option.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
