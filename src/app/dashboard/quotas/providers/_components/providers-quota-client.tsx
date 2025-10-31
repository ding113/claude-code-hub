"use client";

import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, type CurrencyCode } from "@/lib/utils/currency";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import type { ProviderType } from "@/types/provider";

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

interface ProvidersQuotaClientProps {
  providers: ProviderWithQuota[];
  typeFilter?: ProviderType | "all";
  currencyCode?: CurrencyCode;
}

export function ProvidersQuotaClient({
  providers,
  typeFilter = "all",
  currencyCode = "USD",
}: ProvidersQuotaClientProps) {
  // 筛选供应商
  const filteredProviders = useMemo(() => {
    if (typeFilter === "all") {
      return providers;
    }
    return providers.filter((provider) => provider.providerType === typeFilter);
  }, [providers, typeFilter]);

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredProviders.map((provider) => (
          <Card key={provider.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{provider.name}</CardTitle>
                <div className="flex gap-2">
                  <Badge variant={provider.isEnabled ? "default" : "secondary"}>
                    {provider.isEnabled ? "启用" : "禁用"}
                  </Badge>
                  <Badge variant="outline">{provider.providerType}</Badge>
                </div>
              </div>
              <CardDescription>
                优先级: {provider.priority} · 权重: {provider.weight}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {provider.quota ? (
                <>
                  {/* 5小时消费 */}
                  {provider.quota.cost5h.limit && provider.quota.cost5h.limit > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">5小时消费</span>
                        <span className="font-medium">
                          {formatCurrency(provider.quota.cost5h.current, currencyCode)} /{" "}
                          {formatCurrency(provider.quota.cost5h.limit, currencyCode)}
                        </span>
                      </div>
                      <Progress
                        value={
                          (provider.quota.cost5h.current / (provider.quota.cost5h.limit || 1)) * 100
                        }
                        className="h-2"
                      />
                      <p className="text-xs text-muted-foreground">
                        {provider.quota.cost5h.resetInfo}
                      </p>
                    </div>
                  )}

                  {/* 周消费 */}
                  {provider.quota.costWeekly.limit && provider.quota.costWeekly.limit > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">周消费</span>
                        <span className="font-medium">
                          {formatCurrency(provider.quota.costWeekly.current, currencyCode)} /{" "}
                          {formatCurrency(provider.quota.costWeekly.limit, currencyCode)}
                        </span>
                      </div>
                      <Progress
                        value={
                          (provider.quota.costWeekly.current /
                            (provider.quota.costWeekly.limit || 1)) *
                          100
                        }
                        className="h-2"
                      />
                      <p className="text-xs text-muted-foreground">
                        重置于{" "}
                        {formatDistanceToNow(new Date(provider.quota.costWeekly.resetAt), {
                          addSuffix: true,
                          locale: zhCN,
                        })}
                      </p>
                    </div>
                  )}

                  {/* 月消费 */}
                  {provider.quota.costMonthly.limit && provider.quota.costMonthly.limit > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">月消费</span>
                        <span className="font-medium">
                          {formatCurrency(provider.quota.costMonthly.current, currencyCode)} /{" "}
                          {formatCurrency(provider.quota.costMonthly.limit, currencyCode)}
                        </span>
                      </div>
                      <Progress
                        value={
                          (provider.quota.costMonthly.current /
                            (provider.quota.costMonthly.limit || 1)) *
                          100
                        }
                        className="h-2"
                      />
                      <p className="text-xs text-muted-foreground">
                        重置于{" "}
                        {formatDistanceToNow(new Date(provider.quota.costMonthly.resetAt), {
                          addSuffix: true,
                          locale: zhCN,
                        })}
                      </p>
                    </div>
                  )}

                  {/* 并发 Session */}
                  {provider.quota.concurrentSessions.limit > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">并发 Session</span>
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

                  {!provider.quota.cost5h.limit &&
                    !provider.quota.costWeekly.limit &&
                    !provider.quota.costMonthly.limit &&
                    provider.quota.concurrentSessions.limit === 0 && (
                      <p className="text-sm text-muted-foreground">未设置限额</p>
                    )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">无法获取限额信息</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredProviders.length === 0 && (
        <Card>
          <CardContent className="flex items-center justify-center py-10">
            <p className="text-muted-foreground">没有匹配的供应商</p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
