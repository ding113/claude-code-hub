"use client";

import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { getProviderTypeConfig, getProviderTypeTranslationKey } from "@/lib/provider-type-utils";
import type { PublicSystemStatusProvider, PublicSystemStatusSnapshot } from "@/lib/system-status";
import { cn } from "@/lib/utils";

const REFRESH_INTERVAL_MS = 30_000;
const DISPLAY_SERIF = "font-['Iowan_Old_Style','Palatino_Linotype','Book_Antiqua',Georgia,serif]";
const DISPLAY_SANS = "font-['Public_Sans','Segoe_UI',sans-serif]";
const DISPLAY_MONO = "font-['IBM_Plex_Mono','SFMono-Regular',monospace]";

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
      badge: "border-emerald-300 bg-emerald-500/10 text-emerald-800",
      text: "text-emerald-700",
      rail: "bg-emerald-500",
      chart: "bg-emerald-500",
    };
  }

  if (status === "red") {
    return {
      dot: "bg-rose-500",
      badge: "border-rose-300 bg-rose-500/10 text-rose-800",
      text: "text-rose-700",
      rail: "bg-rose-500",
      chart: "bg-rose-500",
    };
  }

  return {
    dot: "bg-amber-500",
    badge: "border-amber-300 bg-amber-500/10 text-amber-800",
    text: "text-amber-700",
    rail: "bg-amber-400",
    chart: "bg-stone-300",
  };
}

function getBucketClass(score: number, totalRequests: number) {
  if (totalRequests <= 0) {
    return "bg-stone-200";
  }

  if (score >= 0.95) {
    return "bg-emerald-500";
  }

  if (score >= 0.5) {
    return "bg-amber-400";
  }

  return "bg-rose-500";
}

function getSystemLabel(
  healthyCount: number | undefined,
  degradedCount: number | undefined,
  unknownCount: number | undefined
) {
  if ((degradedCount ?? 0) > 0) {
    return "degraded";
  }

  if ((healthyCount ?? 0) > 0 && (unknownCount ?? 0) === 0) {
    return "normal";
  }

  return "unknown";
}

