"use client";

import { useQuery } from "@tanstack/react-query";
import { Award, Medal, Trophy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { CurrencyCode } from "@/lib/utils";
import { formatCurrency, formatTokenAmount } from "@/lib/utils";
import type {
  LeaderboardEntry,
  ModelLeaderboardEntry,
  ProviderLeaderboardEntry,
} from "@/repository/leaderboard";

type LeaderboardScope = "user" | "provider" | "model";
const LEADERBOARD_FETCH_FAILED = "leaderboard_fetch_failed";

interface NormalizedEntry {
  id: string;
  name: string;
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
}

interface TodayLeaderboardProps {
  currencyCode: CurrencyCode;
  isAdmin: boolean;
  allowGlobalUsageView: boolean;
}

type TodayLeaderboardQueryResult =
  | {
      canViewGlobal: true;
      userResult: PromiseSettledResult<LeaderboardEntry[]>;
      providerResult: PromiseSettledResult<ProviderLeaderboardEntry[]>;
      modelResult: PromiseSettledResult<ModelLeaderboardEntry[]>;
    }
  | {
      canViewGlobal: false;
      userData: LeaderboardEntry[];
    };

async function fetchLeaderboardScope<T>(scope: LeaderboardScope): Promise<T[]> {
  const res = await fetch(`/api/leaderboard?period=daily&scope=${scope}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(LEADERBOARD_FETCH_FAILED);
  }
  return res.json();
}

async function fetchTodayLeaderboardData(
  canViewGlobal: boolean
): Promise<TodayLeaderboardQueryResult> {
  if (canViewGlobal) {
    const [userResult, providerResult, modelResult] = await Promise.allSettled([
      fetchLeaderboardScope<LeaderboardEntry>("user"),
      fetchLeaderboardScope<ProviderLeaderboardEntry>("provider"),
      fetchLeaderboardScope<ModelLeaderboardEntry>("model"),
    ]);

    return {
      canViewGlobal: true,
      userResult,
      providerResult,
      modelResult,
    };
  }

  return {
    canViewGlobal: false,
    userData: await fetchLeaderboardScope<LeaderboardEntry>("user"),
  };
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="flex items-center gap-1.5">
        <Trophy className="h-4 w-4 text-yellow-500" />
        <Badge
          variant="default"
          className="bg-yellow-500 hover:bg-yellow-600 min-w-[32px] justify-center"
        >
          #{rank}
        </Badge>
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="flex items-center gap-1.5">
        <Medal className="h-4 w-4 text-gray-400" />
        <Badge
          variant="secondary"
          className="bg-gray-400 hover:bg-gray-500 text-white min-w-[32px] justify-center"
        >
          #{rank}
        </Badge>
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="flex items-center gap-1.5">
        <Award className="h-4 w-4 text-orange-600" />
        <Badge
          variant="secondary"
          className="bg-orange-600 hover:bg-orange-700 text-white min-w-[32px] justify-center"
        >
          #{rank}
        </Badge>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="h-4 w-4" />
      <Badge variant="outline" className="min-w-[32px] justify-center">
        #{rank}
      </Badge>
    </div>
  );
}

interface LeaderboardCardProps {
  title: string;
  entries: NormalizedEntry[];
  currencyCode: CurrencyCode;
  loading: boolean;
  emptyText: string;
  requestsLabel: string;
  tokensLabel: string;
  errorText?: string | null;
}

function LeaderboardCard({
  title,
  entries,
  currencyCode,
  loading,
  emptyText,
  requestsLabel,
  tokensLabel,
  errorText,
}: LeaderboardCardProps) {
  if (loading) {
    return (
      <Card role="region" aria-label={title} aria-busy="true">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[...Array(3)].map((_, idx) => (
            <div key={idx} className="flex items-center justify-between gap-3">
              <Skeleton className="h-10 w-full" aria-hidden="true" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (errorText) {
    return (
      <Card role="region" aria-label={title}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-destructive" role="alert">
            {errorText}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      <Card role="region" aria-label={title}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">{emptyText}</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card role="region" aria-label={title}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3" aria-label={title}>
          {entries.slice(0, 5).map((entry, index) => (
            <li key={entry.id} className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <RankBadge rank={index + 1} />
                <div className="min-w-0">
                  <div className="font-medium truncate">{entry.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {entry.totalRequests.toLocaleString()} {requestsLabel}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono font-semibold">
                  {formatCurrency(entry.totalCost, currencyCode)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatTokenAmount(entry.totalTokens)} {tokensLabel}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function TodayLeaderboard({
  currencyCode,
  isAdmin,
  allowGlobalUsageView,
}: TodayLeaderboardProps) {
  const t = useTranslations("dashboard.leaderboard");
  const [userEntries, setUserEntries] = useState<NormalizedEntry[]>([]);
  const [providerEntries, setProviderEntries] = useState<NormalizedEntry[]>([]);
  const [modelEntries, setModelEntries] = useState<NormalizedEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const canViewGlobal = isAdmin || allowGlobalUsageView;
  const {
    data: leaderboardData,
    error: leaderboardError,
    isLoading: loading,
  } = useQuery({
    queryKey: ["today-leaderboard", canViewGlobal],
    queryFn: () => fetchTodayLeaderboardData(canViewGlobal),
  });

  useLayoutEffect(() => {
    const normalize = {
      user: (data: LeaderboardEntry[] | null | undefined): NormalizedEntry[] =>
        (data ?? []).map((item) => ({
          id: `user-${item.userId}`,
          name: item.userName ?? "",
          totalRequests: item.totalRequests ?? 0,
          totalTokens: item.totalTokens ?? 0,
          totalCost: item.totalCost ?? 0,
        })),
      provider: (data: ProviderLeaderboardEntry[] | null | undefined): NormalizedEntry[] =>
        (data ?? []).map((item) => ({
          id: `provider-${item.providerId}`,
          name: item.providerName ?? "",
          totalRequests: item.totalRequests ?? 0,
          totalTokens: item.totalTokens ?? 0,
          totalCost: item.totalCost ?? 0,
        })),
      model: (data: ModelLeaderboardEntry[] | null | undefined): NormalizedEntry[] =>
        (data ?? []).map((item) => ({
          id: `model-${item.model}`,
          name: item.model ?? "",
          totalRequests: item.totalRequests ?? 0,
          totalTokens: item.totalTokens ?? 0,
          totalCost: item.totalCost ?? 0,
        })),
    };

    const getErrorMessage = (reason: unknown) =>
      reason instanceof Error && reason.message !== LEADERBOARD_FETCH_FAILED
        ? reason.message
        : t("states.fetchFailed");

    if (leaderboardError) {
      setError(getErrorMessage(leaderboardError));
      setUserEntries([]);
      setProviderEntries([]);
      setModelEntries([]);
      return;
    }

    if (!leaderboardData) {
      return;
    }

    setError(null);
    setProviderError(null);
    setModelError(null);

    if (leaderboardData.canViewGlobal) {
      const { userResult, providerResult, modelResult } = leaderboardData;

      if (userResult.status === "fulfilled") {
        setUserEntries(normalize.user(userResult.value));
      } else {
        setError(getErrorMessage(userResult.reason));
        setUserEntries([]);
      }

      if (providerResult.status === "fulfilled") {
        setProviderEntries(normalize.provider(providerResult.value));
      } else {
        setProviderError(getErrorMessage(providerResult.reason));
        setProviderEntries([]);
      }

      if (modelResult.status === "fulfilled") {
        setModelEntries(normalize.model(modelResult.value));
      } else {
        setModelError(getErrorMessage(modelResult.reason));
        setModelEntries([]);
      }
      return;
    }

    setUserEntries(normalize.user(leaderboardData.userData));
    setProviderEntries([]);
    setModelEntries([]);
  }, [leaderboardData, leaderboardError, t]);

  const cards = useMemo(() => {
    const list = [
      {
        key: "user",
        title: t("userRankings"),
        entries: userEntries,
        error: error,
        shouldShow: true,
      },
      {
        key: "provider",
        title: t("providerRankings"),
        entries: providerEntries,
        error: providerError,
        shouldShow: isAdmin || allowGlobalUsageView,
      },
      {
        key: "model",
        title: t("modelRankings"),
        entries: modelEntries,
        error: modelError,
        shouldShow: isAdmin || allowGlobalUsageView,
      },
    ];

    return list.filter((item) => item.shouldShow);
  }, [
    allowGlobalUsageView,
    error,
    isAdmin,
    modelEntries,
    modelError,
    providerEntries,
    providerError,
    t,
    userEntries,
  ]);

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <LeaderboardCard
          key={card.key}
          title={card.title}
          entries={card.entries}
          currencyCode={currencyCode}
          loading={loading}
          emptyText={t("noData")}
          requestsLabel={t("requests")}
          tokensLabel={t("tokens")}
          errorText={card.error}
        />
      ))}
    </div>
  );
}
