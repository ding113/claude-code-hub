"use client";

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Clock3,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  TriangleAlert,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { startTransition, useEffect, useEffectEvent, useMemo, useState, type CSSProperties } from "react";
import { getProviderTypeConfig, getProviderTypeTranslationKey } from "@/lib/provider-type-utils";
import type { PublicSystemStatusProvider, PublicSystemStatusSnapshot } from "@/lib/system-status";
import { cn } from "@/lib/utils";

const REFRESH_INTERVAL_MS = 30_000;

const PAGE_VARS: CSSProperties = {
  ["--neo-bg" as string]: "#FFFDF5",
  ["--neo-ink" as string]: "#000000",
  ["--neo-red" as string]: "#FF6B6B",
  ["--neo-yellow" as string]: "#FFD93D",
  ["--neo-violet" as string]: "#C4B5FD",
  ["--neo-mint" as string]: "#86EFAC",
  ["--neo-paper" as string]: "#FFFFFF",
};

const DISPLAY = "font-[family-name:var(--font-system-status-display)]";
const MONO = "font-[family-name:var(--font-system-status-mono)]";
const PANEL = "border-4 border-black bg-[var(--neo-paper)] shadow-[8px_8px_0px_0px_#000]";
const PANEL_DEEP = "border-4 border-black bg-[var(--neo-paper)] shadow-[12px_12px_0px_0px_#000]";
const PANEL_PRESSABLE =
  "transition-transform duration-150 ease-out hover:-translate-x-1 hover:-translate-y-1 hover:shadow-[12px_12px_0px_0px_#000]";
const OUTLINE_TEXT_STYLE: CSSProperties = {
  WebkitTextStroke: "3px #000",
  color: "transparent",
  textShadow: "6px 6px 0px rgba(0,0,0,0.04)",
};

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

