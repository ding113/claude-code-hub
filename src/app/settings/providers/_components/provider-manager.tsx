"use client";
import { useState } from "react";
import { ProviderList } from "./provider-list";
import { ProviderSortSelect, type SortOption } from "./provider-sort-select";
import { sortProviders } from "./provider-sort-utils";
import type { ProviderDisplay } from "@/types/provider";
import type { User } from "@/types/user";
import type { CurrencyCode } from "@/lib/utils/currency";

interface ProviderManagerProps {
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
  currencyCode?: CurrencyCode;
  enableMultiProviderTypes: boolean;
}

export function ProviderManager({
  providers,
  currentUser,
  healthStatus,
  currencyCode = "USD",
  enableMultiProviderTypes,
}: ProviderManagerProps) {
  const [sortBy, setSortBy] = useState<SortOption>("created_desc");
  
  const sortedProviders = sortProviders(providers, sortBy);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ProviderSortSelect value={sortBy} onValueChange={setSortBy} />
      </div>
      <ProviderList
        providers={sortedProviders}
        currentUser={currentUser}
        healthStatus={healthStatus}
        currencyCode={currencyCode}
        enableMultiProviderTypes={enableMultiProviderTypes}
      />
    </div>
  );
}

export type { ProviderDisplay } from "@/types/provider";
