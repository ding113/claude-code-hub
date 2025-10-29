"use client";
import { useState, useMemo } from "react";
import { ProviderList } from "./provider-list";
import { ProviderTypeFilter } from "./provider-type-filter";
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

  // 根据类型筛选供应商
  const filteredProviders = useMemo(() => {
    if (typeFilter === "all") {
      return providers;
    }
    return providers.filter((provider) => provider.providerType === typeFilter);
  }, [providers, typeFilter]);

  return (
    <div className="space-y-4">
      {/* 筛选条件 */}
      <div className="flex items-center justify-between">
        <ProviderTypeFilter value={typeFilter} onChange={setTypeFilter} />
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
