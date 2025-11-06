"use client";
import { useState, useMemo } from "react";
import { ProviderList } from "./provider-list";
import { ProviderTypeFilter } from "./provider-type-filter";
import { ProviderSortDropdown, type SortKey } from "./provider-sort-dropdown";
import type { ProviderDisplay, ProviderType } from "@/types/provider";
import type { User } from "@/types/user";
import type { CurrencyCode } from "@/lib/utils/currency";

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
  const [typeFilter, setTypeFilter] = useState<ProviderType | "all">("all");
  const [sortBy, setSortBy] = useState<SortKey>("priority");

  // 根据类型筛选供应商
  const filteredProviders = useMemo(() => {
    const filtered =
      typeFilter === "all"
        ? providers
        : providers.filter((provider) => provider.providerType === typeFilter);

    return [...filtered].sort((a, b) => {
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
  }, [providers, sortBy, typeFilter]);

  return (
    <div className="space-y-4">
      {/* 筛选条件 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ProviderTypeFilter value={typeFilter} onChange={setTypeFilter} />
          <ProviderSortDropdown value={sortBy} onChange={setSortBy} />
        </div>
        <div className="text-sm text-muted-foreground">
          显示 {filteredProviders.length} / {providers.length} 个供应商
        </div>
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
