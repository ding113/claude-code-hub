"use client";

import { ArrowUpDown } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "next-intl";

export type QuotaSortKey = "name" | "priority" | "weight" | "usage";

interface ProviderQuotaSortDropdownProps {
  value: QuotaSortKey;
  onChange: (value: QuotaSortKey) => void;
}

export function ProviderQuotaSortDropdown({ value, onChange }: ProviderQuotaSortDropdownProps) {
  const t = useTranslations("quota.providers.sort");
  const selectedValue = value ?? "priority";

  const SORT_OPTIONS: { value: QuotaSortKey; label: string }[] = [
    { value: "name", label: t("name") },
    { value: "priority", label: t("priority") },
    { value: "weight", label: t("weight") },
    { value: "usage", label: t("usage") },
  ];

  return (
    <div className="flex items-center gap-2">
      <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
      <Select
        value={selectedValue}
        onValueChange={(nextValue) => onChange(nextValue as QuotaSortKey)}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
