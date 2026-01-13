"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, Plus, Server } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { getProviderEndpointsByVendors } from "@/actions/provider-endpoints";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ProviderType } from "@/types/provider";
import { EndpointAddDialog } from "./endpoint-add-dialog";
import { EndpointListItem } from "./endpoint-list-item";

export function VendorEndpointsManager({ vendorId }: { vendorId: number }) {
  const t = useTranslations("settings.providers.vendors.endpoints");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [openTypes, setOpenTypes] = useState<Record<string, boolean>>({});

  const { data: endpoints, isLoading } = useQuery({
    queryKey: ["provider-endpoints", vendorId],
    queryFn: () => getProviderEndpointsByVendors({ vendorIds: [vendorId] }),
  });

  if (isLoading) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }

  const groupedEndpoints = (endpoints || []).reduce(
    (acc, endpoint) => {
      if (!acc[endpoint.providerType]) acc[endpoint.providerType] = [];
      acc[endpoint.providerType]?.push(endpoint);
      return acc;
    },
    {} as Record<ProviderType, typeof endpoints>
  );

  const types = Object.keys(groupedEndpoints) as ProviderType[];

  const toggleType = (type: string) => {
    setOpenTypes((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          {endpoints?.length || 0} {t("count")}
        </p>
        <Button size="sm" variant="outline" onClick={() => setIsAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          {t("add")}
        </Button>
      </div>

      <EndpointAddDialog open={isAddOpen} onOpenChange={setIsAddOpen} vendorId={vendorId} />

      {endpoints?.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center rounded-lg border border-dashed bg-muted/50">
          <Server className="mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {types.map((type) => {
            const typeEndpoints = groupedEndpoints[type] || [];
            const isOpen = openTypes[type] ?? true;

            return (
              <Collapsible
                key={type}
                open={isOpen}
                onOpenChange={() => toggleType(type)}
                className="border rounded-md"
              >
                <CollapsibleTrigger asChild>
                  <button className="flex w-full items-center justify-between p-3 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm uppercase">{type}</span>
                      <Badge variant="secondary" className="text-xs">
                        {typeEndpoints.length}
                      </Badge>
                    </div>
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="p-3 pt-0 space-y-2">
                  {typeEndpoints.map((endpoint) => (
                    <EndpointListItem key={endpoint.id} endpoint={endpoint} />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      )}
    </div>
  );
}
