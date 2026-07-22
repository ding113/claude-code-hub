"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getProviderCacheEffectivenessWindows,
  type ProviderCacheEffectivenessWindowDto,
} from "@/lib/api-client/v1/actions/provider-cache-effectiveness";

const CACHE_EFFECTIVENESS_QUERY_KEY = ["provider-cache-effectiveness"] as const;
const CACHE_EFFECTIVENESS_FETCH_LIMIT = 200;

function formatBpPercent(bp: number): string {
  return `${(bp / 100).toFixed(1)}%`;
}

function formatHitRate(window: ProviderCacheEffectivenessWindowDto): string {
  if (window.theoreticalCacheTokens <= 0) return "-";
  const ratio = (window.observedCacheReadTokens / window.theoreticalCacheTokens) * 100;
  return `${ratio.toFixed(1)}%`;
}

interface ProviderCacheEffectivenessCardProps {
  providerId: number;
}

export function ProviderCacheEffectivenessCard({
  providerId,
}: ProviderCacheEffectivenessCardProps) {
  const t = useTranslations("settings.providers.list.cacheEffectiveness");

  // 单次全量拉取 + 同 queryKey 跨行去重,避免每个 provider 行各发一次请求
  const { data, isLoading } = useQuery({
    queryKey: CACHE_EFFECTIVENESS_QUERY_KEY,
    queryFn: async () => {
      const result = await getProviderCacheEffectivenessWindows({
        limit: CACHE_EFFECTIVENESS_FETCH_LIMIT,
      });
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // 列表按 windowEnd 倒序,首个匹配行即该 provider 最近窗口
  const latest = data?.find((window) => window.providerId === providerId);

  return (
    <Card className="hidden xl:flex flex-shrink-0 min-w-[160px] gap-0 rounded-md border-0 bg-muted/30 px-2.5 py-1.5 shadow-none">
      <div className="text-center text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {t("label")}
      </div>
      {isLoading ? (
        <div className="mt-1 space-y-1">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-full" />
        </div>
      ) : latest ? (
        <div className="mt-0.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
          <Metric label={t("hitRate")} value={formatHitRate(latest)} />
          <Metric label={t("confidence")} value={formatBpPercent(latest.confidenceBp)} />
          <Metric label={t("samples")} value={`${latest.sampleCount}/${latest.eligibleCount}`} />
          <Metric label={t("score")} value={formatBpPercent(latest.effectivenessBp)} />
        </div>
      ) : (
        <div className="mt-1 text-center text-[11px] text-muted-foreground">{t("empty")}</div>
      )}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-[9px] leading-tight text-muted-foreground/70">{label}</div>
      <div className="text-xs font-semibold leading-tight tabular-nums">{value}</div>
    </div>
  );
}
