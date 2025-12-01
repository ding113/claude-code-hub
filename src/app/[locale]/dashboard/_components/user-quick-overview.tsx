"use client";

import { ArrowRight, Clock, Key, TrendingUp, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/routing";
import { formatRelativeTime } from "@/lib/utils/date";
import type { UserDisplay } from "@/types/user";

interface UserQuickOverviewProps {
  users: UserDisplay[];
  isAdmin: boolean;
}

export function UserQuickOverview({ users, isAdmin }: UserQuickOverviewProps) {
  const t = useTranslations("dashboard");

  // Calculate aggregated statistics
  const totalUsers = users.length;
  const totalKeys = users.reduce((sum, user) => sum + user.keys.length, 0);
  const activeKeys = users.reduce(
    (sum, user) => sum + user.keys.filter((k) => k.status === "enabled").length,
    0
  );

  // Get recent activity from all users' keys
  const allKeys = users.flatMap((user) =>
    user.keys.map((key) => ({
      ...key,
      userName: user.name,
    }))
  );

  // Sort by last used time and get most recent
  const recentlyUsedKeys = allKeys
    .filter((k) => k.lastUsedAt)
    .sort((a, b) => {
      if (!a.lastUsedAt || !b.lastUsedAt) return 0;
      return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
    })
    .slice(0, 3);

  // Get top models and providers from model stats
  const modelCounts = new Map<string, number>();
  const providerCounts = new Map<string, number>();

  allKeys.forEach((key) => {
    key.modelStats?.forEach((stat) => {
      modelCounts.set(stat.model, (modelCounts.get(stat.model) || 0) + stat.callCount);
    });
    if (key.lastProviderName) {
      providerCounts.set(key.lastProviderName, (providerCounts.get(key.lastProviderName) || 0) + 1);
    }
  });

  const topModels = Array.from(modelCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const topProviders = Array.from(providerCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // Calculate total usage today
  const totalUsageToday = allKeys.reduce((sum, key) => sum + (key.todayUsage || 0), 0);
  const totalCallsToday = allKeys.reduce((sum, key) => sum + (key.todayCallCount || 0), 0);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {/* User Summary Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            {isAdmin ? t("userList.totalKeys") : t("keyList.columns.key")}
          </CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {isAdmin ? `${totalUsers} ${t("users.title")}` : `${totalKeys} Keys`}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {activeKeys} {t("userList.activeKeys").toLowerCase()}
            {!isAdmin && totalKeys > 0 && ` / ${totalKeys}`}
          </p>
          <Link href="/dashboard/users">
            <Button variant="link" size="sm" className="mt-2 p-0 h-auto">
              {t("nav.userManagement")}
              <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* Today's Usage Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{t("keyListHeader.todayUsage")}</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${totalUsageToday.toFixed(4)}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {totalCallsToday} {t("keyList.timesUnit")}
          </p>
          <Link href="/dashboard/logs">
            <Button variant="link" size="sm" className="mt-2 p-0 h-auto">
              {t("nav.usageLogs")}
              <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* Recent Activity Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            {t("leaderboard.columns.lastActive")}
          </CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {recentlyUsedKeys.length > 0 ? (
            <div className="space-y-2">
              {recentlyUsedKeys.slice(0, 2).map((key) => (
                <div key={key.id} className="text-sm">
                  <div className="font-medium truncate">{key.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {key.lastUsedAt ? formatRelativeTime(new Date(key.lastUsedAt)) : "-"}
                    {key.lastProviderName && ` · ${key.lastProviderName}`}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">{t("keyList.neverUsed")}</div>
          )}
          <Link href="/dashboard/sessions">
            <Button variant="link" size="sm" className="mt-2 p-0 h-auto">
              {t("title.activeSessions")}
              <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* Top Models Card */}
      {topModels.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("keyList.modelStatsColumns.model")}
            </CardTitle>
            <Key className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topModels.map(([model, calls]) => (
                <div key={model} className="flex items-center justify-between text-sm">
                  <span className="truncate flex-1">{model}</span>
                  <span className="text-muted-foreground ml-2">
                    {calls} {t("keyList.timesUnit")}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top Providers Card */}
      {topProviders.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("logs.columns.provider")}</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topProviders.map(([provider, count]) => (
                <div key={provider} className="flex items-center justify-between text-sm">
                  <span className="truncate flex-1">{provider}</span>
                  <span className="text-muted-foreground ml-2">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
