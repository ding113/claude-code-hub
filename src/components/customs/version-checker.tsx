"use client";

import { ExternalLink, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface VersionInfo {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  releaseUrl?: string;
  publishedAt?: string;
  error?: string;
}

export function VersionChecker() {
  const t = useTranslations("customs");
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const checkVersion = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/version");
      const data = await response.json();
      setVersionInfo(data);
    } catch (error) {
      console.error("检查版本失败:", error);
      setVersionInfo({
        current: "dev",
        latest: null,
        hasUpdate: false,
        error: t("version.errorNetwork"),
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    checkVersion();
  }, [checkVersion]);

  if (!versionInfo && loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("version.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>{t("version.checking")}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("version.title")}</CardTitle>
        <CardDescription>{t("version.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{t("version.current")}</p>
            <p className="text-lg font-mono">{versionInfo?.current}</p>
          </div>
          {versionInfo?.latest && (
            <div>
              <p className="text-sm text-muted-foreground">{t("version.latest")}</p>
              <p className="text-lg font-mono">{versionInfo.latest}</p>
            </div>
          )}
        </div>

        {versionInfo?.hasUpdate && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-900 dark:bg-orange-950">
            <div className="flex items-start gap-3">
              <Badge variant="outline" className="bg-orange-500 text-white">
                {t("version.updateAvailable")}
              </Badge>
              <div className="flex-1">
                <p className="text-sm">
                  {t("version.foundUpdate")} <code className="font-mono">{versionInfo.latest}</code>
                </p>
                {versionInfo.publishedAt && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("version.publishedAt")}{" "}
                    {new Date(versionInfo.publishedAt).toLocaleDateString("zh-CN")}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {versionInfo?.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {versionInfo.error}
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={checkVersion} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {t("version.checkUpdate")}
          </Button>
          {versionInfo?.releaseUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={versionInfo.releaseUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                {t("version.viewRelease")}
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
