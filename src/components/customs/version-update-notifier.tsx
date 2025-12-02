"use client";

import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface VersionInfo {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  releaseUrl?: string;
}

export function VersionUpdateNotifier() {
  const t = useTranslations("customs");
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    // 静默检查版本，不显示加载状态
    fetch("/api/version")
      .then((res) => res.json())
      .then((data) => {
        // 只有确实有更新时才设置状态
        if (data.hasUpdate) {
          setVersionInfo(data);
        }
      })
      .catch(() => {
        // 静默失败，不显示任何内容
      });
  }, []);

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
