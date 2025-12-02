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
import {
  getAllProviderTypes,
  getProviderTypeTranslationKey,
  PROVIDER_TYPE_CONFIG,
} from "@/lib/provider-type-utils";
import type { ProviderType } from "@/types/provider";

interface ProviderTypeFilterProps {
  value: ProviderType | "all";
  onChange: (value: ProviderType | "all") => void;
}

export function ProviderTypeFilter({ value, onChange }: ProviderTypeFilterProps) {
  const tTypes = useTranslations("settings.providers.types");
  const tForm = useTranslations("settings.providers.form");

  return (
    <div className="flex items-center gap-2">
      <Filter className="h-4 w-4 text-muted-foreground" />
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder={tForm("filterByType")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{tForm("filterAllProviders")}</SelectItem>
          {getAllProviderTypes().map((type) => {
            const config = PROVIDER_TYPE_CONFIG[type];
            const Icon = config.icon;
            const typeKey = getProviderTypeTranslationKey(type);
            const label = tTypes(`${typeKey}.label`);

            return (
              <SelectItem key={type} value={type}>
                <div className="flex items-center gap-2">
                  <Icon className={`h-3.5 w-3.5 ${config.iconColor}`} />
                  <span>{label}</span>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
