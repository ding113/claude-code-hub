"use client";
import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/lib/hooks/use-debounce";
import type { CurrencyCode } from "@/lib/utils/currency";
import type { ProviderDisplay, ProviderType } from "@/types/provider";
import type { User } from "@/types/user";
import { ProviderList } from "./provider-list";
import { ProviderSortDropdown, type SortKey } from "./provider-sort-dropdown";
import { ProviderTypeFilter } from "./provider-type-filter";

interface ProviderManagerProps {
  providers: ProviderDisplay[];
  currentUser?: User;
  healthStatus: Record<
    number,
    {
      circuitState: "closed" | "open" | "half-open";
      failureCount: number;
      lastFailureTime: number | null;
      circuitOpenUntil: number | null;
      recoveryMinutes: number | null;
    }
  >;
  currencyCode?: CurrencyCode;
  enableMultiProviderTypes: boolean;
}

export function ProviderManager({
  providers,
  currentUser,
  healthStatus,
  currencyCode = "USD",
  enableMultiProviderTypes,
}: ProviderManagerProps) {
  const t = useTranslations("settings.providers.search");
  const [typeFilter, setTypeFilter] = useState<ProviderType | "all">("all");
  const [sortBy, setSortBy] = useState<SortKey>("priority");
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  // 统一过滤逻辑：搜索 + 类型筛选 + 排序
  const filteredProviders = useMemo(() => {
    let result = providers;

    // 搜索过滤（name, url, groupTag - 支持匹配逗号分隔的单个标签）
    if (debouncedSearchTerm) {
      const term = debouncedSearchTerm.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(term) ||
          p.url.toLowerCase().includes(term) ||
          p.groupTag
            ?.split(",")
            .map((t) => t.trim().toLowerCase())
            .some((tag) => tag.includes(term))
      );
    }

    // 类型筛选
    if (typeFilter !== "all") {
      result = result.filter((p) => p.providerType === typeFilter);
    }

    // 排序
    return [...result].sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "priority":
          // 优先级：数值越小越优先（1 > 2 > 3），升序排列
          return a.priority - b.priority;
        case "weight":
          // 权重：数值越大越优先，降序排列
          return b.weight - a.weight;
        case "createdAt": {
          const timeA = new Date(a.createdAt).getTime();
          const timeB = new Date(b.createdAt).getTime();
          if (Number.isNaN(timeA) || Number.isNaN(timeB)) {
            return b.createdAt.localeCompare(a.createdAt);
          }
          return timeB - timeA;
        }
        default:
          return 0;
      }
    });
  }, [providers, debouncedSearchTerm, typeFilter, sortBy]);

  return (
    <div className="space-y-4">
      {/* 筛选条件 */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <ProviderTypeFilter value={typeFilter} onChange={setTypeFilter} />
          <ProviderSortDropdown value={sortBy} onChange={setSortBy} />
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder={t("placeholder")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-9"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={t("clear")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        {/* 搜索结果提示 */}
        {debouncedSearchTerm && (
          <p className="text-sm text-muted-foreground">
            {filteredProviders.length > 0
              ? t("found", { count: filteredProviders.length })
              : t("notFound")}
          </p>
        )}
        {!debouncedSearchTerm && (
          <div className="text-sm text-muted-foreground">
            {t("showing", { filtered: filteredProviders.length, total: providers.length })}
          </div>
        )}
      </div>

      {/* 供应商列表 */}
      <ProviderList
        providers={filteredProviders}
        currentUser={currentUser}
        healthStatus={healthStatus}
        currencyCode={currencyCode}
        enableMultiProviderTypes={enableMultiProviderTypes}
      />
    </div>
  );
}

export type { ProviderDisplay } from "@/types/provider";
