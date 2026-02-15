"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AvailabilityQueryResult } from "@/lib/availability";
import { cn } from "@/lib/utils";
import { EndpointTab } from "./endpoint/endpoint-tab";
import { OverviewSection } from "./overview/overview-section";
import { ProviderTab } from "./provider/provider-tab";

export type TimeRangeOption = "15min" | "1h" | "6h" | "24h" | "7d";

// Target number of buckets to fill the heatmap width consistently
const TARGET_BUCKETS = 60;

const TIME_RANGE_MAP: Record<TimeRangeOption, number> = {
  "15min": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

function calculateBucketSize(timeRangeMs: number): number {
  const bucketSizeMs = timeRangeMs / TARGET_BUCKETS;
  const bucketSizeMinutes = bucketSizeMs / (60 * 1000);
  return Math.max(0.25, Math.round(bucketSizeMinutes * 4) / 4);
}

export function AvailabilityDashboard() {
  const t = useTranslations("dashboard.availability");
  const [activeTab, setActiveTab] = useState<"provider" | "endpoint">("provider");
  const [timeRange, setTimeRange] = useState<TimeRangeOption>("24h");
  const [data, setData] = useState<AvailabilityQueryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastFocusRefreshAtRef = useRef(0);

  const fetchData = useCallback(
    async (options?: { force?: boolean }) => {
      const force = options?.force ?? false;

      if (inFlightRef.current && !force) {
        return;
      }

      if (force) {
        abortControllerRef.current?.abort();
      }

      const requestId = ++requestIdRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      inFlightRef.current = true;

      try {
        setRefreshing(true);
        const now = new Date();
        const timeRangeMs = TIME_RANGE_MAP[timeRange];
        const startTime = new Date(now.getTime() - timeRangeMs);
        const bucketSizeMinutes = calculateBucketSize(timeRangeMs);

        const params = new URLSearchParams({
          startTime: startTime.toISOString(),
          endTime: now.toISOString(),
          bucketSizeMinutes: bucketSizeMinutes.toString(),
          maxBuckets: TARGET_BUCKETS.toString(),
        });

        const res = await fetch(`/api/availability?${params}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(t("states.fetchFailed"));
        }

        const result: AvailabilityQueryResult = await res.json();
        if (requestId !== requestIdRef.current) {
          return;
        }
        setData(result);
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        if (requestId !== requestIdRef.current) {
          return;
        }
        console.error("Failed to fetch availability data:", err);
        setError(err instanceof Error ? err.message : t("states.fetchFailed"));
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
          inFlightRef.current = false;
        }
      }
    },
    [timeRange, t]
  );

  useEffect(() => {
    void fetchData({ force: true });
  }, [fetchData]);

  // Auto-refresh: 30s for provider tab, 10s for endpoint tab
  useEffect(() => {
    const interval = activeTab === "provider" ? 30000 : 10000;
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void fetchData();
    }, interval);
    return () => clearInterval(timer);
  }, [activeTab, fetchData]);

  // 当页面从后台回到前台时，做一次节流刷新，避免看到陈旧数据；同时配合 visibility 判断减少后台请求。
  useEffect(() => {
    const refresh = () => {
      const now = Date.now();
      if (now - lastFocusRefreshAtRef.current < 2000) return;
      lastFocusRefreshAtRef.current = now;
      void fetchData({ force: true });
    };

    const onFocus = () => refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchData]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const overviewMetrics = useMemo(() => {
    const providers = data?.providers ?? [];
    const providersWithLatency = providers.filter((p) =>
      p.timeBuckets.some((b) => b.avgLatencyMs > 0)
    );

    let activeProbes = 0;
    let healthyCount = 0;
    let unhealthyCount = 0;
    for (const provider of providers) {
      if (provider.currentStatus !== "unknown") activeProbes += 1;
      if (provider.currentStatus === "green") healthyCount += 1;
      if (provider.currentStatus === "red") unhealthyCount += 1;
    }

    const avgLatency =
      providersWithLatency.length > 0
        ? providersWithLatency.reduce((sum, p) => {
            const latencies = p.timeBuckets
              .filter((b) => b.avgLatencyMs > 0)
              .map((b) => b.avgLatencyMs);
            if (latencies.length === 0) return sum;
            return sum + latencies.reduce((a, b) => a + b, 0) / latencies.length;
          }, 0) / providersWithLatency.length
        : 0;

    const errorRate =
      providers.length > 0
        ? providers.reduce((sum, p) => {
            const total = p.totalRequests;
            const errors = p.timeBuckets.reduce((s, b) => s + b.redCount, 0);
            return sum + (total > 0 ? errors / total : 0);
          }, 0) / providers.length
        : 0;

    return {
      systemAvailability: data?.systemAvailability ?? 0,
      avgLatency,
      errorRate,
      activeProbes,
      totalProbes: providers.length,
      healthyCount,
      unhealthyCount,
    };
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Overview Section */}
      <OverviewSection
        systemAvailability={overviewMetrics.systemAvailability}
        avgLatency={overviewMetrics.avgLatency}
        errorRate={overviewMetrics.errorRate}
        activeProbes={overviewMetrics.activeProbes}
        totalProbes={overviewMetrics.totalProbes}
        loading={loading}
        refreshing={refreshing}
      />

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "provider" | "endpoint")}
        className="w-full"
      >
        <TabsList className="grid w-full max-w-md grid-cols-2 mb-6">
          <TabsTrigger
            value="provider"
            className={cn(
              "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            )}
          >
            {t("tabs.provider")}
          </TabsTrigger>
          <TabsTrigger
            value="endpoint"
            className={cn(
              "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            )}
          >
            {t("tabs.endpoint")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="provider" className="mt-0">
          <ProviderTab
            data={data}
            loading={loading}
            refreshing={refreshing}
            error={error}
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
            onRefresh={() => {
              void fetchData({ force: true });
            }}
          />
        </TabsContent>

        <TabsContent value="endpoint" className="mt-0">
          <EndpointTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
