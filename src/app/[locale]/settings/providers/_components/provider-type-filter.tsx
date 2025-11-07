"use client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Filter } from "lucide-react";
import type { ProviderType } from "@/types/provider";
import { PROVIDER_TYPE_CONFIG, getAllProviderTypes } from "@/lib/provider-type-utils";

interface ProviderTypeFilterProps {
  value: ProviderType | "all";
  onChange: (value: ProviderType | "all") => void;
}

export function ProviderTypeFilter({ value, onChange }: ProviderTypeFilterProps) {
  return (
    <div className="flex items-center gap-2">
      <Filter className="h-4 w-4 text-muted-foreground" />
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="筛选供应商类型" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部供应商</SelectItem>
          {getAllProviderTypes().map((type) => {
            const config = PROVIDER_TYPE_CONFIG[type];
            const Icon = config.icon;
            return (
              <SelectItem key={type} value={type}>
                <div className="flex items-center gap-2">
                  <Icon className={`h-3.5 w-3.5 ${config.iconColor}`} />
                  <span>{config.label}</span>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
