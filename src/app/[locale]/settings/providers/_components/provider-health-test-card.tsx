"use client";

import { Activity, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DEFAULT_HEALTH_TEST_SLO_THRESHOLDS,
  type HealthTestSloThresholds,
  hasHealthTestSloMetrics,
  meetsHealthTestSloMetrics,
  normalizeHealthTestSloThresholds,
} from "@/lib/provider-health-test/slo-thresholds";
import {
  formatOnlineRatePercent,
  normalizeHealthTestRecentResults,
  type ProviderHealthTestSample,
} from "@/lib/provider-health-test/stats";
import { cn } from "@/lib/utils";
import { type CurrencyCode, formatCurrency, toDecimal } from "@/lib/utils/currency";
import type { ProviderDisplay } from "@/types/provider";

function formatLatencyMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function firstByteTone(
  ms: number | null | undefined,
  ok?: boolean | null,
  maxAvgFirstByteMs = DEFAULT_HEALTH_TEST_SLO_THRESHOLDS.maxAvgFirstByteMs
): "ok" | "warn" | "bad" | "neutral" {
  if (ok === false) return "bad";
  if (ms == null || !Number.isFinite(ms)) return "neutral";
  if (ms > maxAvgFirstByteMs) return "bad";
  if (ms > maxAvgFirstByteMs / 2) return "warn";
  return "ok";
}

function firstByteValueClass(tone: "ok" | "warn" | "bad" | "neutral"): string {
  switch (tone) {
    case "ok":
      return "text-emerald-600 dark:text-emerald-400";
    case "warn":
      return "text-amber-600 dark:text-amber-400";
    case "bad":
      // Successful but past the configured first-byte SLO: orange, not failure-red.
      return "text-orange-600 dark:text-orange-400";
    default:
      return "";
  }
}

function sampleBarClass(
  sample: ProviderHealthTestSample,
  maxAvgFirstByteMs = DEFAULT_HEALTH_TEST_SLO_THRESHOLDS.maxAvgFirstByteMs
): string {
  // Failure: true red (rose reads as pink on light backgrounds).
  if (!sample.ok) return "bg-red-600 dark:bg-red-500";
  const tone = firstByteTone(sample.firstByteMs, true, maxAvgFirstByteMs);
  if (tone === "bad") return "bg-orange-500 dark:bg-orange-500";
  if (tone === "warn") return "bg-amber-400 dark:bg-amber-500";
  return "bg-emerald-500 dark:bg-emerald-500";
}

function formatTestedAt(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() <= 0) return "-";
  return d.toLocaleString();
}

function formatTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "-";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

/**
 * Probe costs are usually tiny (1e-4 ~ 1e-2). Fixed 2 decimals becomes ¥0.00 and hides real value.
 * Keep more precision for small amounts while still using the site currency symbol.
 */
function formatProbeCost(value: number | null | undefined, currencyCode: CurrencyCode): string {
  const decimal = toDecimal(value) ?? toDecimal(0)!;
  const abs = decimal.abs();
  let digits = 2;
  if (abs.eq(0)) {
    digits = 2;
  } else if (abs.lt(0.0001)) {
    digits = 6;
  } else if (abs.lt(0.01)) {
    digits = 4;
  } else if (abs.lt(1)) {
    digits = 4;
  } else {
    digits = 2;
  }
  return formatCurrency(decimal, currencyCode, digits);
}

