"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface VersionInfo {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  releaseUrl?: string;
}

async function fetchVersionInfo(): Promise<VersionInfo | null> {
  const response = await fetch("/api/version");
  const data = (await response.json()) as VersionInfo;
  return data.hasUpdate ? data : null;
}

export function VersionUpdateNotifier() {
  const t = useTranslations("customs");
  const { data: versionInfo } = useQuery({
    queryKey: ["version-info"],
    queryFn: fetchVersionInfo,
    retry: false,
  });

  // 没有更新时不渲染任何内容
  if (!versionInfo?.hasUpdate) {
    return null;
  }

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={versionInfo.releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center text-orange-600 hover:text-orange-700 dark:text-orange-500 dark:hover:text-orange-400"
            aria-label={t("version.ariaUpdateAvailable")}
          >
            <AlertCircle className="h-5 w-5" />
          </a>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p className="font-medium">{t("version.updateAvailable")}</p>
          <p className="text-xs text-muted-foreground">
            {versionInfo.current} → {versionInfo.latest}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
