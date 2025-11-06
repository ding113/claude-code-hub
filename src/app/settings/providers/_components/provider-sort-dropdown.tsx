"use client";

import { ArrowUpDown } from "lucide-react";
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

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "name", label: "按名称 (A-Z)" },
  { value: "priority", label: "按优先级 (高-低)" },
  { value: "weight", label: "按权重 (高-低)" },
  { value: "createdAt", label: "按创建时间 (新-旧)" },
];

export function ProviderSortDropdown({ value, onChange }: ProviderSortDropdownProps) {
  const selectedValue = value ?? "priority";

  return (
    <div className="flex items-center gap-2">
      <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
      <Select value={selectedValue} onValueChange={(nextValue) => onChange(nextValue as SortKey)}>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="排序供应商" />
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
