"use client";
import { Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CurrencyCode } from "@/lib/utils/currency";
import type { ProviderDisplay } from "@/types/provider";
import type { User } from "@/types/user";
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
  currencyCode?: CurrencyCode;
  enableMultiProviderTypes: boolean;
}

export function ProviderList({
  providers,
  currentUser,
  healthStatus,
  currencyCode = "USD",
  enableMultiProviderTypes,
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
    <div className="border rounded-lg overflow-hidden">
      {providers.map((provider) => (
        <ProviderRichListItem
          key={provider.id}
          provider={provider}
          currentUser={currentUser}
          healthStatus={healthStatus[provider.id]}
          currencyCode={currencyCode}
          enableMultiProviderTypes={enableMultiProviderTypes}
        />
      ))}
    </div>
  );
}
