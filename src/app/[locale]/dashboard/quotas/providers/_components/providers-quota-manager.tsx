"use client";

import { useState, useMemo } from "react";
import { Search, X } from "lucide-react";
import { ProviderTypeFilter } from "@/app/[locale]/settings/providers/_components/provider-type-filter";
import { ProviderQuotaSortDropdown, type QuotaSortKey } from "./provider-quota-sort-dropdown";
import { ProvidersQuotaClient } from "./providers-quota-client";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/lib/hooks/use-debounce";
import type { ProviderType } from "@/types/provider";
import type { CurrencyCode } from "@/lib/utils/currency";
import { useTranslations } from "next-intl";

interface ProviderQuota {
  cost5h: { current: number; limit: number | null; resetInfo: string };
  costDaily: { current: number; limit: number | null; resetAt?: Date };
  costWeekly: { current: number; limit: number | null; resetAt: Date };
  costMonthly: { current: number; limit: number | null; resetAt: Date };
  concurrentSessions: { current: number; limit: number };
}

interface ProviderWithQuota {
  id: number;
  name: string;
  providerType: ProviderType;
  isEnabled: boolean;
  priority: number;
  weight: number;
  quota: ProviderQuota | null;
}

interface ProvidersQuotaManagerProps {
  providers: ProviderWithQuota[];
  currencyCode?: CurrencyCode;
}

export function ProvidersQuotaManager({
  providers,
  currencyCode = "USD",
}: ProvidersQuotaManagerProps) {
  const [typeFilter, setTypeFilter] = useState<ProviderType | "all">("all");
  const [sortBy, setSortBy] = useState<QuotaSortKey>("priority");
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  const t = useTranslations("quota.providers");
  const tSearch = useTranslations("settings.providers.search");

  // 计算筛选后的供应商数量（包括搜索）
  const filteredCount = useMemo(() => {
    let filtered =
      typeFilter === "all" ? providers : providers.filter((p) => p.providerType === typeFilter);

    if (debouncedSearchTerm) {
      const term = debouncedSearchTerm.toLowerCase();
      filtered = filtered.filter((p) => p.name.toLowerCase().includes(term));
    }

    return filtered.length;
  }, [providers, typeFilter, debouncedSearchTerm]);

  return (
    <div className="space-y-4">
      {/* 筛选和搜索工具栏 */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <ProviderTypeFilter value={typeFilter} onChange={setTypeFilter} />
          <ProviderQuotaSortDropdown value={sortBy} onChange={setSortBy} />
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder={t("searchPlaceholder")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-9"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={tSearch("clear")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* 搜索结果提示或筛选统计 */}
        {debouncedSearchTerm ? (
          <p className="text-sm text-muted-foreground">
            {tSearch("found", { count: filteredCount })}
          </p>
        ) : (
          <div className="text-sm text-muted-foreground">
            {t("filterCount", { filtered: filteredCount, total: providers.length })}
          </div>
        )}
      </div>

      {/* 供应商列表 */}
      <ProvidersQuotaClient
        providers={providers}
        typeFilter={typeFilter}
        sortBy={sortBy}
        searchTerm={debouncedSearchTerm}
        currencyCode={currencyCode}
      />
    </div>
  );
}
