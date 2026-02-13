"use client";

import { useQuery } from "@tanstack/react-query";
import { Server } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  batchGetEndpointCircuitInfo,
  batchGetVendorTypeEndpointStats,
  getProviderEndpointsByVendor,
} from "@/actions/provider-endpoints";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ProviderEndpoint, ProviderType } from "@/types/provider";
import { getEndpointStatusModel } from "./endpoint-status";

interface ProviderEndpointHoverProps {
  vendorId: number;
  providerType: ProviderType;
}

const MAX_VENDOR_IDS_PER_BATCH = 500;

type VendorTypeEndpointStats = {
  vendorId: number;
  total: number;
  enabled: number;
  healthy: number;
  unhealthy: number;
  unknown: number;
};

type VendorStatsDeferred = {
  resolve: (value: VendorTypeEndpointStats) => void;
  reject: (reason: unknown) => void;
};

const pendingVendorIdsByProviderType = new Map<ProviderType, Set<number>>();
const deferredByProviderTypeVendorId = new Map<ProviderType, Map<number, VendorStatsDeferred[]>>();
let vendorStatsFlushTimer: ReturnType<typeof setTimeout> | null = null;

function requestVendorTypeEndpointStatsBatched(
  vendorId: number,
  providerType: ProviderType
): Promise<VendorTypeEndpointStats> {
  if (!Number.isFinite(vendorId) || vendorId <= 0) {
    return Promise.resolve({
      vendorId,
      total: 0,
      enabled: 0,
      healthy: 0,
      unhealthy: 0,
      unknown: 0,
    });
  }

  return new Promise<VendorTypeEndpointStats>((resolve, reject) => {
    const pending = pendingVendorIdsByProviderType.get(providerType);
    if (pending) {
      pending.add(vendorId);
    } else {
      pendingVendorIdsByProviderType.set(providerType, new Set([vendorId]));
    }

    const deferredByVendorId = deferredByProviderTypeVendorId.get(providerType);
    if (deferredByVendorId) {
      const list = deferredByVendorId.get(vendorId);
      if (list) {
        list.push({ resolve, reject });
      } else {
        deferredByVendorId.set(vendorId, [{ resolve, reject }]);
      }
    } else {
      deferredByProviderTypeVendorId.set(
        providerType,
        new Map([[vendorId, [{ resolve, reject }]]])
      );
    }

    if (vendorStatsFlushTimer) {
      return;
    }

    vendorStatsFlushTimer = setTimeout(() => {
      vendorStatsFlushTimer = null;
      void flushVendorTypeEndpointStats();
    }, 0);
  });
}

async function flushVendorTypeEndpointStats() {
  const entries = Array.from(pendingVendorIdsByProviderType.entries());
  pendingVendorIdsByProviderType.clear();

  if (entries.length === 0) {
    return;
  }

  await Promise.all(
    entries.map(async ([providerType, vendorIdSet]) => {
      const vendorIds = Array.from(vendorIdSet);
      vendorIds.sort((a, b) => a - b);

      for (let index = 0; index < vendorIds.length; index += MAX_VENDOR_IDS_PER_BATCH) {
        const chunk = vendorIds.slice(index, index + MAX_VENDOR_IDS_PER_BATCH);
        const deferredMap =
          deferredByProviderTypeVendorId.get(providerType) ??
          new Map<number, VendorStatsDeferred[]>();
        const deferredEntries = chunk.map((vendorId) => ({
          vendorId,
          deferred: deferredMap.get(vendorId) ?? [],
        }));

        chunk.forEach((vendorId) => deferredMap.delete(vendorId));
        if (deferredMap.size === 0) {
          deferredByProviderTypeVendorId.delete(providerType);
        }

        try {
          const res = await batchGetVendorTypeEndpointStats({ vendorIds: chunk, providerType });
          const items = res.ok && res.data ? res.data : [];

          const statsByVendorId = new Map<number, VendorTypeEndpointStats>();
          chunk.forEach((vendorId) =>
            statsByVendorId.set(vendorId, {
              vendorId,
              total: 0,
              enabled: 0,
              healthy: 0,
              unhealthy: 0,
              unknown: 0,
            })
          );

          items.forEach((item) => {
            statsByVendorId.set(item.vendorId, {
              vendorId: item.vendorId,
              total: item.total,
              enabled: item.enabled,
              healthy: item.healthy,
              unhealthy: item.unhealthy,
              unknown: item.unknown,
            });
          });

          deferredEntries.forEach(({ vendorId, deferred }) => {
            const value = statsByVendorId.get(vendorId);
            if (value) {
              deferred.forEach((d) => d.resolve(value));
            } else {
              deferred.forEach((d) =>
                d.resolve({
                  vendorId,
                  total: 0,
                  enabled: 0,
                  healthy: 0,
                  unhealthy: 0,
                  unknown: 0,
                })
              );
            }
          });
        } catch {
          await Promise.all(
            deferredEntries.map(async ({ vendorId, deferred }) => {
              try {
                const endpoints = await getProviderEndpointsByVendor({ vendorId });
                const filtered = endpoints.filter(
                  (ep) =>
                    ep.providerType === providerType &&
                    ep.isEnabled === true &&
                    ep.deletedAt === null
                );

                const healthy = filtered.filter((ep) => ep.lastProbeOk === true).length;
                const unhealthy = filtered.filter((ep) => ep.lastProbeOk === false).length;
                const unknown = filtered.filter((ep) => ep.lastProbeOk == null).length;

                const value: VendorTypeEndpointStats = {
                  vendorId,
                  total: endpoints.filter(
                    (ep) => ep.providerType === providerType && ep.deletedAt === null
                  ).length,
                  enabled: filtered.length,
                  healthy,
                  unhealthy,
                  unknown,
                };

                deferred.forEach((d) => d.resolve(value));
              } catch (innerError) {
                deferred.forEach((d) => d.reject(innerError));
              }
            })
          );
        }
      }
    })
  );
}

