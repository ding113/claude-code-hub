"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Gauge, RefreshCw, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getMyGroupRates } from "@/lib/api-client/v1/actions/my-usage";
import type { MyGroupRateItem } from "@/lib/api-client/v1/actions/my-usage";
import { getProviderTypeConfig } from "@/lib/provider-type-utils";
import { cn } from "@/lib/utils";
import { formatCostMultiplier } from "@/lib/utils/currency";
import type { ProviderType } from "@/types/provider";

const GROUP_ACCENT: Record<string, string> = {
  claude:
    "from-violet-500/15 via-fuchsia-500/10 to-transparent border-violet-200/70 dark:border-violet-800/60",
  codex:
    "from-emerald-500/15 via-teal-500/10 to-transparent border-emerald-200/70 dark:border-emerald-800/60",
  grok: "from-sky-500/15 via-cyan-500/10 to-transparent border-sky-200/70 dark:border-sky-800/60",
  image:
    "from-amber-500/15 via-orange-500/10 to-transparent border-amber-200/70 dark:border-amber-800/60",
  kimi: "from-rose-500/15 via-pink-500/10 to-transparent border-rose-200/70 dark:border-rose-800/60",
};

const GROUP_CHIP: Record<string, string> = {
  claude: "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200",
  codex: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  grok: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
  image: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  kimi: "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200",
};

const FORMAT_I18N_KEY: Record<string, string> = {
  claude: "formatClaude",
  "claude-auth": "formatClaudeAuth",
  codex: "formatCodex",
  gemini: "formatGemini",
  "gemini-cli": "formatGeminiCli",
  "openai-compatible": "formatOpenaiCompatible",
};

function groupKey(name: string): string {
  return name.trim().toLowerCase();
}

function formatLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatOnline(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "-";
  return `${Math.round(rate * 100)}%`;
}

function shortenProviderName(name: string): string {
  if (name.includes("-")) {
    const parts = name.split("-");
    if (parts.length >= 2) {
      return parts.slice(1).join("-");
    }
  }
  return name;
}

/** Group items by group label while preserving configured test-model order. */
function groupItemsByGroup(items: MyGroupRateItem[]): Array<{
  group: string;
  items: MyGroupRateItem[];
}> {
  const order: string[] = [];
  const byGroup = new Map<string, MyGroupRateItem[]>();
  for (const item of items) {
    if (!byGroup.has(item.group)) {
      byGroup.set(item.group, []);
      order.push(item.group);
    }
    byGroup.get(item.group)!.push(item);
  }
  return order.map((g) => ({ group: g, items: byGroup.get(g)! }));
}

function asProviderType(value: string | null | undefined): ProviderType {
  const v = (value || "claude").trim();
  if (
    v === "claude" ||
    v === "claude-auth" ||
    v === "codex" ||
    v === "gemini" ||
    v === "gemini-cli" ||
    v === "openai-compatible"
  ) {
    return v;
  }
  return "claude";
}

/**
 * Stable fingerprint for all user-visible group-rate card content.
 *
 * The live badge's clock represents the last content update, not the last poll.
 * Keep it unchanged when a poll returns identical card information.
 */
export function groupRatesContentFingerprint(
  data:
    | {
        items?: Array<{
          group?: string;
          providerName?: string;
          providerType?: string | null;
          costMultiplier?: number;
          providerCostMultiplier?: number;
          groupCostMultiplier?: number;
          mode?: string | null;
          priority?: number | null;
          onlineRate?: number | null;
          avgFirstByteMs?: number | null;
          healthTestModel?: string | null;
        }>;
      }
    | null
    | undefined
): string {
  const items = data?.items ?? [];
  return items
    .map((item) =>
      [
        item.group ?? "",
        item.providerName ?? "",
        item.providerType ?? "",
        item.costMultiplier ?? "",
        item.providerCostMultiplier ?? "",
        item.groupCostMultiplier ?? "",
        item.mode ?? "",
        item.priority ?? "",
        item.onlineRate ?? "",
        item.avgFirstByteMs ?? "",
        item.healthTestModel ?? "",
      ].join(":")
    )
    .sort()
    .join("|");
}