export function getProviderHealthTestStatus(
  provider: ProviderDisplay,
  t: (key: string) => string,
  thresholds?: Partial<HealthTestSloThresholds> | null,
  windowSize = 10
): {
  text: string;
  className: string;
  state: "off" | "disabled" | "pending" | "ok" | "failed";
} {
  // Provider key itself disabled.
  if (provider.isEnabled === false) {
    return {
      text: t("healthTestProviderOff"),
      className: "bg-muted text-muted-foreground border-border",
      state: "off",
    };
  }
  // Scheduled probes off.
  if (provider.scheduledHealthTestEnabled === false || provider.healthTestSloAutoDisabled) {
    if (provider.healthTestBudgetSuspendedDay) {
      return {
        text: t("healthTestBudgetSuspended"),
        className:
          "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800",
        state: "disabled",
      };
    }
    if (provider.healthTestSloAutoDisabled) {
      return {
        text: t("healthTestSloOff"),
        className:
          "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800",
        state: "disabled",
      };
    }
    return {
      text: t("healthTestDisabled"),
      className: "bg-muted text-muted-foreground border-border",
      state: "disabled",
    };
  }
  const requiredWindow = Math.min(50, Math.max(1, Math.trunc(windowSize) || 10));
  const recent = normalizeHealthTestRecentResults(provider.healthTestRecentResults);
  // A partial rolling window is not enough to qualify a provider.
  if (!recent || recent.length < requiredWindow) {
    return {
      text: t("healthTestPending"),
      className:
        "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700",
      state: "pending",
    };
  }
  if (!hasHealthTestSloMetrics(provider)) {
    if (provider.lastHealthTestOk === false) {
      return {
        text: t("healthTestFailed"),
        className:
          "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800",
        state: "failed",
      };
    }
    return {
      text: t("healthTestPending"),
      className:
        "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700",
      state: "pending",
    };
  }
  if (meetsHealthTestSloMetrics(provider, thresholds)) {
    return {
      text: t("healthTestOk"),
      className:
        "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800",
      state: "ok",
    };
  }
  return {
    text: t("healthTestFailed"),
    className:
      "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800",
    state: "failed",
  };
}

