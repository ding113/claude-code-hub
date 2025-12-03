"use client";

import { ChevronDown, ChevronUp, Dot } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { QuotaProgress } from "@/components/quota/quota-progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { getContrastTextColor, getGroupColor } from "@/lib/utils/color";
import { type CurrencyCode, formatCurrency } from "@/lib/utils/currency";
import { formatDateDistance } from "@/lib/utils/date-format";
import type { UserKeyWithUsage, UserQuotaWithUsage } from "./types";

interface UserQuotaListItemProps {
  user: UserQuotaWithUsage;
  currencyCode?: CurrencyCode;
}

const MAX_INLINE_TAGS = 3;
const TOP_KEY_COUNT = 3;

function KeyPreview({
  keyData,
  currencyCode,
}: {
  keyData: UserKeyWithUsage;
  currencyCode: CurrencyCode;
}) {
  return (
    <Badge variant="secondary" className="font-mono text-xs">
      {keyData.name} · {formatCurrency(keyData.totalUsage, currencyCode)}
    </Badge>
  );
}

function formatLimitValue(limit: number | null, currencyCode: CurrencyCode, placeholder: string) {
  if (!limit || limit <= 0) return placeholder;
  return formatCurrency(limit, currencyCode);
}

export function UserQuotaListItem({ user, currencyCode = "USD" }: UserQuotaListItemProps) {
  const t = useTranslations("quota.users");
  const locale = useLocale();
  const [keysOpen, setKeysOpen] = useState(false);

  const sortedKeys = useMemo(() => {
    return [...user.keys].sort((a, b) => {
      if (b.todayUsage === a.todayUsage) {
        return b.totalUsage - a.totalUsage;
      }
      return b.todayUsage - a.todayUsage;
    });
  }, [user.keys]);

  const topKeys = sortedKeys.slice(0, TOP_KEY_COUNT);
  const remainingKeys = sortedKeys.slice(TOP_KEY_COUNT);

  const totalLimit = user.limitTotalUsd ?? null;
  const totalProgress = totalLimit && totalLimit > 0 ? (user.totalUsage / totalLimit) * 100 : 0;

  return (
    <Card className="border bg-card">
      <CardContent className="space-y-3 p-3 sm:p-4">
        {/* Header: name + badges */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-base sm:text-lg">{user.name}</span>
              <Badge variant={user.role === "admin" ? "default" : "secondary"} className="text-xs">
                {t(`role.${user.role}`)}
              </Badge>
              {user.providerGroup &&
                (() => {
                  const bgColor = getGroupColor(user.providerGroup);
                  return (
                    <Badge
                      className="text-xs"
                      style={{ backgroundColor: bgColor, color: getContrastTextColor(bgColor) }}
                    >
                      {user.providerGroup}
                    </Badge>
                  );
                })()}
            </div>

            {/* Tags */}
            {user.tags && user.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {user.tags.slice(0, MAX_INLINE_TAGS).map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
                {user.tags.length > MAX_INLINE_TAGS && (
                  <Badge variant="secondary" className="text-xs">
                    +{user.tags.length - MAX_INLINE_TAGS}
                  </Badge>
                )}
              </div>
            )}

            {user.note && <p className="text-sm text-muted-foreground line-clamp-2">{user.note}</p>}
          </div>

          <div className="text-right space-y-1">
            <p className="text-xs text-muted-foreground">{t("totalCostAllTime")}</p>
            <p className="text-lg font-semibold">{formatCurrency(user.totalUsage, currencyCode)}</p>
          </div>
        </div>

        {/* Quota summary */}
        <div className="grid gap-3 md:grid-cols-2">
          {/* RPM */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("rpm.label")}</span>
              {user.quota?.rpm ? (
                <span className="font-medium">
                  {user.quota.rpm.current} / {user.quota.rpm.limit}
                </span>
              ) : (
                <span className="text-muted-foreground">{t("noLimitSet")}</span>
              )}
            </div>
            <Progress
              value={
                user.quota?.rpm && user.quota.rpm.limit > 0
                  ? (user.quota.rpm.current / user.quota.rpm.limit) * 100
                  : 0
              }
              className="h-2"
            />
          </div>

          {/* Daily cost */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("dailyCost.label")}</span>
              {user.quota?.dailyCost ? (
                <span className="font-medium">
                  {formatCurrency(user.quota.dailyCost.current, currencyCode)} /{" "}
                  {formatCurrency(user.quota.dailyCost.limit, currencyCode)}
                </span>
              ) : (
                <span className="text-muted-foreground">{t("noLimitSet")}</span>
              )}
            </div>
            {user.quota?.dailyCost ? (
              <QuotaProgress
                current={user.quota.dailyCost.current}
                limit={user.quota.dailyCost.limit}
                className="h-2"
              />
            ) : (
              <div className="h-2 bg-muted rounded-full" />
            )}
            {user.quota?.dailyCost?.resetAt && (
              <p className="text-xs text-muted-foreground">
                {t("dailyCost.resetAt")}{" "}
                {formatDateDistance(new Date(user.quota.dailyCost.resetAt), new Date(), locale)}
              </p>
            )}
          </div>
        </div>

        {/* Other limits */}
        <div className="grid gap-2 sm:gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="text-sm space-y-1">
            <p className="text-muted-foreground">{t("limit5h")}</p>
            <p className="font-medium">
              {formatLimitValue(user.limit5hUsd, currencyCode, t("noLimitSet"))}
            </p>
          </div>
          <div className="text-sm space-y-1">
            <p className="text-muted-foreground">{t("limitWeekly")}</p>
            <p className="font-medium">
              {formatLimitValue(user.limitWeeklyUsd, currencyCode, t("noLimitSet"))}
            </p>
          </div>
          <div className="text-sm space-y-1">
            <p className="text-muted-foreground">{t("limitMonthly")}</p>
            <p className="font-medium">
              {formatLimitValue(user.limitMonthlyUsd, currencyCode, t("noLimitSet"))}
            </p>
          </div>
          <div className="text-sm space-y-1">
            <p className="text-muted-foreground">{t("limitTotal")}</p>
            {totalLimit && totalLimit > 0 ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{formatCurrency(totalLimit, currencyCode)}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatCurrency(user.totalUsage, currencyCode)}
                  </span>
                </div>
                <QuotaProgress current={user.totalUsage} limit={totalLimit} className="h-2" />
                <p className="text-xs text-muted-foreground">{totalProgress.toFixed(1)}%</p>
              </div>
            ) : (
              <p className="font-medium">{t("noLimitSet")}</p>
            )}
          </div>
          <div className="text-sm space-y-1">
            <p className="text-muted-foreground">{t("limitConcurrent")}</p>
            <p className="font-medium">
              {user.limitConcurrentSessions && user.limitConcurrentSessions > 0
                ? user.limitConcurrentSessions
                : t("noLimitSet")}
            </p>
          </div>
        </div>

        {/* Keys preview + full list */}
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="text-foreground font-medium">{t("keys")}:</span>
            {topKeys.length === 0 && <span className="text-muted-foreground">{t("noKeys")}</span>}
            {topKeys.map((key) => (
              <KeyPreview key={key.id} keyData={key} currencyCode={currencyCode} />
            ))}
            {remainingKeys.length > 0 && (
              <Collapsible open={keysOpen} onOpenChange={setKeysOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="link" size="sm" className="px-1">
                    +{remainingKeys.length} {t("more")}{" "}
                    {keysOpen ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-2">
                  {remainingKeys.map((key) => (
                    <div
                      key={key.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm"
                    >
                      <span className="font-medium">{key.name}</span>
                      <Dot className="h-4 w-4 text-muted-foreground" />
                      <Badge
                        variant={key.status === "enabled" ? "default" : "outline"}
                        className="text-xs"
                      >
                        {t(`keyStatus.${key.status}`)}
                      </Badge>
                      <Dot className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        {t("totalCost")}: {formatCurrency(key.totalUsage, currencyCode)}
                      </span>
                      <Dot className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        {t("todayCost")}: {formatCurrency(key.todayUsage, currencyCode)}
                      </span>
                      <Dot className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        {t("limitTotal")}:{" "}
                        {formatLimitValue(key.limitTotalUsd, currencyCode, t("noLimitSet"))}
                      </span>
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
