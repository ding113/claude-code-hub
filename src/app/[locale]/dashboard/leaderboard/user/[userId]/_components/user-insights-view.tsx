"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/routing";
import { UserKeyTrendChart } from "./user-key-trend-chart";
import { UserModelBreakdown } from "./user-model-breakdown";
import { UserOverviewCards } from "./user-overview-cards";

interface UserInsightsViewProps {
  userId: number;
  userName: string;
}

export function UserInsightsView({ userId, userName }: UserInsightsViewProps) {
  const t = useTranslations("dashboard.leaderboard.userInsights");
  const router = useRouter();

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
      <UserKeyTrendChart userId={userId} />
      <UserModelBreakdown userId={userId} />
    </div>
  );
}
