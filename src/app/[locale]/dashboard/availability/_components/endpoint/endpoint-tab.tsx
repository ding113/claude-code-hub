"use client";

import { Radio, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getProviderEndpointProbeLogs,
  getProviderEndpoints,
  getProviderVendors,
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
import type { ProviderEndpoint, ProviderEndpointProbeLog, ProviderVendor } from "@/types/provider";
import { LatencyCurve } from "./latency-curve";
import { ProbeGrid } from "./probe-grid";
import { ProbeTerminal } from "./probe-terminal";

type ProviderType =
  | "claude"
  | "claude-auth"
  | "codex"
  | "gemini"
  | "gemini-cli"
  | "openai-compatible";

const PROVIDER_TYPES: ProviderType[] = [
  "claude",
  "claude-auth",
  "codex",
  "gemini",
  "gemini-cli",
  "openai-compatible",
];

export function EndpointTab() {
  const t = useTranslations("dashboard.availability");

  // State
  const [vendors, setVendors] = useState<ProviderVendor[]>([]);
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

  // Fetch vendors on mount
  useEffect(() => {
    const fetchVendors = async () => {
      try {
        const vendors = await getProviderVendors();
        setVendors(vendors);
        if (vendors.length > 0) {
          setSelectedVendorId(vendors[0].id);
        }
      } catch (error) {
        console.error("Failed to fetch vendors:", error);
      } finally {
        setLoadingVendors(false);
      }
    };
    fetchVendors();
  }, []);

  // Fetch endpoints when vendor or type changes
  useEffect(() => {
    if (!selectedVendorId || !selectedType) {
      setEndpoints([]);
      return;
    }

    const fetchEndpoints = async () => {
      setLoadingEndpoints(true);
      try {
        const endpoints = await getProviderEndpoints({
          vendorId: selectedVendorId,
          providerType: selectedType,
        });
        setEndpoints(endpoints);
        if (endpoints.length > 0) {
          setSelectedEndpoint(endpoints[0]);
        } else {
          setSelectedEndpoint(null);
        }
      } catch (error) {
        console.error("Failed to fetch endpoints:", error);
      } finally {
        setLoadingEndpoints(false);
      }
    };
    fetchEndpoints();
  }, [selectedVendorId, selectedType]);

  // Fetch probe logs when endpoint changes
  const fetchProbeLogs = useCallback(async () => {
    if (!selectedEndpoint) {
      setProbeLogs([]);
      return;
    }

    setLoadingLogs(true);
    try {
      const result = await getProviderEndpointProbeLogs({
        endpointId: selectedEndpoint.id,
        limit: 100,
      });
      if (result.ok && result.data) {
        setProbeLogs(result.data.logs);
      }
    } catch (error) {
      console.error("Failed to fetch probe logs:", error);
    } finally {
      setLoadingLogs(false);
    }
  }, [selectedEndpoint]);

  useEffect(() => {
    fetchProbeLogs();
  }, [fetchProbeLogs]);

  // Auto-refresh logs every 10 seconds
  useEffect(() => {
    if (!selectedEndpoint) return;
    const timer = setInterval(fetchProbeLogs, 10000);
    return () => clearInterval(timer);
  }, [selectedEndpoint, fetchProbeLogs]);

  // Handle manual probe
  const handleProbe = async () => {
    if (!selectedEndpoint) return;

    setProbing(true);
    try {
      const result = await probeProviderEndpoint({
        endpointId: selectedEndpoint.id,
      });
      if (result.ok) {
        toast.success(t("actions.probeSuccess"));
        // Refresh logs and endpoints
        fetchProbeLogs();
        if (selectedVendorId && selectedType) {
          const endpoints = await getProviderEndpoints({
            vendorId: selectedVendorId,
            providerType: selectedType,
          });
          setEndpoints(endpoints);
          // Update selected endpoint with new data
          const updated = endpoints.find((e) => e.id === selectedEndpoint.id);
          if (updated) setSelectedEndpoint(updated);
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

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full sm:w-auto">
          {/* Vendor Select */}
          <Select
            value={selectedVendorId?.toString() || ""}
            onValueChange={(v) => {
              setSelectedVendorId(Number(v));
              setSelectedType(null);
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
              {PROVIDER_TYPES.map((type) => (
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
