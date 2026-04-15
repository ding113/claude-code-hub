"use client";

import {
  Activity,
  AlertTriangle,
  Clock3,
  Gauge,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { startTransition, useEffect, useEffectEvent, useMemo, useState } from "react";
import { getProviderTypeConfig, getProviderTypeTranslationKey } from "@/lib/provider-type-utils";
import type { PublicSystemStatusProvider, PublicSystemStatusSnapshot } from "@/lib/system-status";
import { cn } from "@/lib/utils";

const REFRESH_INTERVAL_MS = 30_000;
const DISPLAY_TITLE = "font-['Space_Grotesk','Public_Sans','Segoe_UI',sans-serif]";
const DISPLAY_SANS = "font-['Public_Sans','Segoe_UI',sans-serif]";
const DISPLAY_MONO = "font-['IBM_Plex_Mono','SFMono-Regular',monospace]";

function formatPercent(locale: string, value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) {
    return "--";
  }

  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
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

function formatCompactNumber(locale: string, value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "--";
  }

  return new Intl.NumberFormat(locale, {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
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

function formatTimestamp(locale: string, value: string | null | undefined) {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatMarkerDate(locale: string, value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
  }).format(date);
}

function getStatusTone(status: PublicSystemStatusProvider["currentStatus"]) {
  if (status === "green") {
    return {
      badge: "border-emerald-200 bg-emerald-500/10 text-emerald-700",
      dot: "bg-emerald-500 shadow-[0_0_0_6px_rgba(16,185,129,0.14)]",
      card: "border-emerald-200/80 bg-white",
      accent: "from-emerald-500/18 via-emerald-500/6 to-transparent",
      meter: "bg-emerald-500",
      history: "bg-emerald-500/90",
      historyIdle: "bg-emerald-100",
      value: "text-emerald-700",
      icon: ShieldCheck,
    };
  }

  if (status === "red") {
    return {
      badge: "border-rose-200 bg-rose-500/10 text-rose-700",
      dot: "bg-rose-500 shadow-[0_0_0_6px_rgba(244,63,94,0.12)]",
      card: "border-rose-200/80 bg-white",
      accent: "from-rose-500/18 via-rose-500/7 to-transparent",
      meter: "bg-rose-500",
      history: "bg-rose-500/90",
      historyIdle: "bg-rose-100",
      value: "text-rose-700",
      icon: ShieldAlert,
    };
  }

  return {
    badge: "border-amber-200 bg-amber-500/10 text-amber-700",
    dot: "bg-amber-400 shadow-[0_0_0_6px_rgba(251,191,36,0.16)]",
    card: "border-amber-200/80 bg-white",
    accent: "from-amber-400/18 via-amber-400/8 to-transparent",
    meter: "bg-amber-400",
    history: "bg-slate-400",
    historyIdle: "bg-slate-200",
    value: "text-amber-700",
    icon: AlertTriangle,
  };
}

function getSystemLabel(
  healthyCount: number | undefined,
  degradedCount: number | undefined,
  unknownCount: number | undefined
) {
  if ((degradedCount ?? 0) > 0) {
    return "red";
  }

  if ((healthyCount ?? 0) > 0 && (unknownCount ?? 0) === 0) {
    return "green";
  }

  return "unknown";
}

function getHistoryBarClass(score: number, totalRequests: number) {
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

function getHistoryBarHeight(score: number, totalRequests: number) {
  if (totalRequests <= 0) {
    return 16;
  }

  return Math.max(18, Math.round(score * 100));
}

function StatusBadge({
  label,
  status,
  animated,
}: {
  label: string;
  status: PublicSystemStatusProvider["currentStatus"];
  animated?: boolean;
}) {
  const tone = getStatusTone(status);
  const reduceMotion = useReducedMotion();

  return (
    <span
      className={cn(
        DISPLAY_MONO,
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.22em]",
        tone.badge
      )}
    >
      <motion.span
        className={cn("h-2.5 w-2.5 rounded-full", tone.dot)}
        animate={
          animated && !reduceMotion
            ? {
                scale: [1, 1.18, 1],
                opacity: [0.78, 1, 0.78],
              }
            : undefined
        }
        transition={{
          duration: 1.8,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      {label}
    </span>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  note,
  emphasis,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  note?: string;
  emphasis?: "default" | "primary";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-4",
        emphasis === "primary"
          ? "border-slate-900 bg-slate-950 text-white"
          : "border-slate-200 bg-white/85 text-slate-950"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p
          className={cn(
            DISPLAY_MONO,
            "text-[11px] uppercase tracking-[0.22em]",
            emphasis === "primary" ? "text-slate-300" : "text-slate-500"
          )}
        >
          {label}
        </p>
        <Icon className={cn("h-4 w-4", emphasis === "primary" ? "text-sky-300" : "text-slate-400")} />
      </div>
      <p
        className={cn(
          DISPLAY_TITLE,
          "mt-3 text-3xl font-semibold leading-none tracking-[-0.05em]",
          emphasis === "primary" ? "text-white" : "text-slate-950"
        )}
      >
        {value}
      </p>
      {note ? (
        <p className={cn("mt-2 text-sm", emphasis === "primary" ? "text-slate-300" : "text-slate-500")}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

function MetricTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-4">
      <p className={cn(DISPLAY_MONO, "text-[11px] uppercase tracking-[0.2em] text-slate-500")}>
        {label}
      </p>
      <p className={cn(DISPLAY_TITLE, "mt-3 text-2xl font-semibold tracking-[-0.05em] text-slate-950")}>
        {value}
      </p>
      {accent ? <p className="mt-1.5 text-xs text-slate-500">{accent}</p> : null}
    </div>
  );
}

function ProviderCard({
  currencyDisplay,
  index,
  locale,
  provider,
}: {
  currencyDisplay: string;
  index: number;
  locale: string;
  provider: PublicSystemStatusProvider;
}) {
  const t = useTranslations("systemStatus");
  const tTypes = useTranslations("settings.providers.types");
  const reduceMotion = useReducedMotion();
  const tone = getStatusTone(provider.currentStatus);
  const StatusIcon = tone.icon;
  const typeConfig = getProviderTypeConfig(provider.providerType);
  const ProviderIcon = typeConfig.icon;
  const typeKey = getProviderTypeTranslationKey(provider.providerType);
  const typeLabel = tTypes(`${typeKey}.label`);
  const availabilityWidth = provider.availability * 100;
  const historyMarkers = useMemo(() => {
    if (provider.history.length === 0) {
      return [] as string[];
    }

    const lastIndex = provider.history.length - 1;
    const middleIndex = Math.floor(lastIndex / 2);
    return [0, middleIndex, lastIndex].map((position) =>
      formatMarkerDate(locale, provider.history[position].bucketStart)
    );
  }, [locale, provider.history]);

  return (
    <motion.article
      initial={reduceMotion ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: "easeOut", delay: reduceMotion ? 0 : index * 0.06 }}
      className={cn(
        "relative overflow-hidden rounded-[30px] border p-5 shadow-[0_20px_60px_-38px_rgba(15,23,42,0.35)] sm:p-6",
        tone.card
      )}
    >
      <div className={cn("pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-r", tone.accent)} />

      <div className="relative">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <StatusBadge
                animated
                label={t(`status.${provider.currentStatus}`)}
                status={provider.currentStatus}
              />
              <span
                className={cn(
                  DISPLAY_MONO,
                  "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-slate-500"
                )}
              >
                <ProviderIcon className={cn("h-3.5 w-3.5", typeConfig.iconColor)} />
                {typeLabel}
              </span>
            </div>

            <div className="mt-4 flex flex-wrap items-start gap-4">
              <div className={cn("rounded-2xl border border-slate-200 p-3", typeConfig.bgColor)}>
                <ProviderIcon className={cn("h-6 w-6", typeConfig.iconColor)} />
              </div>
              <div className="min-w-0">
                <h2
                  className={cn(
                    DISPLAY_TITLE,
                    "truncate text-[clamp(2rem,4vw,3rem)] font-semibold leading-none tracking-[-0.06em] text-slate-950"
                  )}
                >
                  {provider.providerName}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <StatusIcon className={cn("h-4 w-4", tone.value)} />
                    {formatCompactNumber(locale, provider.totalRequests)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock3 className="h-4 w-4 text-slate-400" />
                    {provider.lastRequestAt
                      ? formatTimestamp(locale, provider.lastRequestAt)
                      : t("provider.meta.noRecentTraffic")}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="min-w-[180px] rounded-[24px] border border-slate-200 bg-slate-950 px-4 py-4 text-white">
            <p className={cn(DISPLAY_MONO, "text-[11px] uppercase tracking-[0.22em] text-slate-300")}>
              {t("metrics.availability")}
            </p>
            <p className={cn(DISPLAY_TITLE, "mt-3 text-5xl font-semibold leading-none tracking-[-0.08em]")}>
              {formatPercent(locale, provider.availability)}
            </p>
            <p className="mt-3 text-sm text-slate-300">
              {formatPercent(locale, provider.successRate)} success
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(240px,0.62fr)_minmax(0,1.38fr)]">
          <div className="rounded-[24px] border border-slate-200 bg-slate-50/85 p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className={cn(DISPLAY_MONO, "text-[11px] uppercase tracking-[0.2em] text-slate-500")}>
                  {t("metrics.availability")}
                </p>
                <p className={cn(DISPLAY_TITLE, "mt-3 text-4xl font-semibold tracking-[-0.06em] text-slate-950")}>
                  {formatPercent(locale, provider.availability)}
                </p>
              </div>
              <p className="text-sm text-slate-500">{formatNumber(locale, provider.avgLatencyMs, 0)} ms</p>
            </div>

            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-200">
              <motion.div
                className={cn("h-full rounded-full", tone.meter)}
                initial={reduceMotion ? false : { width: 0 }}
                animate={{ width: `${Math.max(0, Math.min(availabilityWidth, 100))}%` }}
                transition={{ duration: 0.7, ease: "easeOut", delay: reduceMotion ? 0 : 0.08 }}
              />
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-white px-3 py-3">
                <p className={cn(DISPLAY_MONO, "text-[10px] uppercase tracking-[0.18em] text-slate-400")}>
                  {t("provider.meta.requests")}
                </p>
                <p className="mt-2 text-sm font-semibold text-slate-900">
                  {formatCompactNumber(locale, provider.totalRequests)}
                </p>
              </div>
              <div className="rounded-2xl bg-white px-3 py-3">
                <p className={cn(DISPLAY_MONO, "text-[10px] uppercase tracking-[0.18em] text-slate-400")}>
                  {t("provider.meta.successRate")}
                </p>
                <p className="mt-2 text-sm font-semibold text-slate-900">
                  {formatPercent(locale, provider.successRate)}
                </p>
              </div>
              <div className="rounded-2xl bg-white px-3 py-3">
                <p className={cn(DISPLAY_MONO, "text-[10px] uppercase tracking-[0.18em] text-slate-400")}>
                  {t("provider.meta.latency")}
                </p>
                <p className="mt-2 text-sm font-semibold text-slate-900">
                  {formatNumber(locale, provider.avgLatencyMs, 0)} ms
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile
              label={t("metrics.cacheHitRate")}
              value={formatPercent(locale, provider.cacheHitRate)}
            />
            <MetricTile
              label={t("metrics.outputRate")}
              value={
                provider.avgTokensPerSecond == null
                  ? "--"
                  : t("metrics.outputRateValue", {
                      value: formatNumber(locale, provider.avgTokensPerSecond),
                    })
              }
            />
            <MetricTile
              label={t("metrics.costPerMillionTokens")}
              value={formatCurrency(locale, currencyDisplay, provider.avgCostPerMillionTokens)}
            />
            <MetricTile
              label={t("metrics.costPerHundredMillionTokens")}
              value={formatCurrency(locale, currencyDisplay, provider.avgCostPerHundredMillionTokens)}
            />
          </div>
        </div>

        <div className="mt-5 rounded-[24px] border border-slate-200 bg-white/70 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className={cn(DISPLAY_MONO, "text-[11px] uppercase tracking-[0.2em] text-slate-500")}>
                {t("provider.history")}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {provider.lastRequestAt
                  ? t("provider.meta.lastRequestValue", {
                      value: formatTimestamp(locale, provider.lastRequestAt),
                    })
                  : t("provider.meta.noRecentTraffic")}
              </p>
            </div>
            <div className="text-right">
              <p className={cn(DISPLAY_MONO, "text-[11px] uppercase tracking-[0.2em] text-slate-400")}>
                Live
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {formatPercent(
                  locale,
                  provider.history.at(-1)?.totalRequests ? provider.history.at(-1)?.availabilityScore : provider.availability
                )}
              </p>
            </div>
          </div>

          <div className="relative mt-4">
            <div className="pointer-events-none absolute inset-0 grid grid-rows-4">
              <div className="border-t border-dashed border-slate-200/90" />
              <div className="border-t border-dashed border-slate-200/70" />
              <div className="border-t border-dashed border-slate-200/70" />
              <div className="border-t border-dashed border-slate-200/90" />
            </div>

            <div className="relative flex h-28 items-end gap-1">
              {provider.history.map((bucket, bucketIndex) => (
                <motion.div
                  key={`${provider.providerId}-${bucket.bucketStart}`}
                  title={`${formatTimestamp(locale, bucket.bucketStart)} · ${formatPercent(
                    locale,
                    bucket.totalRequests > 0 ? bucket.availabilityScore : null
                  )}`}
                  className={cn(
                    "min-w-0 flex-1 rounded-t-[10px] transition-colors duration-200",
                    getHistoryBarClass(bucket.availabilityScore, bucket.totalRequests)
                  )}
                  style={{
                    height: `${getHistoryBarHeight(bucket.availabilityScore, bucket.totalRequests)}%`,
                  }}
                  initial={reduceMotion ? false : { opacity: 0.35, scaleY: 0.2 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  transition={{
                    duration: 0.35,
                    ease: "easeOut",
                    delay: reduceMotion ? 0 : index * 0.05 + bucketIndex * 0.006,
                  }}
                />
              ))}
            </div>
          </div>

          {historyMarkers.length === 3 ? (
            <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
              <span>{historyMarkers[0]}</span>
              <span>{historyMarkers[1]}</span>
              <span>{historyMarkers[2]}</span>
            </div>
          ) : null}
        </div>
      </div>
    </motion.article>
  );
}

export function SystemStatusView({
  initialData,
  locale,
}: {
  initialData: PublicSystemStatusSnapshot | null;
  locale: string;
}) {
  const t = useTranslations("systemStatus");
  const reduceMotion = useReducedMotion();
  const [data, setData] = useState(initialData);
  const [refreshing, setRefreshing] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  const refreshSnapshot = useEffectEvent(async (showRefreshing: boolean) => {
    if (showRefreshing) {
      setRefreshing(true);
    }

    try {
      const response = await fetch("/api/system-status", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(t("states.fetchFailed"));
      }

      const snapshot = (await response.json()) as PublicSystemStatusSnapshot;
      startTransition(() => {
        setData(snapshot);
        setError(null);
      });
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : t("states.fetchFailed"));
    } finally {
      if (showRefreshing) {
        setRefreshing(false);
      }
    }
  });

  useEffect(() => {
    if (!initialData) {
      void refreshSnapshot(true);
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshSnapshot(true);
      }
    }, REFRESH_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshSnapshot(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [initialData, refreshSnapshot]);

  const summary = data?.summary;
  const systemStatus = getSystemLabel(
    summary?.healthyCount,
    summary?.degradedCount,
    summary?.unknownCount
  );
  const orderedProviders = data?.providers ?? [];

  return (
    <main
      className={cn(
        DISPLAY_SANS,
        "min-h-[var(--cch-viewport-height,100vh)] bg-[#eef4ff] text-slate-950"
      )}
    >
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(30,64,175,0.12),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(15,23,42,0.08),transparent_28%)]" />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:32px_32px]" />

      <div className="relative mx-auto max-w-[1480px] px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <motion.section
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="rounded-[32px] border border-slate-200/90 bg-white/88 p-5 shadow-[0_28px_90px_-55px_rgba(15,23,42,0.45)] backdrop-blur sm:p-6"
        >
          <div className="flex flex-col gap-5 border-b border-slate-200 pb-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    DISPLAY_MONO,
                    "rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] text-slate-500"
                  )}
                >
                  Claude Code Hub
                </span>
                <span
                  className={cn(
                    DISPLAY_MONO,
                    "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] text-slate-500"
                  )}
                >
                  /{locale}/system-status
                </span>
                <StatusBadge label={t(`status.${systemStatus}`)} status={systemStatus} />
              </div>

              <div className="mt-4 flex flex-wrap items-end gap-4">
                <h1
                  className={cn(
                    DISPLAY_TITLE,
                    "text-[clamp(2.2rem,5vw,3.8rem)] font-semibold leading-none tracking-[-0.08em] text-slate-950"
                  )}
                >
                  {t("hero.title")}
                </h1>
                <span
                  className={cn(
                    DISPLAY_MONO,
                    "mb-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-slate-500"
                  )}
                >
                  {t("hero.window", { days: data?.windowDays ?? 7 })}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className={cn(DISPLAY_MONO, "text-[11px] uppercase tracking-[0.2em] text-slate-500")}>
                  {data?.queriedAt
                    ? t("hero.updatedAt", { value: formatTimestamp(locale, data.queriedAt) })
                    : t("hero.awaitingData")}
                </p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                <RefreshCw
                  className={cn(
                    "h-4 w-4 motion-reduce:animate-none",
                    refreshing && "animate-spin"
                  )}
                />
                {refreshing ? t("hero.refreshing") : t("hero.autoRefresh")}
              </div>
            </div>
          </div>

          {error ? (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryCard
              icon={Gauge}
              label={t("summary.systemAvailability")}
              value={formatPercent(locale, summary?.systemAvailability)}
              note={t("summary.providerCoverage", {
                providers: formatNumber(locale, summary?.providerCount, 0),
              })}
              emphasis="primary"
            />
            <SummaryCard
              icon={ShieldCheck}
              label={t("summary.healthyProviders")}
              value={formatNumber(locale, summary?.healthyCount, 0)}
              note={t("summary.degradedBreakdown", {
                degraded: formatNumber(locale, summary?.degradedCount, 0),
                unknown: formatNumber(locale, summary?.unknownCount, 0),
              })}
            />
            <SummaryCard
              icon={Activity}
              label={t("summary.weightedCacheHitRate")}
              value={formatPercent(locale, summary?.weightedCacheHitRate)}
            />
            <SummaryCard
              icon={Zap}
              label={t("metrics.outputRate")}
              value={
                summary?.weightedTokensPerSecond == null
                  ? "--"
                  : t("metrics.outputRateValue", {
                      value: formatNumber(locale, summary.weightedTokensPerSecond),
                    })
              }
            />
            <SummaryCard
              icon={Clock3}
              label={t("metrics.costPerMillionTokens")}
              value={
                data
                  ? formatCurrency(locale, data.currencyDisplay, summary?.weightedCostPerMillionTokens)
                  : "--"
              }
              note={
                data
                  ? formatCurrency(
                      locale,
                      data.currencyDisplay,
                      summary?.weightedCostPerHundredMillionTokens
                    )
                  : "--"
              }
            />
          </div>
        </motion.section>

        <section className="mt-4">
          {orderedProviders.length > 0 ? (
            <div className="grid gap-4">
              {orderedProviders.map((provider, index) => (
                <ProviderCard
                  key={provider.providerId}
                  currencyDisplay={data?.currencyDisplay ?? "USD"}
                  index={index}
                  locale={locale}
                  provider={provider}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/70 px-6 py-16 text-center text-slate-500 shadow-[0_18px_60px_-42px_rgba(15,23,42,0.4)]">
              {t("states.empty")}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