export function ProviderEndpointHover({ vendorId, providerType }: ProviderEndpointHoverProps) {
  const t = useTranslations("settings.providers");
  const [isOpen, setIsOpen] = useState(false);

  const { data: stats } = useQuery({
    queryKey: ["provider-endpoints", vendorId, providerType, "hover-stats"],
    queryFn: async () => requestVendorTypeEndpointStatsBatched(vendorId, providerType),
    staleTime: 1000 * 30,
  });

  const count = stats?.enabled ?? 0;

  const { data: allEndpoints = [], isLoading: endpointsLoading } = useQuery({
    queryKey: ["provider-endpoints", vendorId],
    queryFn: async () => getProviderEndpointsByVendor({ vendorId }),
    enabled: isOpen || process.env.NODE_ENV === "test",
    staleTime: 1000 * 30,
  });

  const endpoints = useMemo(() => {
    return allEndpoints
      .filter(
        (ep) => ep.providerType === providerType && ep.isEnabled === true && ep.deletedAt === null
      )
      .sort((a, b) => {
        const getStatusScore = (ok: boolean | null) => {
          if (ok === true) return 0;
          if (ok === null) return 1;
          return 2;
        };
        const scoreA = getStatusScore(a.lastProbeOk);
        const scoreB = getStatusScore(b.lastProbeOk);
        if (scoreA !== scoreB) return scoreA - scoreB;

        const sortA = a.sortOrder ?? 0;
        const sortB = b.sortOrder ?? 0;
        if (sortA !== sortB) return sortA - sortB;

        const latA = a.lastProbeLatencyMs ?? Number.MAX_SAFE_INTEGER;
        const latB = b.lastProbeLatencyMs ?? Number.MAX_SAFE_INTEGER;
        if (latA !== latB) return latA - latB;

        return a.id - b.id;
      });
  }, [allEndpoints, providerType]);

  const endpointIds = useMemo(() => endpoints.map((ep) => ep.id), [endpoints]);

  const { data: circuitInfo = [] } = useQuery({
    queryKey: ["endpoint-circuit-batch", vendorId, providerType, endpointIds],
    queryFn: async () => {
      const MAX_ENDPOINT_IDS_PER_BATCH = 500;
      const chunks: number[][] = [];
      for (let index = 0; index < endpointIds.length; index += MAX_ENDPOINT_IDS_PER_BATCH) {
        chunks.push(endpointIds.slice(index, index + MAX_ENDPOINT_IDS_PER_BATCH));
      }

      const results = await Promise.all(
        chunks.map(async (chunk) => {
          const res = await batchGetEndpointCircuitInfo({ endpointIds: chunk });
          return res.ok ? res.data : [];
        })
      );

      return results.flat();
    },
    enabled: isOpen && endpointIds.length > 0,
    staleTime: 1000 * 10,
  });

  const circuitStateByEndpointId = useMemo(() => {
    const map = new Map<number, "closed" | "open" | "half-open">();
    circuitInfo.forEach((item) => {
      map.set(item.endpointId, item.circuitState);
    });
    return map;
  }, [circuitInfo]);

  return (
    <TooltipProvider>
      <Tooltip open={isOpen} onOpenChange={setIsOpen} delayDuration={200}>
        <TooltipTrigger asChild>
          <div
            className="flex items-center gap-1.5 cursor-help opacity-80 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded px-1"
            tabIndex={0}
            role="button"
            aria-label={t("endpointStatus.viewDetails", { count })}
            data-testid="endpoint-hover-trigger"
          >
            <Server className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground tabular-nums">{count}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          className="p-0 border shadow-lg rounded-lg overflow-hidden min-w-[280px] max-w-[320px] bg-popover text-popover-foreground"
        >
          <div className="bg-muted/40 px-3 py-2 border-b">
            <h4 className="text-xs font-semibold text-foreground">
              {t("endpointStatus.activeEndpoints")} ({count})
            </h4>
          </div>
          <div className="max-h-[300px] overflow-y-auto py-1">
            {endpointsLoading ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {t("keyLoading")}
              </div>
            ) : count === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {t("endpointStatus.noEndpoints")}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {endpoints.map((endpoint) => (
                  <EndpointRow
                    key={endpoint.id}
                    endpoint={endpoint}
                    circuitState={circuitStateByEndpointId.get(endpoint.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function EndpointRow({
  endpoint,
  circuitState,
}: {
  endpoint: ProviderEndpoint;
  circuitState?: "closed" | "open" | "half-open";
}) {
  const t = useTranslations("settings.providers");

  const statusModel = getEndpointStatusModel(endpoint, circuitState);
  const Icon = statusModel.icon;

  return (
    <div className="px-3 py-2 hover:bg-muted/50 transition-colors flex items-start gap-3 group">
      <div className="mt-0.5 shrink-0">
        <Icon className={cn("h-3.5 w-3.5", statusModel.color)} />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium truncate text-foreground/90">{endpoint.url}</span>
          {endpoint.lastProbeLatencyMs != null && (
            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
              {endpoint.lastProbeLatencyMs}ms
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className={cn("font-medium", statusModel.color)}>
            {t(statusModel.labelKey.replace("settings.providers.", ""))}
          </span>

          {(circuitState === "open" || circuitState === "half-open") && (
            <Badge
              variant="outline"
              className={cn(
                "h-4 px-1 text-[9px] uppercase tracking-wider border-current opacity-80",
                statusModel.color
              )}
            >
              {circuitState === "open"
                ? t("endpointStatus.circuitOpen")
                : t("endpointStatus.circuitHalfOpen")}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