export function GroupRatesCard({
  className,
  pollSeconds = 3,
}: {
  className?: string;
  /** Poll interval in seconds (default 3). Near-live and paused in background tabs. */
  pollSeconds?: number;
}) {
  const t = useTranslations("myUsage.groupRates");
  const lastFingerprintRef = useRef<string>("");
  const [contentChangedAt, setContentChangedAt] = useState<number | null>(null);

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ["my-group-rates"],
    queryFn: async () => {
      const res = await getMyGroupRates();
      if (!res.ok) {
        throw new Error((res as { error?: string }).error || "group-rates");
      }
      return res.data;
    },
    // Keep data soft-stale so each interval actually hits the network.
    staleTime: 0,
    // Near-live: short poll + focus/reconnect; pause in background tabs.
    refetchInterval: Math.max(2, pollSeconds) * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  // Poll continuously, but only move the visible clock when card content actually changes.
  useEffect(() => {
    if (!data) return;
    const next = groupRatesContentFingerprint(data);
    if (!next) return;
    if (next === lastFingerprintRef.current) return;
    lastFingerprintRef.current = next;
    setContentChangedAt(Date.now());
  }, [data]);

  const items = data?.items ?? [];
  const updatedLabel = contentChangedAt ? new Date(contentChangedAt).toLocaleTimeString() : "";

  return (
    <div
      className={cn(
        "rounded-xl border border-border/70 bg-gradient-to-br from-background via-muted/20 to-background p-4 shadow-sm",
        className
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Gauge className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-tight">{t("title")}</h3>
              <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
              isFetching
                ? "border-primary/30 text-primary"
                : "border-emerald-300/70 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isFetching ? "bg-primary animate-pulse" : "bg-emerald-500 animate-pulse"
              )}
            />
            <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
            {t("live")}
            {updatedLabel ? (
              <span className="text-muted-foreground/80 tabular-nums">{updatedLabel}</span>
            ) : null}
          </span>
        </div>
      </div>

      {isError ? (
        <div className="rounded-lg border border-dashed border-rose-300/60 bg-rose-50/50 px-3 py-6 text-center text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-300">
          {t("loadFailed")}
        </div>
      ) : isLoading && items.length === 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-[104px] animate-pulse rounded-xl border border-border/50 bg-muted/40"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {groupItemsByGroup(items).map(({ group, items: groupItems }) => {
            const gk = groupKey(group);
            const accent = GROUP_ACCENT[gk] ?? GROUP_ACCENT.codex;
            const chip = GROUP_CHIP[gk] ?? GROUP_CHIP.codex;

            return (
              <div
                key={group}
                className={cn(
                  "relative overflow-hidden rounded-xl border bg-gradient-to-br p-3 transition-shadow hover:shadow-md",
                  accent
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <Badge
                    variant="outline"
                    className={cn("border-0 font-semibold tracking-wide", chip)}
                  >
                    {group}
                  </Badge>
                  {groupItems.length > 1 ? (
                    <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                      ×{groupItems.length}
                    </span>
                  ) : null}
                </div>

                <div className="mt-2 space-y-1.5">
                  {groupItems.map((item) => {
                    const mult = formatCostMultiplier(item.costMultiplier);
                    const cheap = item.costMultiplier > 0 && item.costMultiplier < 0.1;
                    const free = item.costMultiplier === 0;
                    const pType = asProviderType(item.providerType);
                    const TypeIcon = getProviderTypeConfig(pType).icon;
                    const formatKey = FORMAT_I18N_KEY[pType] ?? "formatUnknown";
                    const formatLabel = t(formatKey as "formatClaude");
                    const rowLabel =
                      item.healthTestModel ?? shortenProviderName(item.providerName);

                    return (
                      <div
                        key={`${item.providerId}-${item.healthTestModel ?? "legacy"}`}
                        className="rounded-lg border border-border/50 bg-background/50 p-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              {item.mode === "health_slo" ? (
                                <Activity className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <Sparkles className="h-3 w-3 shrink-0 text-muted-foreground" />
                              )}
                              <span className="truncate font-mono text-[11px] font-medium text-foreground/90">
                                {rowLabel}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                              <TypeIcon className="h-3 w-3 shrink-0" />
                              <span className="truncate">{formatLabel}</span>
                            </div>
                          </div>
                          <Tooltip delayDuration={150}>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "shrink-0 font-mono text-[11px] tabular-nums",
                                  free
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                                    : cheap
                                      ? "border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200"
                                      : item.costMultiplier > 1
                                        ? "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200"
                                        : "border-border/70 bg-background/70"
                                )}
                              >
                                {free ? t("free") : `×${mult}`}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              <div className="space-y-0.5">
                                <div>{t("multiplierHint")}</div>
                                <div className="text-muted-foreground">
                                  {t("providerMult")} ×
                                  {formatCostMultiplier(item.providerCostMultiplier ?? item.costMultiplier)}
                                  {" · "}
                                  {t("groupMult")} ×{formatCostMultiplier(item.groupCostMultiplier ?? 1)}
                                </div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </div>

                        <Tooltip delayDuration={200}>
                          <TooltipTrigger asChild>
                            <p className="mt-1 truncate text-xs text-foreground/80">
                              {t("online")}: {formatOnline(item.onlineRate)} · {t("totalLatency")}:{" "}
                              {formatLatency(item.avgFirstByteMs)}
                            </p>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs text-xs">
                            <div className="space-y-0.5">
                              <div>{item.providerName}</div>
                              <div className="text-muted-foreground">
                                {t("requestFormat")}: {formatLabel}
                              </div>
                              {item.healthTestModel ? (
                                <div className="text-muted-foreground">
                                  {t("healthBaseline")}: {item.healthTestModel}
                                </div>
                              ) : null}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
