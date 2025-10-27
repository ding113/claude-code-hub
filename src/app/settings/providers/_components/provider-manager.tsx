"use client";
import { ProviderList } from "./provider-list";
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
  return (
    <div className="space-y-4">
      <ProviderList
        providers={providers}
        currentUser={currentUser}
        healthStatus={healthStatus}
        currencyCode={currencyCode}
        enableMultiProviderTypes={enableMultiProviderTypes}
      />
    </div>
  );
}

export type { ProviderDisplay } from "@/types/provider";
