"use client";

import { AlertTriangle, Clock3, Gauge, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { getProviderTypeConfig, getProviderTypeTranslationKey } from "@/lib/provider-type-utils";
import type { PublicSystemStatusProvider, PublicSystemStatusSnapshot } from "@/lib/system-status";
import { cn } from "@/lib/utils";

const REFRESH_INTERVAL_MS = 30_000;

function formatPercent(locale: string, value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "--";
  }

  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(locale: string, value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) {
    return "--";
  }

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatCurrency(locale: string, currency: string, value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "--";
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatUpdatedAt(locale: string, queriedAt: string) {
  const date = new Date(queriedAt);

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    month: "short",
    day: "numeric",
  }).format(date);
}

function getStatusTone(status: PublicSystemStatusProvider["currentStatus"]) {
  if (status === "green") {
    return {
      dot: "bg-emerald-500",
      badge: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/20",
      bar: "bg-emerald-500",
    };
  }

  if (status === "red") {
    return {
      dot: "bg-rose-500",
      badge: "bg-rose-500/12 text-rose-700 ring-rose-500/20",
      bar: "bg-rose-500",
    };
  }

  return {
    dot: "bg-slate-400",
    badge: "bg-slate-500/12 text-slate-600 ring-slate-500/20",
    bar: "bg-slate-300",
  };
}

function getBucketClass(score: number, totalRequests: number) {
  if (totalRequests <= 0) {
    return "bg-slate-200";
  }

  if (score >= 0.95) {
    return "bg-emerald-500";
  }

  if (score >= 0.5) {
    return "bg-amber-400";
  }

  return "bg-rose-500";
}

function SummaryCard({
  title,
  value,
  meta,
  icon: Icon,
}: {
  title: string;
  value: string;
  meta: string;
  icon: typeof ShieldCheck;
}) {
  return (
    <div className="rounded-[28px] border border-white/80 bg-white/85 p-5 shadow-[0_20px_70px_-45px_rgba(15,23,42,0.35)] backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-500">{title}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
        </div>
        <div className="rounded-2xl bg-slate-950 p-3 text-white">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-4 text-sm text-slate-500">{meta}</p>
    </div>
  );
}

function ProviderCard({
  locale,
  currencyDisplay,
  provider,
}: {
  locale: string;
  currencyDisplay: string;
  provider: PublicSystemStatusProvider;
}) {
  const t = useTranslations("systemStatus");
  const tTypes = useTranslations("settings.providers.types");
  const typeKey = getProviderTypeTranslationKey(provider.providerType);
  const providerTypeLabel = tTypes(`${typeKey}.label`);
  const statusTone = getStatusTone(provider.currentStatus);
  const typeConfig = getProviderTypeConfig(provider.providerType);
  const ProviderIcon = typeConfig.icon;

  return (
    <article className="rounded-[32px] border border-white/80 bg-white/88 p-6 shadow-[0_25px_80px_-45px_rgba(15,23,42,0.38)] backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className={cn("rounded-[22px] p-3", typeConfig.bgColor)}>
            <ProviderIcon className={cn("h-7 w-7", typeConfig.iconColor)} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                {provider.providerName}
              </h2>
              <span className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                {providerTypeLabel}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500">{t("provider.meta.windowHint")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-slate-50 px-3 py-2 ring-1 ring-slate-200/80">
          <span className={cn("h-2.5 w-2.5 rounded-full", statusTone.dot)} />
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
              statusTone.badge
            )}
          >
            {t(`status.${provider.currentStatus}`)}
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[24px] bg-slate-50/90 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
            {t("metrics.availability")}
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">
            {formatPercent(locale, provider.availability)}
          </p>
        </div>
        <div className="rounded-[24px] bg-slate-50/90 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
            {t("metrics.cacheHitRate")}
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">
            {formatPercent(locale, provider.cacheHitRate)}
          </p>
        </div>
        <div className="rounded-[24px] bg-slate-50/90 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
            {t("metrics.outputRate")}
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">
            {provider.avgTokensPerSecond == null
              ? "--"
              : t("metrics.outputRateValue", {
                  value: formatNumber(locale, provider.avgTokensPerSecond),
                })}
          </p>
        </div>
        <div className="rounded-[24px] bg-slate-50/90 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
            {t("metrics.costPerMillionTokens")}
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">
            {formatCurrency(locale, currencyDisplay, provider.avgCostPerMillionTokens)}
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-[24px] border border-slate-200/80 bg-white/90 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              {t("metrics.costPerHundredMillionTokens")}
            </p>
            <p className="mt-2 text-xl font-semibold text-slate-950">
              {formatCurrency(locale, currencyDisplay, provider.avgCostPerHundredMillionTokens)}
            </p>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-slate-500">
            <span>
              {t("provider.meta.requests")} {formatNumber(locale, provider.totalRequests, 0)}
            </span>
            <span>
              {t("provider.meta.successRate")} {formatPercent(locale, provider.successRate)}
            </span>
            <span>
              {t("provider.meta.latency")} {formatNumber(locale, provider.avgLatencyMs, 0)} ms
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-500">
          <span>{t("provider.history")}</span>
          <span>
            {provider.lastRequestAt
              ? t("provider.meta.lastRequestValue", {
                  value: formatUpdatedAt(locale, provider.lastRequestAt),
                })
              : t("provider.meta.noRecentTraffic")}
          </span>
        </div>
        <div
          className="grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${Math.max(provider.history.length, 1)}, minmax(0, 1fr))`,
          }}
        >
          {provider.history.map((bucket) => (
            <div
              key={`${provider.providerId}-${bucket.bucketStart}`}
              className={cn(
                "h-7 rounded-[6px]",
                getBucketClass(bucket.availabilityScore, bucket.totalRequests)
              )}
              title={`${formatUpdatedAt(locale, bucket.bucketStart)} · ${formatPercent(
                locale,
                bucket.totalRequests > 0 ? bucket.availabilityScore : null
              )}`}
            />
          ))}
        </div>
      </div>
    </article>
  );
}

