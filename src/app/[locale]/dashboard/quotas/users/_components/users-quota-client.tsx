"use client";

import { ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { UserQuotaWithUsage, UsersQuotaClientProps } from "./types";
import { UserQuotaListItem } from "./user-quota-list-item";
import { UserUnlimitedItem } from "./user-unlimited-item";

const COLLAPSIBLE_TRIGGER_CLASS =
  "flex w-full items-center justify-between rounded-lg border bg-card px-4 py-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors";

function getUsageRate(user: UserQuotaWithUsage): number {
  const rpmRate =
    user.quota?.rpm && user.quota.rpm.limit > 0
      ? (user.quota.rpm.current / user.quota.rpm.limit) * 100
      : 0;
  const dailyRate =
    user.quota?.dailyCost && user.quota.dailyCost.limit > 0
      ? (user.quota.dailyCost.current / user.quota.dailyCost.limit) * 100
      : 0;
  return Math.max(rpmRate, dailyRate);
}

function hasQuota(user: UserQuotaWithUsage): boolean {
  const limits = [
    user.quota?.rpm?.limit ?? 0,
    user.quota?.dailyCost?.limit ?? 0,
    user.limit5hUsd ?? 0,
    user.limitWeeklyUsd ?? 0,
    user.limitMonthlyUsd ?? 0,
    user.limitTotalUsd ?? 0,
    user.limitConcurrentSessions ?? 0,
  ];
  return limits.some((limit) => (limit ?? 0) > 0);
}

export function UsersQuotaClient({
  users,
  currencyCode = "USD",
  searchQuery = "",
  sortBy = "name",
  filter = "all",
}: UsersQuotaClientProps) {
  const t = useTranslations("quota.users");
  const locale = useLocale();
  const [withQuotasOpen, setWithQuotasOpen] = useState(true);
  const [unlimitedOpen, setUnlimitedOpen] = useState(false);

  const processedUsers = useMemo(() => {
    let result = users;

    if (searchQuery) {
      const lower = searchQuery.toLowerCase();
      result = result.filter((user) => user.name.toLowerCase().includes(lower));
    }

    if (filter === "warning") {
      result = result.filter((user) => {
        const rate = getUsageRate(user);
        return rate >= 60 && rate < 100;
      });
    } else if (filter === "exceeded") {
      result = result.filter((user) => getUsageRate(user) >= 100);
    }

    const sorted = [...result];
    if (sortBy === "usage") {
      sorted.sort((a, b) => getUsageRate(b) - getUsageRate(a));
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name, locale));
    }

    return sorted;
  }, [users, searchQuery, sortBy, filter, locale]);

  const { withQuotas, unlimited } = useMemo(() => {
    const withQuotaUsers: UserQuotaWithUsage[] = [];
    const unlimitedUsers: UserQuotaWithUsage[] = [];

    processedUsers.forEach((user) => {
      if (hasQuota(user)) {
        withQuotaUsers.push(user);
      } else {
        unlimitedUsers.push(user);
      }
    });

    return { withQuotas: withQuotaUsers, unlimited: unlimitedUsers };
  }, [processedUsers]);

  if (processedUsers.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <p className="text-muted-foreground">{searchQuery ? t("noMatches") : t("noData")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Collapsible open={withQuotasOpen} onOpenChange={setWithQuotasOpen}>
        <CollapsibleTrigger className={COLLAPSIBLE_TRIGGER_CLASS}>
          <span>
            {t("withQuotas")} ({withQuotas.length})
          </span>
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${withQuotasOpen ? "rotate-180" : ""}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
          {withQuotas.length === 0 && (
            <p className="px-2 text-sm text-muted-foreground">{t("noMatches")}</p>
          )}
          {withQuotas.map((user) => (
            <UserQuotaListItem key={user.id} user={user} currencyCode={currencyCode} />
          ))}
        </CollapsibleContent>
      </Collapsible>

      <Collapsible open={unlimitedOpen} onOpenChange={setUnlimitedOpen}>
        <CollapsibleTrigger className={COLLAPSIBLE_TRIGGER_CLASS}>
          <span>
            {t("unlimited")} ({unlimited.length})
          </span>
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${unlimitedOpen ? "rotate-180" : ""}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
          {unlimited.length === 0 && (
            <p className="px-2 text-sm text-muted-foreground">{t("noUnlimited")}</p>
          )}
          {unlimited.map((user) => (
            <UserUnlimitedItem key={user.id} user={user} currencyCode={currencyCode} />
          ))}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
