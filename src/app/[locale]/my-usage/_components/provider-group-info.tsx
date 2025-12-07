"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ProviderGroupInfoProps {
  keyProviderGroup: string | null;
  userProviderGroup: string | null;
  className?: string;
}

export function ProviderGroupInfo({
  keyProviderGroup,
  userProviderGroup,
  className,
}: ProviderGroupInfoProps) {
  const t = useTranslations("myUsage.providerGroup");

  const keyDisplay = keyProviderGroup ?? userProviderGroup ?? t("allProviders");
  const userDisplay = userProviderGroup ?? t("allProviders");
  const inherited = !keyProviderGroup && !!userProviderGroup;

  const badgeClass = "gap-1 rounded-full bg-card/60 text-xs font-medium";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3",
        className
      )}
    >
      <Badge variant="outline" className={badgeClass}>
        <span className="text-muted-foreground">{t("keyGroup")}:</span>
        <span className="text-foreground">{keyDisplay}</span>
        {inherited ? <span className="text-muted-foreground">{t("inheritedFromUser")}</span> : null}
      </Badge>
      <Badge variant="outline" className={badgeClass}>
        <span className="text-muted-foreground">{t("userGroup")}:</span>
        <span className="text-foreground">{userDisplay}</span>
      </Badge>
    </div>
  );
}