export function SystemStatusView({
  locale,
  initialData,
}: {
  locale: string;
  initialData: PublicSystemStatusSnapshot | null;
}) {
  const t = useTranslations("systemStatus");
  const [data, setData] = useState(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchSnapshot = async (showRefreshing: boolean) => {
      if (showRefreshing) {
        setRefreshing(true);
      }

      try {
        const response = await fetch("/api/system-status", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(t("states.fetchFailed"));
        }

        const snapshot = (await response.json()) as PublicSystemStatusSnapshot;
        if (!mounted) {
          return;
        }

        setData(snapshot);
        setError(null);
      } catch (fetchError) {
        if (!mounted) {
          return;
        }
        setError(fetchError instanceof Error ? fetchError.message : t("states.fetchFailed"));
      } finally {
        if (mounted && showRefreshing) {
          setRefreshing(false);
        }
      }
    };

    if (!initialData) {
      void fetchSnapshot(true);
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchSnapshot(true);
      }
    }, REFRESH_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void fetchSnapshot(true);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      mounted = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [initialData, t]);

  const summary = data?.summary;

  return (
    <main className="min-h-[var(--cch-viewport-height,100vh)] overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.08),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.14),_transparent_30%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)]">
      <div className="mx-auto max-w-7xl px-6 py-10 sm:px-8 lg:px-10">
        <section className="relative overflow-hidden rounded-[40px] border border-white/80 bg-white/78 p-8 shadow-[0_30px_120px_-55px_rgba(15,23,42,0.4)] backdrop-blur-xl">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-500">
                Claude Code Hub
              </p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                {t("hero.title")}
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
                {t("hero.description")}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="rounded-full border border-slate-200 bg-white/85 px-4 py-2 text-sm text-slate-600">
                {t("hero.window", { days: data?.windowDays ?? 7 })}
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/85 px-4 py-2 text-sm text-slate-600">
                <Clock3 className="h-4 w-4" />
                <span>
                  {data?.queriedAt
                    ? t("hero.updatedAt", { value: formatUpdatedAt(locale, data.queriedAt) })
                    : t("hero.awaitingData")}
                </span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/85 px-4 py-2 text-sm text-slate-600">
                <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                <span>{refreshing ? t("hero.refreshing") : t("hero.autoRefresh")}</span>
              </div>
            </div>
          </div>

          {error ? (
            <div className="mt-6 flex items-center gap-3 rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          ) : null}
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-4">
          <SummaryCard
            title={t("summary.systemAvailability")}
            value={formatPercent(locale, summary?.systemAvailability)}
            meta={t("summary.providerCoverage", {
              providers: formatNumber(locale, summary?.providerCount, 0),
            })}
            icon={ShieldCheck}
          />
          <SummaryCard
            title={t("summary.healthyProviders")}
            value={formatNumber(locale, summary?.healthyCount, 0)}
            meta={t("summary.degradedBreakdown", {
              degraded: formatNumber(locale, summary?.degradedCount, 0),
              unknown: formatNumber(locale, summary?.unknownCount, 0),
            })}
            icon={Gauge}
          />
          <SummaryCard
            title={t("summary.weightedCacheHitRate")}
            value={formatPercent(locale, summary?.weightedCacheHitRate)}
            meta={t("summary.cacheHint")}
            icon={Zap}
          />
          <SummaryCard
            title={t("summary.weightedCostPerMillionTokens")}
            value={
              data
                ? formatCurrency(
                    locale,
                    data.currencyDisplay,
                    summary?.weightedCostPerMillionTokens
                  )
                : "--"
            }
            meta={t("summary.weightedOutputRate", {
              value:
                summary?.weightedTokensPerSecond == null
                  ? "--"
                  : t("metrics.outputRateValue", {
                      value: formatNumber(locale, summary.weightedTokensPerSecond),
                    }),
            })}
            icon={Clock3}
          />
        </section>

        <section className="mt-8">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                {t("provider.sectionEyebrow")}
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                {t("provider.sectionTitle")}
              </h2>
            </div>
          </div>

          {data && data.providers.length > 0 ? (
            <div className="grid gap-5">
              {data.providers.map((provider) => (
                <ProviderCard
                  key={provider.providerId}
                  locale={locale}
                  currencyDisplay={data.currencyDisplay}
                  provider={provider}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-[32px] border border-dashed border-slate-300 bg-white/70 px-6 py-12 text-center text-slate-500">
              {t("states.empty")}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
