"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/routing";
import { DEFAULT_FILTERS, resolveTimePresetDates, type UserInsightsFilters } from "./filters/types";
import { UserInsightsFilterBar } from "./filters/user-insights-filter-bar";
import { UserKeyTrendChart } from "./user-key-trend-chart";
import { UserModelBreakdown } from "./user-model-breakdown";
import { UserOverviewCards } from "./user-overview-cards";
import { UserProviderBreakdown } from "./user-provider-breakdown";

interface UserInsightsViewProps {
  userId: number;
  userName: string;
}

export function UserInsightsView({ userId, userName }: UserInsightsViewProps) {
  const t = useTranslations("dashboard.leaderboard.userInsights");
  const router = useRouter();
  const [filters, setFilters] = useState<UserInsightsFilters>(DEFAULT_FILTERS);

  const { startDate, endDate } = resolveTimePresetDates(filters.timeRange);

  return (
    <div className="space-y-6" data-testid="user-insights-page">
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/dashboard/leaderboard?scope=user")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t("backToLeaderboard")}
        </Button>
        <div>
          <h1 className="text-2xl font-bold">
            {t("title")} - {userName}
          </h1>
        </div>
      </div>

      <UserOverviewCards userId={userId} />

      <UserInsightsFilterBar userId={userId} filters={filters} onFiltersChange={setFilters} />

      <UserKeyTrendChart userId={userId} timeRange={filters.timeRange} keyId={filters.keyId} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <UserModelBreakdown
          userId={userId}
          startDate={startDate}
          endDate={endDate}
          keyId={filters.keyId}
          providerId={filters.providerId}
        />
        <UserProviderBreakdown
          userId={userId}
          startDate={startDate}
          endDate={endDate}
          keyId={filters.keyId}
          model={filters.model}
        />
      </div>
    </div>
  );
}
