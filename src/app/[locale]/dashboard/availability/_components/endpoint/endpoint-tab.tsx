"use client";

import { Radio } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type DashboardProviderVendor,
  getDashboardProviderEndpoints,
  getDashboardProviderVendors,
  getProviderEndpointProbeLogs,
  probeProviderEndpoint,
} from "@/actions/provider-endpoints";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ProviderEndpoint, ProviderEndpointProbeLog, ProviderType } from "@/types/provider";
import { LatencyCurve } from "./latency-curve";
import { ProbeGrid } from "./probe-grid";
import { ProbeTerminal } from "./probe-terminal";

export function EndpointTab() {
  const t = useTranslations("dashboard.availability");

  // State
  const [vendors, setVendors] = useState<DashboardProviderVendor[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(null);
  const [selectedType, setSelectedType] = useState<ProviderType | null>(null);
  const [endpoints, setEndpoints] = useState<ProviderEndpoint[]>([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState<ProviderEndpoint | null>(null);
  const [probeLogs, setProbeLogs] = useState<ProviderEndpointProbeLog[]>([]);

  // Loading states
  const [loadingVendors, setLoadingVendors] = useState(true);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [probing, setProbing] = useState(false);

  const vendorsRequestIdRef = useRef(0);
  const endpointsRequestIdRef = useRef(0);
  const probeLogsRequestIdRef = useRef(0);
  // 切换浏览器标签页时 focus + visibilitychange 可能同时触发；节流避免重复刷新造成请求放大。
  const lastFocusRefreshAtRef = useRef(0);
  const latestSelectionRef = useRef<{
    vendorId: number | null;
    providerType: ProviderType | null;
    endpointId: number | null;
  }>({ vendorId: null, providerType: null, endpointId: null });

  latestSelectionRef.current.vendorId = selectedVendorId;
  latestSelectionRef.current.providerType = selectedType;
  latestSelectionRef.current.endpointId = selectedEndpoint?.id ?? null;

  const refreshVendors = useCallback(async (options?: { silent?: boolean }) => {
    const requestId = ++vendorsRequestIdRef.current;
    if (!options?.silent) {
      setLoadingVendors(true);
    }

    try {
      const currentVendorId = latestSelectionRef.current.vendorId;
      const currentType = latestSelectionRef.current.providerType;
      const nextVendors = await getDashboardProviderVendors();

      if (requestId !== vendorsRequestIdRef.current) {
        return null;
      }

      setVendors(nextVendors);

      if (nextVendors.length === 0) {
        setSelectedVendorId(null);
        setSelectedType(null);
        setSelectedEndpoint(null);
        return {
          selectionChanged: currentVendorId != null || currentType != null,
          vendorId: null,
          providerType: null,
        };
      }

      const vendor =
        (currentVendorId ? nextVendors.find((v) => v.id === currentVendorId) : null) ??
        nextVendors[0] ??
        null;

      if (!vendor) {
        setSelectedVendorId(null);
        setSelectedType(null);
        setSelectedEndpoint(null);
        return {
          selectionChanged: currentVendorId != null || currentType != null,
          vendorId: null,
          providerType: null,
        };
      }

      const nextVendorId = vendor.id;
      const nextProviderType =
        currentType && vendor.providerTypes.includes(currentType)
          ? currentType
          : (vendor.providerTypes[0] ?? null);

      const selectionChanged = nextVendorId !== currentVendorId || nextProviderType !== currentType;

      if (selectionChanged) {
        // 避免 selection 自动切换期间仍能对旧 endpoint 发起探测请求（#781）。
        setSelectedEndpoint(null);
      }

      setSelectedVendorId(nextVendorId);
      setSelectedType(nextProviderType);

      return {
        selectionChanged,
        vendorId: nextVendorId,
        providerType: nextProviderType,
      };
    } catch (error) {
      if (requestId !== vendorsRequestIdRef.current) {
        return null;
      }
      console.error("Failed to fetch vendors:", error);
      return null;
    } finally {
      if (!options?.silent && requestId === vendorsRequestIdRef.current) {
        setLoadingVendors(false);
      }
    }
  }, []);

  const refreshEndpoints = useCallback(
    async (params: {
      vendorId: number;
      providerType: ProviderType;
      keepSelectedEndpointId?: number | null;
    }) => {
      const requestId = ++endpointsRequestIdRef.current;
      setLoadingEndpoints(true);

      try {
        const nextEndpoints = await getDashboardProviderEndpoints({
          vendorId: params.vendorId,
          providerType: params.providerType,
        });

        if (requestId !== endpointsRequestIdRef.current) {
          return;
        }

        setEndpoints(nextEndpoints);

        const keepId = params.keepSelectedEndpointId ?? null;
        if (keepId) {
          const kept = nextEndpoints.find((e) => e.id === keepId) ?? null;
          setSelectedEndpoint(kept ?? nextEndpoints[0] ?? null);
          return;
        }

        setSelectedEndpoint(nextEndpoints[0] ?? null);
      } catch (error) {
        if (requestId !== endpointsRequestIdRef.current) {
          return;
        }
        console.error("Failed to fetch endpoints:", error);
        setEndpoints([]);
        setSelectedEndpoint(null);
      } finally {
        if (requestId === endpointsRequestIdRef.current) {
          setLoadingEndpoints(false);
        }
      }
    },
    []
  );

  const refreshProbeLogs = useCallback(async (endpointId: number) => {
    const requestId = ++probeLogsRequestIdRef.current;
    setLoadingLogs(true);

    try {
      const result = await getProviderEndpointProbeLogs({
        endpointId,
        limit: 100,
      });

      if (requestId !== probeLogsRequestIdRef.current) {
        return;
      }

      if (latestSelectionRef.current.endpointId !== endpointId) {
        return;
      }

      if (result.ok && result.data) {
        setProbeLogs(result.data.logs);
      }
    } catch (error) {
      if (requestId !== probeLogsRequestIdRef.current) {
        return;
      }
      console.error("Failed to fetch probe logs:", error);
    } finally {
      if (requestId === probeLogsRequestIdRef.current) {
        setLoadingLogs(false);
      }
    }
  }, []);

  // Fetch vendors on mount
  useEffect(() => {
    void refreshVendors();
  }, [refreshVendors]);

  // Fetch endpoints when vendor or type changes
  useEffect(() => {
    if (!selectedVendorId || !selectedType) {
      endpointsRequestIdRef.current += 1;
      setEndpoints([]);
      setSelectedEndpoint(null);
      setLoadingEndpoints(false);
      return;
    }

    void refreshEndpoints({ vendorId: selectedVendorId, providerType: selectedType });
  }, [selectedVendorId, selectedType, refreshEndpoints]);

  // Fetch probe logs when endpoint changes
  useEffect(() => {
    const endpointId = selectedEndpoint?.id ?? null;
    if (!endpointId) {
      probeLogsRequestIdRef.current += 1;
      setProbeLogs([]);
      setLoadingLogs(false);
      return;
    }

    void refreshProbeLogs(endpointId);
  }, [selectedEndpoint?.id, refreshProbeLogs]);

  // Auto-refresh logs every 10 seconds
  useEffect(() => {
    const endpointId = selectedEndpoint?.id;
    if (!endpointId) return;
    const timer = setInterval(() => {
      void refreshProbeLogs(endpointId);
    }, 10000);
    return () => clearInterval(timer);
  }, [selectedEndpoint?.id, refreshProbeLogs]);

  // 当用户从“设置页”修改/删除端点后返回本页，自动做一次轻量刷新，避免看到陈旧列表（#781）。
  useEffect(() => {
    const refresh = async () => {
      const vendorResult = await refreshVendors({ silent: true });

      const vendorId = vendorResult?.vendorId ?? latestSelectionRef.current.vendorId;
      const providerType = vendorResult?.providerType ?? latestSelectionRef.current.providerType;
      const endpointId = latestSelectionRef.current.endpointId;

      if (!vendorResult?.selectionChanged && vendorId && providerType) {
        void refreshEndpoints({
          vendorId,
          providerType,
          keepSelectedEndpointId: endpointId,
        });
      }

      if (!vendorResult?.selectionChanged && endpointId) {
        void refreshProbeLogs(endpointId);
      }
    };

    // 切回前台时，focus 与 visibilitychange 往往会连发；节流避免重复触发 refresh 链路。
    const refreshThrottled = () => {
      const now = Date.now();
      if (now - lastFocusRefreshAtRef.current < 2000) return;
      lastFocusRefreshAtRef.current = now;
      void refresh();
    };

    const onFocus = () => {
      refreshThrottled();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshThrottled();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshEndpoints, refreshProbeLogs, refreshVendors]);

  // Handle manual probe
  const handleProbe = async () => {
    const endpoint = selectedEndpoint;
    const vendorId = selectedVendorId;
    const providerType = selectedType;
    if (!endpoint || !vendorId || !providerType) return;

    setProbing(true);
    try {
      const result = await probeProviderEndpoint({
        endpointId: endpoint.id,
      });
      if (result.ok) {
        toast.success(t("actions.probeSuccess"));

        // 避免 probe 完成后覆盖用户在 probe 期间切换的 vendor/type/endpoint。
        const stillSameVendorType =
          latestSelectionRef.current.vendorId === vendorId &&
          latestSelectionRef.current.providerType === providerType;
        const stillSameEndpoint = latestSelectionRef.current.endpointId === endpoint.id;

        if (stillSameEndpoint) {
          void refreshProbeLogs(endpoint.id);
        }

        if (stillSameVendorType) {
          await refreshEndpoints({
            vendorId,
            providerType,
            keepSelectedEndpointId: latestSelectionRef.current.endpointId,
          });
        }
      } else {
        toast.error(result.error || t("actions.probeFailed"));
      }
    } catch (error) {
      console.error("Probe failed:", error);
      toast.error(t("actions.probeFailed"));
    } finally {
      setProbing(false);
    }
  };

  if (loadingVendors) {
    return (
      <div className="space-y-6">
        <div className="flex gap-4">
          <Skeleton className="h-9 w-[200px]" />
          <Skeleton className="h-9 w-[160px]" />
        </div>
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          <Skeleton className="h-[300px] rounded-2xl" />
          <Skeleton className="h-[300px] rounded-2xl" />
        </div>
        <Skeleton className="h-[400px] rounded-2xl" />
      </div>
    );
  }

  const selectedVendor = vendors.find((vendor) => vendor.id === selectedVendorId) ?? null;
  const providerTypes = selectedVendor?.providerTypes ?? [];

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full sm:w-auto">
          {/* Vendor Select */}
          <Select
            value={selectedVendorId?.toString() || ""}
            onValueChange={(v) => {
              const vendorId = Number(v);
              setSelectedVendorId(vendorId);
              const nextVendor = vendors.find((vendor) => vendor.id === vendorId);
              setSelectedType(nextVendor?.providerTypes[0] ?? null);
              setSelectedEndpoint(null);
            }}
          >
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder={t("endpoint.selectVendor")} />
            </SelectTrigger>
            <SelectContent>
              {vendors.map((vendor) => (
                <SelectItem key={vendor.id} value={vendor.id.toString()}>
                  {vendor.displayName || vendor.websiteDomain}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Provider Type Select */}
          <Select
            value={selectedType || ""}
            onValueChange={(v) => {
              setSelectedType(v as ProviderType);
              setSelectedEndpoint(null);
            }}
            disabled={!selectedVendorId}
          >
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder={t("endpoint.selectType")} />
            </SelectTrigger>
            <SelectContent>
              {providerTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Probe Button */}
        <Button
          onClick={handleProbe}
          disabled={!selectedEndpoint || probing}
          className="w-full sm:w-auto"
        >
          <Radio className={cn("h-4 w-4 mr-2", probing && "animate-pulse")} />
          {probing ? t("actions.probing") : t("actions.probeNow")}
        </Button>
      </div>

      {/* Main Content */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        {/* Probe Grid */}
        <div
          className={cn(
            "rounded-2xl p-4 md:p-6",
            "bg-card/60 dark:bg-[rgba(20,20,23,0.5)]",
            "backdrop-blur-lg",
            "border border-border/50 dark:border-white/[0.08]",
            "shadow-sm"
          )}
        >
          <h3 className="text-sm font-medium text-muted-foreground mb-4">{t("probeGrid.title")}</h3>
          {loadingEndpoints ? (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : (
            <ProbeGrid
              endpoints={endpoints}
              selectedEndpointId={selectedEndpoint?.id}
              onEndpointSelect={setSelectedEndpoint}
            />
          )}
        </div>

        {/* Latency Curve */}
        <div
          className={cn(
            "rounded-2xl p-4 md:p-6",
            "bg-card/60 dark:bg-[rgba(20,20,23,0.5)]",
            "backdrop-blur-lg",
            "border border-border/50 dark:border-white/[0.08]",
            "shadow-sm"
          )}
        >
          {loadingLogs ? (
            <Skeleton className="h-[250px] w-full" />
          ) : (
            <LatencyCurve logs={probeLogs} />
          )}
        </div>
      </div>

      {/* Probe Terminal */}
      <div
        className={cn(
          "rounded-2xl overflow-hidden",
          "bg-card/60 dark:bg-[rgba(20,20,23,0.5)]",
          "backdrop-blur-lg",
          "border border-border/50 dark:border-white/[0.08]",
          "shadow-sm"
        )}
      >
        {loadingLogs && probeLogs.length === 0 ? (
          <Skeleton className="h-[400px] w-full" />
        ) : (
          <ProbeTerminal logs={probeLogs} />
        )}
      </div>
    </div>
  );
}
