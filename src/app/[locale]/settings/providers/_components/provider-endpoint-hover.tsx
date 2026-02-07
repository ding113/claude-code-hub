"use client";

import { useQuery } from "@tanstack/react-query";
import { Server } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { getEndpointCircuitInfo, getProviderEndpointsByVendor } from "@/actions/provider-endpoints";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ProviderEndpoint, ProviderType } from "@/types/provider";
import { getEndpointStatusModel } from "./endpoint-status";

interface ProviderEndpointHoverProps {
  vendorId: number;
  providerType: ProviderType;
}

export function ProviderEndpointHover({ vendorId, providerType }: ProviderEndpointHoverProps) {
  const t = useTranslations("settings.providers");
  const [isOpen, setIsOpen] = useState(false);

  const { data: allEndpoints = [] } = useQuery({
    queryKey: ["provider-endpoints", vendorId],
    queryFn: async () => getProviderEndpointsByVendor({ vendorId }),
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

  const count = endpoints.length;

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
            {count === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {t("endpointStatus.noEndpoints")}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {endpoints.map((endpoint) => (
                  <EndpointRow key={endpoint.id} endpoint={endpoint} isOpen={isOpen} />
                ))}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function EndpointRow({ endpoint, isOpen }: { endpoint: ProviderEndpoint; isOpen: boolean }) {
  const t = useTranslations("settings.providers");

  const { data: circuitResult } = useQuery({
    queryKey: ["endpoint-circuit", endpoint.id],
    queryFn: async () => getEndpointCircuitInfo({ endpointId: endpoint.id }),
    enabled: isOpen,
    staleTime: 1000 * 10,
  });

  const circuitState =
    circuitResult?.ok && circuitResult.data ? circuitResult.data.health.circuitState : undefined;

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
