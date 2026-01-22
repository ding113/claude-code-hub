"use client";

import { Activity, AlertTriangle, Clock, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { GaugeCard } from "./gauge-card";

interface OverviewSectionProps {
  systemAvailability: number;
  avgLatency: number;
  errorRate: number;
  activeProbes: number;
  totalProbes: number;
  loading?: boolean;
  refreshing?: boolean;
}

export function OverviewSection({
  systemAvailability,
  avgLatency,
  errorRate,
  activeProbes,
  totalProbes,
  loading,
  refreshing,
}: OverviewSectionProps) {
  const t = useTranslations("dashboard.availability.overview");

  if (loading) {
    return (
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className={cn(
              "relative overflow-hidden rounded-2xl p-4 md:p-5",
              "bg-card/60 dark:bg-[rgba(20,20,23,0.5)]",
              "backdrop-blur-lg",
              "border border-border/50 dark:border-white/[0.08]"
            )}
          >
            <div className="flex items-center gap-4">
              <Skeleton className="h-20 w-20 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-16" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Calculate trends (mock for now - would need historical data)
  const availabilityTrend =
    systemAvailability > 0.95
      ? { value: 0.1, direction: "up" as const }
      : systemAvailability < 0.8
        ? { value: -2.5, direction: "down" as const }
        : { value: 0, direction: "stable" as const };

  const latencyTrend =
    avgLatency < 200
      ? { value: -5, direction: "down" as const }
      : avgLatency > 500
        ? { value: 15, direction: "up" as const }
        : { value: 0, direction: "stable" as const };

  const errorTrend =
    errorRate < 0.01
      ? { value: 0, direction: "stable" as const }
      : errorRate > 0.05
        ? { value: 2.3, direction: "up" as const }
        : { value: -0.5, direction: "down" as const };

  return (
    <div
      className={cn(
        "grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
        refreshing && "opacity-70 transition-opacity"
      )}
    >
      {/* System Availability */}
      <GaugeCard
        value={systemAvailability * 100}
        label={t("systemAvailability")}
        icon={ShieldCheck}
        trend={availabilityTrend}
        thresholds={{ warning: 95, critical: 80 }}
        formatter={(v) => `${v.toFixed(2)}%`}
      />

      {/* Average Latency */}
      <GaugeCard
        value={Math.min(avgLatency / 10, 100)} // Normalize to 0-100 (1000ms = 100%)
        label={t("avgLatency")}
        icon={Clock}
        trend={latencyTrend}
        thresholds={{ warning: 30, critical: 50 }} // 300ms warning, 500ms critical
        formatter={() =>
          avgLatency < 1000 ? `${Math.round(avgLatency)}ms` : `${(avgLatency / 1000).toFixed(2)}s`
        }
        invertColors
      />

      {/* Error Rate */}
      <GaugeCard
        value={errorRate * 100}
        label={t("errorRate")}
        icon={AlertTriangle}
        trend={errorTrend}
        thresholds={{ warning: 1, critical: 5 }} // 1% warning, 5% critical
        formatter={(v) => `${v.toFixed(2)}%`}
        invertColors
      />

      {/* Active Probes */}
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl p-4 md:p-5",
          "bg-card/60 dark:bg-[rgba(20,20,23,0.5)]",
          "backdrop-blur-lg",
          "border border-border/50 dark:border-white/[0.08]",
          "shadow-sm",
          "before:absolute before:inset-0 before:bg-gradient-to-b before:from-white/[0.02] before:to-transparent before:pointer-events-none before:z-[1]",
          "transition-all duration-300 ease-out",
          "hover:border-primary/20 hover:shadow-md",
          "hover:-translate-y-0.5",
          "group"
        )}
      >
        {/* Glow effect */}
        <div className="absolute -top-[30%] -right-[15%] w-[120px] h-[120px] rounded-full pointer-events-none z-0 bg-primary/10 blur-[40px] opacity-50 group-hover:opacity-70 transition-opacity duration-500" />

        <div className="relative z-10">
          <div className="flex items-start justify-between">
            <div className="flex flex-col">
              <p className="text-sm font-medium text-muted-foreground">{t("activeProbes")}</p>
              <h3 className="text-3xl font-bold tracking-tight text-foreground mt-1">
                {activeProbes}
                <span className="text-lg font-normal text-muted-foreground">/{totalProbes}</span>
              </h3>
            </div>
            <div className="p-2 rounded-lg bg-primary/10 dark:bg-primary/15">
              <Activity className="h-5 w-5 text-primary" />
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-4">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>{t("load")}</span>
              <span>{totalProbes > 0 ? Math.round((activeProbes / totalProbes) * 100) : 0}%</span>
            </div>
            <div className="h-1.5 w-full bg-muted/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${totalProbes > 0 ? (activeProbes / totalProbes) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
