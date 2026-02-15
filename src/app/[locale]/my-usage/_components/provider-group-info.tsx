"use client";

import { Layers, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function abbreviateModel(name: string): string {
  const parts = name.split("-");

  if (parts.length === 1) {
    return parts[0].length <= 4 ? parts[0].toUpperCase() : parts[0].slice(0, 2).toUpperCase();
  }

  const letterParts: string[] = [];
  let versionMixed = "";
  const versionNums: string[] = [];

  for (const part of parts) {
    if (/^\d{8,}$/.test(part)) continue;
    if (/^[a-zA-Z]+$/.test(part)) {
      letterParts.push(part);
    } else if (/^\d+\.\d+$/.test(part)) {
      versionMixed = part;
    } else if (/^\d+[a-zA-Z]/.test(part)) {
      versionMixed = part;
    } else if (/^\d+$/.test(part)) {
      versionNums.push(part);
    } else {
      letterParts.push(part);
    }
  }

  const prefix = letterParts
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join("");

  let version = "";
  if (versionMixed) {
    version = versionMixed;
  } else if (versionNums.length > 0) {
    version = versionNums.slice(0, 2).join(".");
  }

  if (version && prefix) {
    return `${prefix}-${version}`;
  }
  return prefix || name.toUpperCase().substring(0, 3);
}

function abbreviateClient(name: string): string {
  const parts = name.split(/[-\s]+/);
  if (parts.length === 1) {
    return name.slice(0, 2).toUpperCase();
  }
  return parts
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join("");
}

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

  const hasModels = userAllowedModels.length > 0;
  const hasClients = userAllowedClients.length > 0;

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
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="shrink-0 text-xs text-muted-foreground">{tGroup("keyGroup")}:</span>
            <Badge variant="outline" className="cursor-default text-xs">
              {keyDisplay}
            </Badge>
            {inherited && (
              <span className="text-xs text-muted-foreground">({tGroup("inheritedFromUser")})</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="shrink-0 text-xs text-muted-foreground">{tGroup("userGroup")}:</span>
            <Badge variant="outline" className="cursor-default text-xs">
              {userDisplay}
            </Badge>
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
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="shrink-0 text-xs text-muted-foreground">
              {tRestrictions("models")}:
            </span>
            {hasModels ? (
              userAllowedModels.map((name) => (
                <Tooltip key={name}>
                  <TooltipTrigger asChild>
                    <span>
                      <Badge variant="outline" className="cursor-default font-mono text-xs">
                        {abbreviateModel(name)}
                      </Badge>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{name}</TooltipContent>
                </Tooltip>
              ))
            ) : (
              <span className="text-sm font-semibold text-foreground">
                {tRestrictions("noRestrictions")}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="shrink-0 text-xs text-muted-foreground">
              {tRestrictions("clients")}:
            </span>
            {hasClients ? (
              userAllowedClients.map((name) => (
                <Tooltip key={name}>
                  <TooltipTrigger asChild>
                    <span>
                      <Badge variant="outline" className="cursor-default font-mono text-xs">
                        {abbreviateClient(name)}
                      </Badge>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{name}</TooltipContent>
                </Tooltip>
              ))
            ) : (
              <span className="text-sm font-semibold text-foreground">
                {tRestrictions("noRestrictions")}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