function StatusPill({
  status,
  label,
}: {
  status: PublicSystemStatusProvider["currentStatus"];
  label: string;
}) {
  const tone = getStatusTone(status);

  return (
    <span
      className={cn(
        DISPLAY_MONO,
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em]",
        tone.badge
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", tone.dot)} />
      {label}
    </span>
  );
}

function MetricStrip({ title, value, meta }: { title: string; value: string; meta: string }) {
  return (
    <div className="border-t border-stone-300 py-4 first:border-t-0 lg:border-t-0 lg:border-l lg:px-5 lg:first:border-l-0">
      <p className={cn(DISPLAY_MONO, "text-[11px] uppercase tracking-[0.28em] text-stone-500")}>
        {title}
      </p>
      <p
        className={cn(
          DISPLAY_SERIF,
          "mt-2 text-3xl leading-none tracking-[-0.04em] text-stone-950"
        )}
      >
        {value}
      </p>
      <p className="mt-2 text-sm leading-6 text-stone-600">{meta}</p>
    </div>
  );
}

function ProviderRow({
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
  const typeConfig = getProviderTypeConfig(provider.providerType);
  const ProviderIcon = typeConfig.icon;
  const tone = getStatusTone(provider.currentStatus);

  return (
    <article className="group relative overflow-hidden border-b border-stone-300/90 py-6 last:border-b-0">
      <div className="absolute left-0 top-6 hidden h-[calc(100%-3rem)] w-1 rounded-full lg:block">
        <div
          className={cn("h-full w-full rounded-full transition-opacity duration-300", tone.rail)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)] lg:gap-8 lg:pl-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <div className={cn("rounded-full border border-stone-300 p-3", typeConfig.bgColor)}>
              <ProviderIcon className={cn("h-5 w-5", typeConfig.iconColor)} />
            </div>
            <StatusPill
              status={provider.currentStatus}
              label={t(`status.${provider.currentStatus}`)}
            />
            <span
              className={cn(
                DISPLAY_MONO,
                "rounded-full border border-stone-300 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-stone-500"
              )}
            >
              {providerTypeLabel}
            </span>
          </div>

          <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h2
                className={cn(
                  DISPLAY_SERIF,
                  "text-3xl leading-none tracking-[-0.045em] text-stone-950 sm:text-4xl"
                )}
              >
                {provider.providerName}
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-stone-600">
                {t("provider.meta.windowHint")}
              </p>
            </div>
            <div className="text-right">
              <p
                className={cn(
                  DISPLAY_MONO,
                  "text-[11px] uppercase tracking-[0.24em] text-stone-500"
                )}
              >
                {t("metrics.availability")}
              </p>
              <p
                className={cn(
                  DISPLAY_SERIF,
                  "mt-2 text-5xl leading-none tracking-[-0.06em] text-stone-950"
                )}
              >
                {formatPercent(locale, provider.availability)}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-2">
          <div>
            <p
              className={cn(DISPLAY_MONO, "text-[11px] uppercase tracking-[0.24em] text-stone-500")}
            >
              {t("metrics.cacheHitRate")}
            </p>
            <p className="mt-2 text-lg font-semibold text-stone-950">
              {formatPercent(locale, provider.cacheHitRate)}
            </p>
          </div>
          <div>
            <p
              className={cn(DISPLAY_MONO, "text-[11px] uppercase tracking-[0.24em] text-stone-500")}
            >
              {t("metrics.outputRate")}
            </p>
            <p className="mt-2 text-lg font-semibold text-stone-950">
              {provider.avgTokensPerSecond == null
                ? "--"
                : t("metrics.outputRateValue", {
                    value: formatNumber(locale, provider.avgTokensPerSecond),
                  })}
            </p>
          </div>
          <div>
            <p
              className={cn(DISPLAY_MONO, "text-[11px] uppercase tracking-[0.24em] text-stone-500")}
            >
              {t("metrics.costPerMillionTokens")}
            </p>
            <p className="mt-2 text-lg font-semibold text-stone-950">
              {formatCurrency(locale, currencyDisplay, provider.avgCostPerMillionTokens)}
            </p>
          </div>
          <div>
            <p
              className={cn(DISPLAY_MONO, "text-[11px] uppercase tracking-[0.24em] text-stone-500")}
            >
              {t("metrics.costPerHundredMillionTokens")}
            </p>
            <p className="mt-2 text-lg font-semibold text-stone-950">
              {formatCurrency(locale, currencyDisplay, provider.avgCostPerHundredMillionTokens)}
            </p>
          </div>
        </div>

        <div className="space-y-4 border-t border-stone-300 pt-4 lg:border-t-0 lg:border-l lg:pl-6 lg:pt-0">
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone-600">
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

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p
                className={cn(
                  DISPLAY_MONO,
                  "text-[11px] uppercase tracking-[0.24em] text-stone-500"
                )}
              >
                {t("provider.history")}
              </p>
              <p
                className={cn(
                  DISPLAY_MONO,
                  "text-[11px] uppercase tracking-[0.2em] text-stone-400"
                )}
              >
                {provider.lastRequestAt
                  ? t("provider.meta.lastRequestValue", {
                      value: formatUpdatedAt(locale, provider.lastRequestAt),
                    })
                  : t("provider.meta.noRecentTraffic")}
              </p>
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
                    "h-9 rounded-sm transition-colors duration-300",
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
  const systemLabel = getSystemLabel(
    summary?.healthyCount,
    summary?.degradedCount,
    summary?.unknownCount
  );

  return (
    <main
      className={cn(
        DISPLAY_SANS,
        "min-h-[var(--cch-viewport-height,100vh)] overflow-hidden bg-[#f5f1e8] text-stone-950"
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(120,113,108,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(120,113,108,0.08)_1px,transparent_1px)] bg-[size:32px_32px] opacity-50" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.16),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(15,23,42,0.12),transparent_35%)]" />

      <div className="relative mx-auto max-w-[1600px] px-5 py-6 sm:px-8 lg:px-10">
        <section className="border border-stone-400/80 bg-[#fbf8f1]/95 shadow-[0_30px_100px_-60px_rgba(28,25,23,0.55)]">
          <div className="border-b border-stone-300 px-5 py-3 sm:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={cn(
                    DISPLAY_MONO,
                    "text-[11px] uppercase tracking-[0.32em] text-stone-500"
                  )}
                >
                  Claude Code Hub
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-stone-400" />
                <span
                  className={cn(
                    DISPLAY_MONO,
                    "text-[11px] uppercase tracking-[0.32em] text-stone-500"
                  )}
                >
                  {t("hero.pathLabel")}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <StatusPill
                  status={
                    systemLabel === "normal"
                      ? "green"
                      : systemLabel === "degraded"
                        ? "red"
                        : "unknown"
                  }
                  label={t(
                    `status.${systemLabel === "normal" ? "green" : systemLabel === "degraded" ? "red" : "unknown"}`
                  )}
                />
                <span
                  className={cn(
                    DISPLAY_MONO,
                    "rounded-full border border-stone-300 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-stone-500"
                  )}
                >
                  {t("hero.window", { days: data?.windowDays ?? 7 })}
                </span>
              </div>
            </div>
          </div>

          <div className="grid gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)] lg:gap-10">
            <div>
              <p
                className={cn(
                  DISPLAY_MONO,
                  "text-[11px] uppercase tracking-[0.28em] text-stone-500"
                )}
              >
                {t("hero.kicker")}
              </p>
              <h1
                className={cn(
                  DISPLAY_SERIF,
                  "mt-5 max-w-5xl text-[clamp(4rem,11vw,10rem)] leading-[0.88] tracking-[-0.07em] text-stone-950"
                )}
              >
                {t("hero.title")}
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-stone-700 sm:text-lg">
                {t("hero.description")}
              </p>
            </div>

            <div className="grid content-start gap-4">
              <div className="border border-stone-300 bg-stone-950 p-5 text-stone-50">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p
                      className={cn(
                        DISPLAY_MONO,
                        "text-[11px] uppercase tracking-[0.24em] text-stone-300"
                      )}
                    >
                      {t("summary.systemAvailability")}
                    </p>
                    <p
                      className={cn(
                        DISPLAY_SERIF,
                        "mt-3 text-5xl leading-none tracking-[-0.06em] text-white"
                      )}
                    >
                      {formatPercent(locale, summary?.systemAvailability)}
                    </p>
                  </div>
                  <ShieldCheck className="h-8 w-8 text-amber-300" />
                </div>
                <p className="mt-4 text-sm leading-6 text-stone-300">
                  {t("summary.providerCoverage", {
                    providers: formatNumber(locale, summary?.providerCount, 0),
                  })}
                </p>
              </div>

              <div className="border border-stone-300 bg-[#f2ece1] p-5">
                <div className="flex items-center justify-between gap-3">
                  <p
                    className={cn(
                      DISPLAY_MONO,
                      "text-[11px] uppercase tracking-[0.24em] text-stone-500"
                    )}
                  >
                    {data?.queriedAt
                      ? t("hero.updatedAt", { value: formatUpdatedAt(locale, data.queriedAt) })
                      : t("hero.awaitingData")}
                  </p>
                  <div className="inline-flex items-center gap-2 text-stone-600">
                    <RefreshCw
                      className={cn(
                        "h-4 w-4 motion-reduce:animate-none",
                        refreshing && "animate-spin"
                      )}
                    />
                    <span className="text-sm">
                      {refreshing ? t("hero.refreshing") : t("hero.autoRefresh")}
                    </span>
                  </div>
                </div>

                {error ? (
                  <div className="mt-4 flex items-start gap-3 border border-amber-300 bg-amber-100 px-4 py-3 text-sm leading-6 text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="border-t border-stone-300 px-5 py-6 sm:px-8">
            <div className="grid gap-1 lg:grid-cols-4">
              <MetricStrip
                title={t("summary.healthyProviders")}
                value={formatNumber(locale, summary?.healthyCount, 0)}
                meta={t("summary.degradedBreakdown", {
                  degraded: formatNumber(locale, summary?.degradedCount, 0),
                  unknown: formatNumber(locale, summary?.unknownCount, 0),
                })}
              />
              <MetricStrip
                title={t("summary.weightedCacheHitRate")}
                value={formatPercent(locale, summary?.weightedCacheHitRate)}
                meta={t("summary.cacheHint")}
              />
              <MetricStrip
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
                meta={
                  data
                    ? formatCurrency(
                        locale,
                        data.currencyDisplay,
                        summary?.weightedCostPerHundredMillionTokens
                      )
                    : "--"
                }
              />
              <MetricStrip
                title={t("metrics.outputRate")}
                value={
                  summary?.weightedTokensPerSecond == null
                    ? "--"
                    : t("metrics.outputRateValue", {
                        value: formatNumber(locale, summary.weightedTokensPerSecond),
                      })
                }
                meta={t("provider.sectionTitle")}
              />
            </div>
          </div>
        </section>

        <section className="mt-8 border border-stone-400/80 bg-[#fbf8f1]/95 px-5 py-6 shadow-[0_30px_100px_-60px_rgba(28,25,23,0.45)] sm:px-8">
          <div className="mb-6 flex flex-col gap-3 border-b border-stone-300 pb-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p
                className={cn(
                  DISPLAY_MONO,
                  "text-[11px] uppercase tracking-[0.28em] text-stone-500"
                )}
              >
                {t("provider.sectionEyebrow")}
              </p>
              <h2 className={cn(DISPLAY_SERIF, "mt-3 text-4xl tracking-[-0.05em] text-stone-950")}>
                {t("provider.sectionTitle")}
              </h2>
            </div>
            <div className="max-w-xl text-sm leading-7 text-stone-600">
              {t("provider.meta.windowHint")}
            </div>
          </div>

          {data && data.providers.length > 0 ? (
            <div>
              {data.providers.map((provider) => (
                <ProviderRow
                  key={provider.providerId}
                  locale={locale}
                  currencyDisplay={data.currencyDisplay}
                  provider={provider}
                />
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-stone-300 bg-[#f3ede1] px-6 py-14 text-center text-stone-600">
              {t("states.empty")}
            </div>
          )}
        </section>

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-stone-300 px-1 pt-4 text-sm text-stone-500">
          <div className="inline-flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            <span>{t("summary.systemAvailability")}</span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-2">
              <Zap className="h-4 w-4" />
              {t("summary.weightedCacheHitRate")}
            </span>
            <span className="inline-flex items-center gap-2">
              <Clock3 className="h-4 w-4" />
              {t("metrics.outputRate")}
            </span>
          </div>
        </footer>
      </div>
    </main>
  );
}
