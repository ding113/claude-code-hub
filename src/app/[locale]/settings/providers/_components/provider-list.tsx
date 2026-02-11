"use client";
import { Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CurrencyCode } from "@/lib/utils/currency";
import type { ProviderDisplay, ProviderStatisticsMap } from "@/types/provider";
import type { User } from "@/types/user";
import type { EndpointCircuitInfoMap } from "./provider-manager";
import { ProviderRichListItem } from "./provider-rich-list-item";

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
  allGroups?: string[];
  userGroups?: string[];
  isAdmin?: boolean;
}

export function ProviderList({
  providers,
  currentUser,
  healthStatus,
  endpointCircuitInfo = {},
  statistics = {},
  statisticsLoading = false,
  currencyCode = "USD",
  enableMultiProviderTypes,
  activeGroupFilter = null,
  isMultiSelectMode = false,
  selectedProviderIds = new Set(),
  onSelectProvider,
  allGroups = [],
  userGroups = [],
  isAdmin = false,
}: ProviderListProps) {
  const t = useTranslations("settings.providers");

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
    <div className="grid gap-3 md:block md:border md:rounded-lg md:overflow-hidden md:gap-0">
      {providers.map((provider) => (
        <ProviderRichListItem
          key={provider.id}
          provider={provider}
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
          allGroups={allGroups}
          userGroups={userGroups}
          isAdmin={isAdmin}
        />
      ))}
    </div>
  );
}