function getSystemStatus(
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

function getStatusTone(status: PublicSystemStatusProvider["currentStatus"] | "green" | "red" | "unknown") {
  if (status === "green") {
    return {
      chip: "bg-[var(--neo-mint)] text-black",
      accent: "bg-[var(--neo-mint)]",
      accentSoft: "bg-[color:rgba(134,239,172,0.24)]",
      panel: "bg-[var(--neo-paper)]",
      history: "bg-[var(--neo-mint)]",
      icon: ShieldCheck,
    };
  }

  if (status === "red") {
    return {
      chip: "bg-[var(--neo-red)] text-black",
      accent: "bg-[var(--neo-red)]",
      accentSoft: "bg-[color:rgba(255,107,107,0.22)]",
      panel: "bg-[color:rgba(255,107,107,0.08)]",
      history: "bg-[var(--neo-red)]",
      icon: TriangleAlert,
    };
  }

  return {
    chip: "bg-[var(--neo-yellow)] text-black",
    accent: "bg-[var(--neo-yellow)]",
    accentSoft: "bg-[color:rgba(255,217,61,0.24)]",
    panel: "bg-[color:rgba(255,217,61,0.12)]",
    history: "bg-[var(--neo-yellow)]",
    icon: AlertTriangle,
  };
}

function getHistoryBarClass(score: number, totalRequests: number) {
  if (totalRequests <= 0) {
    return "bg-white";
  }

  if (score >= 0.95) {
    return "bg-[var(--neo-mint)]";
  }

  if (score >= 0.5) {
    return "bg-[var(--neo-yellow)]";
  }

  return "bg-[var(--neo-red)]";
}

function getHistoryBarHeight(score: number, totalRequests: number) {
  if (totalRequests <= 0) {
    return 14;
  }

  return Math.max(18, Math.round(score * 100));
}

function Sticker({
  children,
  className,
  rotate = "rotate-0",
}: {
  children: React.ReactNode;
  className?: string;
  rotate?: string;
}) {
  return (
    <div
      className={cn(
        MONO,
        "inline-flex items-center gap-2 border-4 border-black px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] shadow-[4px_4px_0px_0px_#000]",
        rotate,
        className
      )}
    >
      {children}
    </div>
  );
}

function StatusSticker({
  label,
  status,
  animated,
}: {
  label: string;
  status: PublicSystemStatusProvider["currentStatus"] | "green" | "red" | "unknown";
  animated?: boolean;
}) {
  const tone = getStatusTone(status);
  const reduceMotion = useReducedMotion();

  return (
    <Sticker className={cn("rounded-full", tone.chip)} rotate="-rotate-2">
      <motion.span
        className="h-2.5 w-2.5 rounded-full border-2 border-black bg-black"
        animate={
          animated && !reduceMotion
            ? {
                scale: [1, 1.14, 1],
              }
            : undefined
        }
        transition={{
          duration: 1.1,
          repeat: Infinity,
          ease: "linear",
        }}
      />
      {label}
    </Sticker>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  note,
  rotate,
  toneClass,
  value,
}: {
  icon: LucideIcon;
  label: string;
  note?: string;
  rotate?: string;
  toneClass: string;
  value: string;
}) {
  return (
    <div className={cn(PANEL, PANEL_PRESSABLE, "p-4", toneClass, rotate)}>
      <div className="flex items-start justify-between gap-3">
        <span className={cn(MONO, "text-[11px] font-bold uppercase tracking-[0.18em]")}>{label}</span>
        <div className="border-4 border-black bg-white p-2">
          <Icon className="h-4 w-4 stroke-[2.75px]" />
        </div>
      </div>
      <div className={cn(DISPLAY, "mt-5 text-4xl font-bold leading-none tracking-[-0.07em]")}>
        {value}
      </div>
      {note ? <div className="mt-3 text-sm font-bold">{note}</div> : null}
    </div>
  );
}

function MetricCell({
  label,
  value,
  toneClass = "bg-white",
}: {
  label: string;
  value: string;
  toneClass?: string;
}) {
  return (
    <div className={cn("border-4 border-black p-3 shadow-[4px_4px_0px_0px_#000]", toneClass)}>
      <div className={cn(MONO, "text-[10px] font-bold uppercase tracking-[0.16em]")}>{label}</div>
      <div className={cn(DISPLAY, "mt-3 text-2xl font-bold leading-none tracking-[-0.05em]")}>
        {value}
      </div>
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
  const TypeIcon = getProviderTypeConfig(provider.providerType).icon;
  const typeKey = getProviderTypeTranslationKey(provider.providerType);
  const typeLabel = tTypes(`${typeKey}.label`);
  const StatusIcon = tone.icon;
  const latestAvailability =
    provider.history.at(-1)?.totalRequests && provider.history.at(-1)?.availabilityScore != null
      ? provider.history.at(-1)!.availabilityScore
      : provider.availability;

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
      transition={{ duration: 0.22, ease: "easeOut", delay: reduceMotion ? 0 : index * 0.04 }}
      className={cn(
        PANEL_DEEP,
        PANEL_PRESSABLE,
        "relative overflow-hidden p-4 sm:p-5",
        provider.currentStatus === "green"
          ? "bg-[var(--neo-paper)]"
          : provider.currentStatus === "red"
            ? "bg-[color:rgba(255,107,107,0.08)]"
            : "bg-[color:rgba(255,217,61,0.12)]"
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.08)_1px,transparent_1px)] bg-[size:24px_24px] opacity-30" />
      <div className="pointer-events-none absolute right-4 top-4 hidden h-24 w-24 border-4 border-black bg-[radial-gradient(#000_1.8px,transparent_1.8px)] bg-[size:12px_12px] lg:block" />

      <div className="relative">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusSticker animated label={t(`status.${provider.currentStatus}`)} status={provider.currentStatus} />
              <Sticker className="bg-[var(--neo-violet)]" rotate="rotate-2">
                <TypeIcon className="h-3.5 w-3.5 stroke-[2.5px]" />
                {typeLabel}
              </Sticker>
              <Sticker className="bg-white" rotate="-rotate-1">
                <Activity className="h-3.5 w-3.5 stroke-[2.5px]" />
                {formatCompactNumber(locale, provider.totalRequests)}
              </Sticker>
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-4">
              <div className="border-4 border-black bg-[var(--neo-yellow)] p-3 shadow-[6px_6px_0px_0px_#000]">
                <TypeIcon className="h-6 w-6 stroke-[2.75px]" />
              </div>

              <div className="min-w-0">
                <h2
                  className={cn(
                    DISPLAY,
                    "max-w-full break-all text-[clamp(2rem,5vw,3.6rem)] font-bold leading-[0.9] tracking-[-0.08em]"
                  )}
                >
                  {provider.providerName}
                </h2>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-bold">
                  <span className="inline-flex items-center gap-1.5 border-2 border-black bg-white px-2.5 py-1">
                    <StatusIcon className="h-4 w-4 stroke-[2.5px]" />
                    {formatPercent(locale, provider.successRate)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 border-2 border-black bg-white px-2.5 py-1">
                    <Clock3 className="h-4 w-4 stroke-[2.5px]" />
                    {provider.lastRequestAt
                      ? formatTimestamp(locale, provider.lastRequestAt)
                      : t("provider.meta.noRecentTraffic")}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="w-full max-w-[240px] border-4 border-black bg-black p-4 text-white shadow-[8px_8px_0px_0px_#FFD93D]">
            <div className={cn(MONO, "text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--neo-yellow)]")}>
              {t("metrics.availability")}
            </div>
            <div className={cn(DISPLAY, "mt-3 text-5xl font-bold leading-none tracking-[-0.08em]")}>
              {formatPercent(locale, provider.availability)}
            </div>
            <div className="mt-4 h-4 border-4 border-white bg-black">
              <motion.div
                className={cn("h-full border-r-4 border-black", tone.accent)}
                initial={reduceMotion ? false : { width: 0 }}
                animate={{ width: `${Math.max(0, Math.min(provider.availability * 100, 100))}%` }}
                transition={{ duration: 0.24, ease: "linear" }}
              />
            </div>
            <div className="mt-3 text-sm font-bold text-white/90">
              {formatNumber(locale, provider.avgLatencyMs, 0)} ms
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-4">
          <MetricCell
            label={t("metrics.cacheHitRate")}
            toneClass="bg-[var(--neo-violet)]"
            value={formatPercent(locale, provider.cacheHitRate)}
          />
          <MetricCell
            label={t("metrics.outputRate")}
            toneClass="bg-[var(--neo-yellow)]"
            value={
              provider.avgTokensPerSecond == null
                ? "--"
                : t("metrics.outputRateValue", {
                    value: formatNumber(locale, provider.avgTokensPerSecond),
                  })
            }
          />
          <MetricCell
            label={t("metrics.costPerMillionTokens")}
            toneClass="bg-white"
            value={formatCurrency(locale, currencyDisplay, provider.avgCostPerMillionTokens)}
          />
          <MetricCell
            label={t("metrics.costPerHundredMillionTokens")}
            toneClass="bg-[var(--neo-red)]"
            value={formatCurrency(locale, currencyDisplay, provider.avgCostPerHundredMillionTokens)}
          />
        </div>

        <div className={cn("mt-5 border-4 border-black p-4 shadow-[6px_6px_0px_0px_#000]", tone.accentSoft)}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Sticker className="bg-white" rotate="-rotate-1">
              <Gauge className="h-3.5 w-3.5 stroke-[2.5px]" />
              {t("provider.history")}
            </Sticker>
            <div className="flex flex-wrap items-center gap-2">
              <Sticker className="bg-white" rotate="rotate-1">
                {t("provider.meta.requests")} {formatCompactNumber(locale, provider.totalRequests)}
              </Sticker>
              <Sticker className={cn("bg-white", provider.lastRequestAt ? "" : "bg-[var(--neo-yellow)]")} rotate="-rotate-1">
                LIVE {formatPercent(locale, latestAvailability)}
              </Sticker>
            </div>
          </div>

          <div className="mt-5 border-4 border-black bg-white p-3">
            <div className="relative h-32 overflow-hidden bg-[linear-gradient(to_right,rgba(0,0,0,0.09)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.09)_1px,transparent_1px)] bg-[size:16px_16px]">
              <div className="absolute inset-x-0 bottom-0 top-0 flex items-end gap-1.5 px-1 pb-1">
                {provider.history.map((bucket, bucketIndex) => (
                  <motion.div
                    key={`${provider.providerId}-${bucket.bucketStart}`}
                    title={`${formatTimestamp(locale, bucket.bucketStart)} · ${formatPercent(
                      locale,
                      bucket.totalRequests > 0 ? bucket.availabilityScore : null
                    )}`}
                    className={cn(
                      "min-w-0 flex-1 border-2 border-black",
                      getHistoryBarClass(bucket.availabilityScore, bucket.totalRequests)
                    )}
                    style={{
                      height: `${getHistoryBarHeight(bucket.availabilityScore, bucket.totalRequests)}%`,
                      transformOrigin: "bottom",
                    }}
                    initial={reduceMotion ? false : { scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{
                      duration: 0.16,
                      ease: "linear",
                      delay: reduceMotion ? 0 : index * 0.03 + bucketIndex * 0.005,
                    }}
                  />
                ))}
              </div>
            </div>

            {historyMarkers.length === 3 ? (
              <div className={cn(MONO, "mt-3 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em]")}>
                <span>{historyMarkers[0]}</span>
                <span>{historyMarkers[1]}</span>
                <span>{historyMarkers[2]}</span>
              </div>
            ) : null}
          </div>
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
  const systemStatus = getSystemStatus(
    summary?.healthyCount,
    summary?.degradedCount,
    summary?.unknownCount
  );
  const orderedProviders = data?.providers ?? [];
  const liveTone = getStatusTone(systemStatus);
  const liveAvailability = formatPercent(locale, summary?.systemAvailability);

  return (
    <main
      className={cn(
        DISPLAY,
        "min-h-[var(--cch-viewport-height,100vh)] bg-[var(--neo-bg)] text-[var(--neo-ink)]"
      )}
      style={PAGE_VARS}
    >
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.08)_1px,transparent_1px)] bg-[size:32px_32px]" />
      <div className="pointer-events-none fixed inset-0 opacity-20 [background-image:radial-gradient(#000_1.6px,transparent_1.6px)] [background-size:22px_22px]" />

      <div className="relative mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <motion.section
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className={cn(PANEL_DEEP, "relative overflow-hidden bg-[var(--neo-bg)] p-4 sm:p-6")}
        >
          <div className="pointer-events-none absolute -right-4 top-5 hidden rotate-6 border-4 border-black bg-[var(--neo-red)] px-4 py-2 shadow-[6px_6px_0px_0px_#000] lg:block">
            <Sparkles className="h-5 w-5 stroke-[2.75px]" />
          </div>
          <div className="pointer-events-none absolute bottom-4 right-4 hidden lg:block">
            <Star className="h-16 w-16 fill-[var(--neo-yellow)] stroke-[3px]" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Sticker className="bg-[var(--neo-yellow)]" rotate="-rotate-2">
              Claude Code Hub
            </Sticker>
            <Sticker className="bg-white" rotate="rotate-1">
              {t("hero.pathLabel")}
              <ArrowRight className="h-3.5 w-3.5 stroke-[2.75px]" />
              /{locale}/system-status
            </Sticker>
            <StatusSticker animated label={t(`status.${systemStatus}`)} status={systemStatus} />
          </div>

          <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_320px]">
            <div className="min-w-0">
              <div className="relative">
                <div
                  className={cn(
                    DISPLAY,
                    "text-[clamp(3.8rem,11vw,8rem)] font-bold uppercase leading-[0.8] tracking-[-0.12em]"
                  )}
                  style={OUTLINE_TEXT_STYLE}
                >
                  SYSTEM
                </div>
                <div
                  className={cn(
                    DISPLAY,
                    "mt-[-0.4rem] text-[clamp(3rem,9vw,6.5rem)] font-bold uppercase leading-[0.85] tracking-[-0.12em]"
                  )}
                >
                  STATUS
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Sticker className="bg-[var(--neo-violet)]" rotate="rotate-2">
                  {t("hero.window", { days: data?.windowDays ?? 7 })}
                </Sticker>
                <Sticker className="bg-white" rotate="-rotate-1">
                  {data?.queriedAt
                    ? t("hero.updatedAt", { value: formatTimestamp(locale, data.queriedAt) })
                    : t("hero.awaitingData")}
                </Sticker>
                <Sticker className={cn(refreshing ? "bg-[var(--neo-red)]" : "bg-white")} rotate="rotate-1">
                  <RefreshCw
                    className={cn(
                      "h-3.5 w-3.5 stroke-[2.75px] motion-reduce:animate-none",
                      refreshing && "animate-spin"
                    )}
                  />
                  {refreshing ? t("hero.refreshing") : t("hero.autoRefresh")}
                </Sticker>
              </div>
            </div>

            <div
              className={cn(
                "border-4 border-black p-4 text-black shadow-[12px_12px_0px_0px_#000]",
                liveTone.accent
              )}
            >
              <div className={cn(MONO, "text-[11px] font-bold uppercase tracking-[0.18em]")}>
                {t("summary.systemAvailability")}
              </div>
              <div className={cn(DISPLAY, "mt-4 text-6xl font-bold leading-none tracking-[-0.1em]")}>
                {liveAvailability}
              </div>
              <div className="mt-5 border-4 border-black bg-white px-3 py-3">
                <div className={cn(MONO, "text-[10px] font-bold uppercase tracking-[0.16em]")}>
                  {t("summary.providerCoverage", {
                    providers: formatNumber(locale, summary?.providerCount, 0),
                  })}
                </div>
              </div>
            </div>
          </div>

          {error ? (
            <div className={cn(PANEL, "mt-5 bg-[var(--neo-red)] p-4")}>
              <div className="flex items-start gap-3 text-sm font-bold">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 stroke-[2.75px]" />
                <span>{error}</span>
              </div>
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              icon={ShieldCheck}
              label={t("summary.healthyProviders")}
              note={t("summary.degradedBreakdown", {
                degraded: formatNumber(locale, summary?.degradedCount, 0),
                unknown: formatNumber(locale, summary?.unknownCount, 0),
              })}
              rotate="-rotate-1"
              toneClass="bg-[var(--neo-yellow)]"
              value={formatNumber(locale, summary?.healthyCount, 0)}
            />
            <SummaryCard
              icon={Activity}
              label={t("summary.weightedCacheHitRate")}
              rotate="rotate-1"
              toneClass="bg-[var(--neo-violet)]"
              value={formatPercent(locale, summary?.weightedCacheHitRate)}
            />
            <SummaryCard
              icon={Zap}
              label={t("metrics.outputRate")}
              rotate="-rotate-1"
              toneClass="bg-white"
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
              note={
                data
                  ? formatCurrency(
                      locale,
                      data.currencyDisplay,
                      summary?.weightedCostPerHundredMillionTokens
                    )
                  : "--"
              }
              rotate="rotate-1"
              toneClass="bg-[var(--neo-red)]"
              value={
                data
                  ? formatCurrency(locale, data.currencyDisplay, summary?.weightedCostPerMillionTokens)
                  : "--"
              }
            />
          </div>
        </motion.section>

        <section className="mt-5">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Sticker className="bg-[var(--neo-yellow)]" rotate="-rotate-2">
              {t("provider.sectionEyebrow")}
            </Sticker>
            <Sticker className="bg-white" rotate="rotate-1">
              {orderedProviders.length} providers
            </Sticker>
          </div>

          {orderedProviders.length > 0 ? (
            <div className="grid gap-5">
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
            <div className={cn(PANEL_DEEP, "bg-white p-10 text-center")}>{t("states.empty")}</div>
          )}
        </section>
      </div>
    </main>
  );
}
