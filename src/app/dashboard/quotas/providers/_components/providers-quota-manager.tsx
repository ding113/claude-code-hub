"use client";

import { useState } from "react";
import { ProviderTypeFilter } from "@/app/settings/providers/_components/provider-type-filter";
import { ProvidersQuotaClient } from "./providers-quota-client";
import type { ProviderType } from "@/types/provider";
import type { CurrencyCode } from "@/lib/utils/currency";

interface ProviderQuota {
  cost5h: { current: number; limit: number | null; resetInfo: string };
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

  // 计算筛选后的供应商数量
  const filteredCount =
    typeFilter === "all"
      ? providers.length
      : providers.filter((p) => p.providerType === typeFilter).length;

  return (
    <div className="space-y-4">
      {/* 类型筛选器 */}
      <div className="flex items-center justify-between">
        <ProviderTypeFilter value={typeFilter} onChange={setTypeFilter} />
        <div className="text-sm text-muted-foreground">
          显示 {filteredCount} / {providers.length} 个供应商
        </div>
      </div>

      {/* 供应商列表 */}
      <ProvidersQuotaClient
        providers={providers}
        typeFilter={typeFilter}
        currencyCode={currencyCode}
      />
    </div>
  );
}
