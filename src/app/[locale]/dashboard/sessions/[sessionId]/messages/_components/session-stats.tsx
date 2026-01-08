"use client";

import {
  Calendar,
  Clock,
  Cpu,
  Database,
  DollarSign,
  Hash,
  Layers,
  Server,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { type CurrencyCode, formatCurrency } from "@/lib/utils/currency";

interface SessionStatsProps {
  stats: {
    userAgent: string | null;
    requestCount: number;
    firstRequestAt: Date | null;
    lastRequestAt: Date | null;
    totalDurationMs: number;
    providers: { id: number; name: string }[];
    models: string[];
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheCreationTokens: number;
    totalCacheReadTokens: number;
    totalCostUsd: string | null;
  };
  currencyCode?: CurrencyCode;
  className?: string;
}

export function SessionStats({ stats, currencyCode = "USD", className }: SessionStatsProps) {
  const t = useTranslations("dashboard.sessions.details");

  const totalTokens =
    stats.totalInputTokens +
    stats.totalOutputTokens +
    stats.totalCacheCreationTokens +
    stats.totalCacheReadTokens;

  const durationSeconds = stats.totalDurationMs / 1000;

  const hasCost = stats.totalCostUsd && parseFloat(stats.totalCostUsd) > 0;

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 gap-3">
        {hasCost && (
          <div className="col-span-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              <DollarSign className="h-3.5 w-3.5" />
              <span>{t("totalFee")}</span>
            </div>
            <div className="text-xl font-bold font-mono text-emerald-700 dark:text-emerald-300">
              {formatCurrency(stats.totalCostUsd, currencyCode, 6)}
            </div>
          </div>
        )}

        <MetricCard
          icon={<Hash className="h-3.5 w-3.5" />}
          label={t("totalRequests")}
          value={stats.requestCount.toString()}
        />

        <MetricCard
          icon={<Clock className="h-3.5 w-3.5" />}
          label={t("totalDuration")}
          value={durationSeconds < 1 ? "< 1s" : `${durationSeconds.toFixed(2)}s`}
        />

        <MetricCard
          icon={<Zap className="h-3.5 w-3.5" />}
          label={t("total")} // Total Tokens
          value={totalTokens.toLocaleString()}
          className="col-span-2"
        />
      </div>

      <Separator />

      {/* Token Breakdown - Compact List */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Layers className="h-3 w-3" />
          {t("tokenUsage")}
        </h4>
        <div className="space-y-2 text-sm">
          <TokenRow label={t("totalInput")} value={stats.totalInputTokens} />
          <TokenRow label={t("totalOutput")} value={stats.totalOutputTokens} />
          {(stats.totalCacheCreationTokens > 0 || stats.totalCacheReadTokens > 0) && (
            <>
              <div className="my-1 border-t border-dashed opacity-50" />
              <TokenRow
                label="Cache Write"
                value={stats.totalCacheCreationTokens}
                icon={<Database className="h-3 w-3 text-muted-foreground" />}
              />
              <TokenRow
                label="Cache Read"
                value={stats.totalCacheReadTokens}
                icon={<Database className="h-3 w-3 text-muted-foreground" />}
              />
            </>
          )}
        </div>
      </div>

      <Separator />

      {/* Tech Stack - Tags */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Cpu className="h-3 w-3" />
          {t("providersAndModels")}
        </h4>

        <div className="space-y-2">
          {stats.providers.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {stats.providers.map((p) => (
                <Badge
                  key={p.id}
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 h-5 font-normal bg-background"
                >
                  <Server className="h-2.5 w-2.5 mr-1 text-muted-foreground" />
                  {p.name}
                </Badge>
              ))}
            </div>
          )}

          {stats.models.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {stats.models.map((m, i) => (
                <Badge
                  key={i}
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 h-5 font-mono text-muted-foreground"
                >
                  {m}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* Metadata / Time */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Calendar className="h-3 w-3" />
          {t("overview")}
        </h4>

        <div className="space-y-3">
          <TimeRow label={t("firstRequest")} date={stats.firstRequestAt} />
          <TimeRow label={t("lastRequest")} date={stats.lastRequestAt} />
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("bg-card border rounded-md p-2.5 flex flex-col gap-1 shadow-sm", className)}>
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase font-medium">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-lg font-semibold font-mono tracking-tight leading-none mt-0.5">
        {value}
      </div>
    </div>
  );
}

function TokenRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <span className="font-mono font-medium">{value.toLocaleString()}</span>
    </div>
  );
}

function TimeRow({ label, date }: { label: string; date: Date | null }) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground uppercase">{label}</span>
      <div className="flex items-center justify-between text-xs font-mono">
        <span>{d.toLocaleDateString()}</span>
        <span className="text-muted-foreground">{d.toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
