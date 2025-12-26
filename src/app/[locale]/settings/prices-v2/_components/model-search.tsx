"use client";

import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";

interface ModelSearchProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function ModelSearch({ value, onChange, disabled = false }: ModelSearchProps) {
  const t = useTranslations("prices-v2");

  return (
    <div className="relative flex-1">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("filters.searchPlaceholder")}
        className="pl-9 pr-9"
        disabled={disabled}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={t("filters.clear")}
          disabled={disabled}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">{t("filters.clear")}</span>
        </button>
      ) : null}
    </div>
  );
}