function HealthBars({
  results,
  currencyCode,
  t,
  windowSize = 10,
  maxAvgFirstByteMs = DEFAULT_HEALTH_TEST_SLO_THRESHOLDS.maxAvgFirstByteMs,
}: {
  results: ProviderHealthTestSample[] | boolean[] | null | undefined;
  currencyCode: CurrencyCode;
  t: (key: string, values?: Record<string, string | number | Date>) => string;
  windowSize?: number;
  maxAvgFirstByteMs?: number;
}) {
  const WINDOW = Math.min(50, Math.max(1, Math.trunc(windowSize) || 10));
  const samples = normalizeHealthTestRecentResults(results) ?? [];
  const bars = samples.length > 0 ? samples.slice(-WINDOW) : [];
  const padded: Array<ProviderHealthTestSample | null> = [
    ...Array.from({ length: Math.max(0, WINDOW - bars.length) }, () => null),
    ...bars,
  ];

  return (
    <div className="flex h-4 items-stretch gap-0.5 w-full overflow-hidden">
      {padded.map((sample, i) => {
        if (sample == null) {
          return (
            <span
              key={`empty-${i}`}
              className="flex-1 min-w-0 rounded-sm bg-muted/40"
              aria-hidden
            />
          );
        }

        const outcome = sample.ok ? t("healthTestOk") : t("healthTestFailed");
        const firstByte = formatLatencyMs(sample.firstByteMs);
        const latency = formatLatencyMs(sample.latencyMs);
        const when = formatTestedAt(sample.testedAt);
        const source =
          sample.source === "manual"
            ? t("healthTestSourceManual")
            : sample.source === "scheduled"
              ? t("healthTestSourceScheduled")
              : sample.source || "-";
        const errorLine =
          !sample.ok && (sample.errorMessage || sample.errorType)
            ? `${sample.errorType ? `${sample.errorType}: ` : ""}${sample.errorMessage || ""}`.trim()
            : null;
        const tokens =
          sample.inputTokens != null || sample.outputTokens != null
            ? `↓${formatTokens(sample.inputTokens ?? 0)} ↑${formatTokens(sample.outputTokens ?? 0)}`
            : null;
        const cost =
          sample.costUsd != null && Number.isFinite(sample.costUsd)
            ? formatProbeCost(sample.costUsd, currencyCode)
            : null;

        return (
          <Tooltip key={`sample-${i}-${sample.testedAt}`} delayDuration={120}>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "flex-1 min-w-0 rounded-sm cursor-default transition-opacity hover:opacity-90",
                  sampleBarClass(sample, maxAvgFirstByteMs)
                )}
                aria-label={`${outcome}, ${firstByte}`}
              />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs space-y-0.5">
              <div className="font-medium">
                {outcome}
                {sample.ok && firstByteTone(sample.firstByteMs, true, maxAvgFirstByteMs) === "warn"
                  ? ` · ${t("healthTestSlow")}`
                  : ""}
                {sample.ok && firstByteTone(sample.firstByteMs, true, maxAvgFirstByteMs) === "bad"
                  ? ` · ${t("healthTestVerySlow")}`
                  : ""}
                {sample.httpStatusCode != null ? ` · HTTP ${sample.httpStatusCode}` : ""}
              </div>
              <div>
                {t("healthTestSampleFirstByte")}: {firstByte}
              </div>
              <div>
                {t("healthTestSampleLatency")}: {latency}
              </div>
              {tokens ? (
                <div>
                  {t("healthTestSampleTokens")}: {tokens}
                </div>
              ) : null}
              {cost ? (
                <div>
                  {t("healthTestSampleCost")}: {cost}
                </div>
              ) : null}
              {sample.model ? (
                <div>
                  {t("healthTestSampleModel")}: {sample.model}
                </div>
              ) : null}
              <div>
                {t("healthTestSampleSource")}: {source}
              </div>
              <div>
                {t("healthTestSampleTime")}: {when}
              </div>
              {errorLine ? (
                <div className="text-rose-200 break-words">
                  {t("healthTestSampleError")}: {errorLine}
                </div>
              ) : null}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

interface ProviderHealthTestCardProps {
  provider: ProviderDisplay;
  canEdit?: boolean;
  className?: string;
  compact?: boolean;
  /** Render the health status in the containing provider header instead. */
  hideStatusBadge?: boolean;
  currencyCode?: CurrencyCode;
  /** Rolling window size for sparkline / label (from system settings). */
  windowSize?: number;
  /** Runtime SLO thresholds used for status and first-byte tones. */
  sloThresholds?: Partial<HealthTestSloThresholds> | null;
}

export function ProviderHealthTestCard({
  provider,
  canEdit: _canEdit = false,
  className,
  compact = false,
  hideStatusBadge = false,
  currencyCode = "USD",
  windowSize = 10,
  sloThresholds,
}: ProviderHealthTestCardProps) {
  const t = useTranslations("settings.providers.list");
  const normalizedSloThresholds = useMemo(
    () => normalizeHealthTestSloThresholds(sloThresholds),
    [sloThresholds]
  );
  const status = useMemo(
    () => getProviderHealthTestStatus(provider, t, normalizedSloThresholds, windowSize),
    [normalizedSloThresholds, provider, t, windowSize]
  );

  // Persisted aggregates remain visible while scheduled tests are enabled;
  // recent samples are used only for the trend bars and sample count.
  const probesEnabled =
    provider.isEnabled !== false &&
    provider.scheduledHealthTestEnabled !== false &&
    provider.healthTestSloAutoDisabled !== true;
  const probesActive = probesEnabled;

  const onlineRateText = probesActive
    ? formatOnlineRatePercent(provider.healthTestOnlineRate)
    : "-";
  const avgFb = probesActive ? formatLatencyMs(provider.healthTestAvgFirstByteMs) : "-";
  const lastFb =
    probesActive && provider.lastHealthTestOk
      ? formatLatencyMs(provider.lastHealthTestFirstByteMs)
      : "-";
  const avgFbTone = probesActive
    ? firstByteTone(
        provider.healthTestAvgFirstByteMs,
        true,
        normalizedSloThresholds.maxAvgFirstByteMs
      )
    : "neutral";
  const lastFbTone = probesActive
    ? firstByteTone(
        provider.lastHealthTestFirstByteMs,
        provider.lastHealthTestOk,
        normalizedSloThresholds.maxAvgFirstByteMs
      )
    : "neutral";
  const model = probesActive ? provider.lastHealthTestModel : null;
  const todayCalls = provider.healthTestTodayCalls ?? 0;
  const todayCost = formatProbeCost(provider.healthTestTodayCostUsd ?? 0, currencyCode);
  const recentResults = probesActive ? provider.healthTestRecentResults : null;
  const effectiveWindowSize = Math.min(50, Math.max(1, Math.trunc(windowSize) || 10));
  const recentSampleCount = Math.min(
    effectiveWindowSize,
    normalizeHealthTestRecentResults(recentResults)?.length ?? 0
  );

  return (
    <div
      className={cn(
        "rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 space-y-2",
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Activity
            className={cn(
              "h-3.5 w-3.5 flex-shrink-0",
              status.state === "off" || status.state === "disabled"
                ? "text-muted-foreground/60"
                : status.state === "failed"
                  ? "text-rose-500"
                  : status.state === "pending"
                    ? "text-amber-500"
                    : "text-emerald-600 dark:text-emerald-400"
            )}
          />
          <span className="text-[11px] font-medium text-foreground/80 truncate">
            {t("healthTestTitle")}
          </span>
          {model ? (
            <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[9rem]">
              {model}
            </span>
          ) : null}
        </div>
        {!hideStatusBadge ? (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Badge
              variant="outline"
              className={cn("text-[10px] px-1.5 py-0 h-5 font-medium border", status.className)}
            >
              {status.text}
            </Badge>
          </div>
        ) : null}
      </div>

      <div className={cn("grid gap-1.5", compact ? "grid-cols-2" : "grid-cols-3")}>
        <div className="min-w-0 rounded-md bg-background/70 dark:bg-background/30 px-2 py-1.5 border border-border/40">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 leading-none">
            {t("healthTestAvgFirstByte")}
          </div>
          <div
            className={cn(
              "mt-1 text-sm font-semibold tabular-nums tracking-tight whitespace-nowrap",
              firstByteValueClass(avgFbTone)
            )}
          >
            {avgFb}
          </div>
        </div>
        <div className="min-w-0 rounded-md bg-background/70 dark:bg-background/30 px-2 py-1.5 border border-border/40">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 leading-none">
            {t("healthTestLastFirstByte")}
          </div>
          <div
            className={cn(
              "mt-1 text-sm font-semibold tabular-nums tracking-tight whitespace-nowrap",
              firstByteValueClass(lastFbTone)
            )}
          >
            {lastFb}
          </div>
        </div>
        <div className="min-w-0 rounded-md bg-background/70 dark:bg-background/30 px-2 py-1.5 border border-border/40">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 leading-none">
            {t("healthTestOnlineRate")}
          </div>
          <div
            className={cn(
              "mt-1 text-sm font-semibold tabular-nums tracking-tight whitespace-nowrap",
              provider.healthTestOnlineRate != null &&
                provider.healthTestOnlineRate >= normalizedSloThresholds.minOnlineRate &&
                "text-emerald-600 dark:text-emerald-400",
              provider.healthTestOnlineRate != null &&
                provider.healthTestOnlineRate < normalizedSloThresholds.minOnlineRate &&
                "text-rose-600 dark:text-rose-400"
            )}
          >
            {onlineRateText}
          </div>
        </div>
      </div>

      <div className="flex items-stretch gap-1.5">
        <div className="min-w-0 flex-1 rounded-md bg-background/70 dark:bg-background/30 px-2 py-1.5 border border-border/40">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 leading-none">
            <span className="truncate">{t("healthTestTodayCost")}</span>
            <Tooltip delayDuration={150}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm text-muted-foreground/70 hover:text-foreground"
                  aria-label={t("healthTestCostHint")}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Info className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-xs">
                {t("healthTestCostHint")}
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="mt-1 text-sm font-semibold tabular-nums tracking-tight font-mono whitespace-nowrap">
            {todayCost}
          </div>
        </div>
        <div className="min-w-[4.5rem] rounded-md bg-background/70 dark:bg-background/30 px-2 py-1.5 border border-border/40 text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 leading-none">
            {t("healthTestTodayCalls")}
          </div>
          <div className="mt-1 text-sm font-semibold tabular-nums tracking-tight whitespace-nowrap">
            {todayCalls}
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="uppercase tracking-wider text-muted-foreground/70">
            {t("healthTestRecent60", { count: effectiveWindowSize })}
          </span>
          <span className="font-medium tabular-nums text-muted-foreground/80">
            {recentSampleCount}/{effectiveWindowSize}
          </span>
        </div>
        <HealthBars
          results={recentResults}
          currencyCode={currencyCode}
          t={t}
          windowSize={windowSize}
          maxAvgFirstByteMs={normalizedSloThresholds.maxAvgFirstByteMs}
        />
      </div>
    </div>
  );
}
