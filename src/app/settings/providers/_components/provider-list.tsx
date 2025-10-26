"use client";
import { Globe } from "lucide-react";
import type { ProviderDisplay } from "@/types/provider";
import type { User } from "@/types/user";
import { ProviderListItem } from "./provider-list-item";
import type { CurrencyCode } from "@/lib/utils/currency";

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
}

export function ProviderList({ providers, currentUser, healthStatus, currencyCode = "USD" }: ProviderListProps) {
  if (providers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
          <Globe className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="font-medium text-foreground mb-1">暂无服务商配置</h3>
        <p className="text-sm text-muted-foreground text-center">添加你的第一个 API 服务商</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {providers.map((provider) => (
        <ProviderListItem
          key={provider.id}
          item={provider}
          currentUser={currentUser}
          healthStatus={healthStatus[provider.id]}
          currencyCode={currencyCode}
        />
      ))}
    </div>
  );
}
