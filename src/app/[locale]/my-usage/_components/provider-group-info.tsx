"use client";

import { Layers, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface ProviderGroupInfoProps {
  keyProviderGroup: string | null;
  userProviderGroup: string | null;
  userAllowedModels?: string[];
  userAllowedClients?: string[];
  className?: string;
}

export function ProviderGroupInfo({
  keyProviderGroup,
  userProviderGroup,
  userAllowedModels = [],
  userAllowedClients = [],
  className,
}: ProviderGroupInfoProps) {
  const tGroup = useTranslations("myUsage.providerGroup");
  const tRestrictions = useTranslations("myUsage.accessRestrictions");

  const keyDisplay = keyProviderGroup ?? userProviderGroup ?? tGroup("allProviders");
  const userDisplay = userProviderGroup ?? tGroup("allProviders");
  const inherited = !keyProviderGroup && !!userProviderGroup;

  const modelsDisplay =
    userAllowedModels.length > 0 ? userAllowedModels.join(", ") : tRestrictions("noRestrictions");
  const clientsDisplay =
    userAllowedClients.length > 0 ? userAllowedClients.join(", ") : tRestrictions("noRestrictions");

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 rounded-lg border bg-muted/40 p-4 sm:grid-cols-2",
        className
      )}
    >
      {/* Provider Groups */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-base font-semibold">
          <Layers className="h-4 w-4" />
          <span>{tGroup("title")}</span>
        </div>
        <div className="space-y-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs text-muted-foreground">{tGroup("keyGroup")}:</span>
            <span className="text-sm font-semibold text-foreground">{keyDisplay}</span>
            {inherited && (
              <span className="text-xs text-muted-foreground">({tGroup("inheritedFromUser")})</span>
            )}
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs text-muted-foreground">{tGroup("userGroup")}:</span>
            <span className="text-sm font-semibold text-foreground">{userDisplay}</span>
          </div>
        </div>
      </div>

      {/* Access Restrictions */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-base font-semibold">
          <ShieldCheck className="h-4 w-4" />
          <span>{tRestrictions("title")}</span>
        </div>
        <div className="space-y-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs text-muted-foreground">{tRestrictions("models")}:</span>
            <span className="text-sm font-semibold text-foreground">{modelsDisplay}</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs text-muted-foreground">{tRestrictions("clients")}:</span>
            <span className="text-sm font-semibold text-foreground">{clientsDisplay}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
