"use client";

import { Filter } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ModelPriceSourceV2 } from "@/types/model-price-v2";

interface PriceSourceFilterProps {
  value: ModelPriceSourceV2 | "all";
  onChange: (value: ModelPriceSourceV2 | "all") => void;
  disabled?: boolean;
}

export function PriceSourceFilter({ value, onChange, disabled = false }: PriceSourceFilterProps) {
  const t = useTranslations("prices-v2");

  return (
    <div className="flex items-center gap-2">
      <Filter className="h-4 w-4 text-muted-foreground" />
      <Select
        value={value}
        onValueChange={(v) => onChange(v as ModelPriceSourceV2 | "all")}
        disabled={disabled}
      >
        <SelectTrigger className="w-[180px]" disabled={disabled}>
          <SelectValue placeholder={t("filters.sourceLabel")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("filters.sourceAll")}</SelectItem>
          <SelectItem value="remote">{t("source.remote")}</SelectItem>
          <SelectItem value="local">{t("source.local")}</SelectItem>
          <SelectItem value="user">{t("source.user")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
