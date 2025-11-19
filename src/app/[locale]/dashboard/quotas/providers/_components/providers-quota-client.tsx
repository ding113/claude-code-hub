"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { formatCurrency, type CurrencyCode } from "@/lib/utils/currency";
import { formatDateDistance } from "@/lib/utils/date-format";
import { useLocale, useTranslations } from "next-intl";
import type { ProviderType } from "@/types/provider";

interface ProviderQuota {
  cost5h: { current: number; limit: number | null; resetInfo: string };
  costDaily: { current: number; limit: number | null; resetAt: Date };
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

export function ProvidersQuotaClient({
  providers,
  typeFilter = "all",
  currencyCode = "USD",
}: ProvidersQuotaClientProps) {
  // 折叠状态
  const [isUnlimitedOpen, setIsUnlimitedOpen] = useState(false);
  const locale = useLocale();
  const t = useTranslations("quota.providers");

  // 筛选、排序和分组供应商
  const { providersWithQuota, providersWithoutQuota } = useMemo(() => {
    // 先按类型筛选
    const filtered =
      typeFilter === "all"
        ? providers
        : providers.filter((provider) => provider.providerType === typeFilter);

    // 分组
    const withQuota: ProviderWithQuota[] = [];
    const withoutQuota: ProviderWithQuota[] = [];

    filtered.forEach((provider) => {
      if (hasQuotaLimit(provider.quota)) {
        withQuota.push(provider);
      } else {
        withoutQuota.push(provider);
      }
    });

    // 有限额的供应商：按优先级降序，优先级相同按权重降序
    withQuota.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return b.weight - a.weight;
    });

    // 无限额的供应商：保持原有顺序（由数据库查询决定）
    // 不需要额外排序

    return {
      providersWithQuota: withQuota,
      providersWithoutQuota: withoutQuota,
    };
  }, [providers, typeFilter]);

  // 渲染供应商卡片的函数
  const renderProviderCard = (provider: ProviderWithQuota) => (
    <Card key={provider.id}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{provider.name}</CardTitle>
          <div className="flex gap-2">
            <Badge variant={provider.isEnabled ? "default" : "secondary"}>
              {provider.isEnabled ? t("status.enabled") : t("status.disabled")}
            </Badge>
            <Badge variant="outline">{provider.providerType}</Badge>
          </div>
        </div>
        <CardDescription>
          {t("card.priority")}: {provider.priority} · {t("card.weight")}: {provider.weight}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {provider.quota ? (
          <>
            {/* 5小时消费 */}
            {provider.quota.cost5h.limit && provider.quota.cost5h.limit > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t("cost5h.label")}</span>
                  <span className="font-medium">
                    {formatCurrency(provider.quota.cost5h.current, currencyCode)} /{" "}
                    {formatCurrency(provider.quota.cost5h.limit, currencyCode)}
                  </span>
                </div>
                <Progress
                  value={(provider.quota.cost5h.current / (provider.quota.cost5h.limit || 1)) * 100}
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">{provider.quota.cost5h.resetInfo}</p>
              </div>
            )}

            {provider.quota.costDaily.limit && provider.quota.costDaily.limit > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t("costDaily.label")}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("costDaily.resetAt")} {formatDateDistance(provider.quota.costDaily.resetAt, locale)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm font-mono">
                  <span>
                    {formatCurrency(provider.quota.costDaily.current, currencyCode)} /{" "}
                    {formatCurrency(provider.quota.costDaily.limit, currencyCode)}
                  </span>
                </div>
                <Progress
                  value={(provider.quota.costDaily.current / (provider.quota.costDaily.limit || 1)) * 100}
                  className="h-2"
                />
              </div>
            )}

            {/* 周消费 */}
            {provider.quota.costWeekly.limit && provider.quota.costWeekly.limit > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t("costWeekly.label")}</span>
                  <span className="font-medium">
                    {formatCurrency(provider.quota.costWeekly.current, currencyCode)} /{" "}
                    {formatCurrency(provider.quota.costWeekly.limit, currencyCode)}
                  </span>
                </div>
                <Progress
                  value={
                    (provider.quota.costWeekly.current / (provider.quota.costWeekly.limit || 1)) *
                    100
                  }
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">
                  {t("costWeekly.resetAt")}{" "}
                  {formatDateDistance(
                    new Date(provider.quota.costWeekly.resetAt),
                    new Date(),
                    locale
                  )}
                </p>
              </div>
            )}

            {/* 月消费 */}
            {provider.quota.costMonthly.limit && provider.quota.costMonthly.limit > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t("costMonthly.label")}</span>
                  <span className="font-medium">
                    {formatCurrency(provider.quota.costMonthly.current, currencyCode)} /{" "}
                    {formatCurrency(provider.quota.costMonthly.limit, currencyCode)}
                  </span>
                </div>
                <Progress
                  value={
                    (provider.quota.costMonthly.current / (provider.quota.costMonthly.limit || 1)) *
                    100
                  }
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">
                  {t("costMonthly.resetAt")}{" "}
                  {formatDateDistance(
                    new Date(provider.quota.costMonthly.resetAt),
                    new Date(),
                    locale
                  )}
                </p>
              </div>
            )}

            {/* 并发 Session */}
            {provider.quota.concurrentSessions.limit > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t("concurrentSessions.label")}</span>
                  <span className="font-medium">
                    {provider.quota.concurrentSessions.current} /{" "}
                    {provider.quota.concurrentSessions.limit}
                  </span>
                </div>
                <Progress
                  value={
                    (provider.quota.concurrentSessions.current /
                      provider.quota.concurrentSessions.limit) *
                    100
                  }
                  className="h-2"
                />
              </div>
            )}

            {!hasQuotaLimit(provider.quota) && (
              <p className="text-sm text-muted-foreground">{t("noQuotaSet")}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noQuotaData")}</p>
        )}
      </CardContent>
    </Card>
  );

  const totalProviders = providersWithQuota.length + providersWithoutQuota.length;

  return (
    <>
      {totalProviders === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-10">
            <p className="text-muted-foreground">{t("noMatches")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* 有限额的供应商 */}
          {providersWithQuota.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {providersWithQuota.map(renderProviderCard)}
            </div>
          )}

          {/* 无限额的供应商（折叠区域） */}
          {providersWithoutQuota.length > 0 && (
            <Collapsible open={isUnlimitedOpen} onOpenChange={setIsUnlimitedOpen}>
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border bg-card p-4 text-sm font-medium hover:bg-accent">
                <span className="text-muted-foreground">
                  {t("unlimitedSection", { count: providersWithoutQuota.length })}
                </span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${isUnlimitedOpen ? "rotate-180" : ""}`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {providersWithoutQuota.map(renderProviderCard)}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )}
    </>
  );
}
