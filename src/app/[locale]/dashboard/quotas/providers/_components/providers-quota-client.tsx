"use client";

import { useMemo, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ProviderType } from "@/types/provider";
import type { CurrencyCode } from "@/lib/utils/currency";
import type { QuotaSortKey } from "./provider-quota-sort-dropdown";
import { ProviderQuotaListItem } from "./provider-quota-list-item";

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

interface ProvidersQuotaClientProps {
  providers: ProviderWithQuota[];
  typeFilter?: ProviderType | "all";
  sortBy?: QuotaSortKey;
  searchTerm?: string;
  currencyCode?: CurrencyCode;
}

// 判断供应商是否设置了限额
function hasQuotaLimit(quota: ProviderQuota | null): boolean {
  if (!quota) return false;
  return (
    (quota.cost5h.limit !== null && quota.cost5h.limit > 0) ||
    (quota.costDaily.limit !== null && quota.costDaily.limit > 0) ||
    (quota.costWeekly.limit !== null && quota.costWeekly.limit > 0) ||
    (quota.costMonthly.limit !== null && quota.costMonthly.limit > 0) ||
    quota.concurrentSessions.limit > 0
  );
}

// 计算供应商的最高使用率（用于按使用量排序）
function calculateMaxUsage(provider: ProviderWithQuota): number {
  if (!provider.quota) return 0;

  const usages: number[] = [];

  if (provider.quota.cost5h.limit && provider.quota.cost5h.limit > 0) {
    usages.push((provider.quota.cost5h.current / provider.quota.cost5h.limit) * 100);
  }
  if (provider.quota.costDaily.limit && provider.quota.costDaily.limit > 0) {
    usages.push((provider.quota.costDaily.current / provider.quota.costDaily.limit) * 100);
  }
  if (provider.quota.costWeekly.limit && provider.quota.costWeekly.limit > 0) {
    usages.push((provider.quota.costWeekly.current / provider.quota.costWeekly.limit) * 100);
  }
  if (provider.quota.costMonthly.limit && provider.quota.costMonthly.limit > 0) {
    usages.push((provider.quota.costMonthly.current / provider.quota.costMonthly.limit) * 100);
  }
  if (provider.quota.concurrentSessions.limit > 0) {
    usages.push(
      (provider.quota.concurrentSessions.current / provider.quota.concurrentSessions.limit) * 100
    );
  }

  return usages.length > 0 ? Math.max(...usages) : 0;
}

export function ProvidersQuotaClient({
  providers,
  typeFilter = "all",
  sortBy = "priority",
  searchTerm = "",
  currencyCode = "USD",
}: ProvidersQuotaClientProps) {
  // 折叠状态
  const [isUnlimitedOpen, setIsUnlimitedOpen] = useState(false);
  const t = useTranslations("quota.providers");

  // 筛选、搜索、排序和分组供应商
  const { providersWithQuota, providersWithoutQuota } = useMemo(() => {
    // 1. 按类型筛选
    let filtered =
      typeFilter === "all"
        ? providers
        : providers.filter((provider) => provider.providerType === typeFilter);

    // 2. 按搜索词过滤
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((p) => p.name.toLowerCase().includes(term));
    }

    // 3. 分组：有限额 vs 无限额
    const withQuota: ProviderWithQuota[] = [];
    const withoutQuota: ProviderWithQuota[] = [];

    filtered.forEach((provider) => {
      if (hasQuotaLimit(provider.quota)) {
        withQuota.push(provider);
      } else {
        withoutQuota.push(provider);
      }
    });

    // 4. 排序（仅对有限额的供应商排序）
    if (sortBy === "usage") {
      // 预计算 usage 值以提升排序性能
      const usageMap = new Map<number, number>();
      withQuota.forEach((p) => usageMap.set(p.id, calculateMaxUsage(p)));

      withQuota.sort((a, b) => {
        const usageA = usageMap.get(a.id) ?? 0;
        const usageB = usageMap.get(b.id) ?? 0;
        return usageB - usageA;
      });
    } else {
      withQuota.sort((a, b) => {
        switch (sortBy) {
          case "name":
            return a.name.localeCompare(b.name);
          case "priority":
            // 优先级：数值越小越优先，升序排列
            return a.priority - b.priority;
          case "weight":
            // 权重：数值越大越优先，降序排列
            return b.weight - a.weight;
          default:
            return 0;
        }
      });
    }

    return {
      providersWithQuota: withQuota,
      providersWithoutQuota: withoutQuota,
    };
  }, [providers, typeFilter, sortBy, searchTerm]);

  const totalProviders = providersWithQuota.length + providersWithoutQuota.length;

  // 空状态
  if (totalProviders === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
          <Globe className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="font-medium text-foreground mb-1">{t("noMatches")}</h3>
        <p className="text-sm text-muted-foreground text-center">
          {searchTerm ? t("noMatchesDesc") : t("noProvidersDesc")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 有限额的供应商（列表形式） */}
      {providersWithQuota.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          {providersWithQuota.map((provider) => (
            <ProviderQuotaListItem
              key={provider.id}
              provider={provider}
              currencyCode={currencyCode}
            />
          ))}
        </div>
      )}

      {/* 无限额的供应商（折叠区域） */}
      {providersWithoutQuota.length > 0 && (
        <Collapsible open={isUnlimitedOpen} onOpenChange={setIsUnlimitedOpen}>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border bg-card p-4 text-sm font-medium hover:bg-accent transition-colors">
            <span className="text-muted-foreground">
              {t("unlimitedSection", { count: providersWithoutQuota.length })}
            </span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${isUnlimitedOpen ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4">
            <div className="border rounded-lg overflow-hidden">
              {providersWithoutQuota.map((provider) => (
                <div
                  key={provider.id}
                  className="flex items-center gap-4 py-3 px-4 border-b last:border-b-0 hover:bg-muted/50 transition-colors"
                >
                  <span className="font-medium">{provider.name}</span>
                  <span className="text-sm text-muted-foreground">{t("noQuotaSet")}</span>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
