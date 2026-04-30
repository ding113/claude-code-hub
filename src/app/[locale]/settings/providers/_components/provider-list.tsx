"use client";
import { Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useProviderVendorsList } from "@/lib/api-client/v1/provider-endpoints/hooks";
import type { CurrencyCode } from "@/lib/utils/currency";
import type { ProviderDisplay, ProviderStatisticsMap } from "@/types/provider";
import type { User } from "@/types/user";
import type { EndpointCircuitInfoMap } from "./provider-manager";
import { ProviderRichListItem } from "./provider-rich-list-item";

// Stable default references to avoid re-creating on every render (defeats React.memo)
const EMPTY_STRING_ARRAY: string[] = [];
const EMPTY_OBJECT: Record<string, never> = {};
const EMPTY_SET = new Set<number>();

interface ProviderListProps {
  providers: ProviderDisplay[];
  currentUser?: User;
  healthStatus: Record<
    number,
    {
      circuitState: "closed" | "open" | "half-open";
      failureCount: number;
      lastFailureTime: number | null;
      circuitOpenUntil: number | null;
      recoveryMinutes: number | null;
    }
  >;
  /** Endpoint-level circuit breaker info, keyed by provider ID */
  endpointCircuitInfo?: EndpointCircuitInfoMap;
  statistics?: ProviderStatisticsMap;
  statisticsLoading?: boolean;
  currencyCode?: CurrencyCode;
  enableMultiProviderTypes: boolean;
  activeGroupFilter?: string | null;
  isMultiSelectMode?: boolean;
  selectedProviderIds?: Set<number>;
  onSelectProvider?: (providerId: number, checked: boolean) => void;
  onEditProvider?: (provider: ProviderDisplay) => void;
  allGroups?: string[];
  userGroups?: string[];
  isAdmin?: boolean;
}

export function ProviderList({
  providers,
  currentUser,
  healthStatus,
  endpointCircuitInfo = EMPTY_OBJECT,
  statistics = EMPTY_OBJECT,
  statisticsLoading = false,
  currencyCode = "USD",
  enableMultiProviderTypes,
  activeGroupFilter = null,
  isMultiSelectMode = false,
  selectedProviderIds = EMPTY_SET,
  onSelectProvider,
  onEditProvider,
  allGroups = EMPTY_STRING_ARRAY,
  userGroups = EMPTY_STRING_ARRAY,
  isAdmin = false,
}: ProviderListProps) {
  const t = useTranslations("settings.providers");

  const { data: vendorsResponse } = useProviderVendorsList();
  const vendorById = useMemo(() => {
    const items = vendorsResponse?.items ?? [];
    return new Map(
      items.map((vendor) => [
        vendor.id,
        {
          id: vendor.id,
          websiteDomain: vendor.websiteDomain,
          displayName: vendor.displayName,
          websiteUrl: vendor.websiteUrl,
          faviconUrl: vendor.faviconUrl,
          createdAt: new Date(vendor.createdAt),
          updatedAt: new Date(vendor.updatedAt),
        },
      ])
    );
  }, [vendorsResponse]);

  if (providers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
          <Globe className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="font-medium text-foreground mb-1">{t("noProviders")}</h3>
        <p className="text-sm text-muted-foreground text-center">{t("noProvidersDesc")}</p>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid gap-3 md:block md:border md:rounded-lg md:overflow-hidden md:gap-0">
        {providers.map((provider) => (
          <ProviderRichListItem
            key={provider.id}
            provider={provider}
            vendor={
              provider.providerVendorId ? vendorById.get(provider.providerVendorId) : undefined
            }
            currentUser={currentUser}
            healthStatus={healthStatus[provider.id]}
            endpointCircuitInfo={endpointCircuitInfo[provider.id]}
            statistics={statistics[provider.id]}
            statisticsLoading={statisticsLoading}
            currencyCode={currencyCode}
            enableMultiProviderTypes={enableMultiProviderTypes}
            activeGroupFilter={activeGroupFilter}
            isMultiSelectMode={isMultiSelectMode}
            isSelected={selectedProviderIds.has(provider.id)}
            onSelectChange={
              onSelectProvider ? (checked) => onSelectProvider(provider.id, checked) : undefined
            }
            onEdit={onEditProvider ? () => onEditProvider(provider) : undefined}
            allGroups={allGroups}
            userGroups={userGroups}
            isAdmin={isAdmin}
          />
        ))}
      </div>
    </TooltipProvider>
  );
}
