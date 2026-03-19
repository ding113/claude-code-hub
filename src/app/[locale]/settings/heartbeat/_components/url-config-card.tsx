"use client";

import { Copy, Pencil, Terminal, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { copyToClipboard } from "@/lib/utils/clipboard";
import type { HeartbeatUrlConfig } from "@/repository/heartbeat-url-configs";

interface UrlConfigCardProps {
  config: HeartbeatUrlConfig;
  onEdit: (config: HeartbeatUrlConfig) => void;
  onDelete: (id: number) => void;
  onToggle: (id: number, enabled: boolean) => void;
  onCopy: (config: HeartbeatUrlConfig) => void;
  isLoading?: boolean;
}

export function UrlConfigCard({
  config,
  onEdit,
  onDelete,
  onToggle,
  onCopy,
  isLoading,
}: UrlConfigCardProps) {
  const t = useTranslations("settings.heartbeat");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const formatDate = (date: Date | null) => {
    if (!date) return t("form.stats.never");
    return new Date(date).toLocaleString();
  };

  const getStatus = () => {
    if (!config.lastSuccessAt && !config.lastErrorAt) {
      return { label: t("form.status.idle"), variant: "secondary" as const };
    }
    if (
      !config.lastErrorAt ||
      (config.lastSuccessAt && config.lastSuccessAt > config.lastErrorAt)
    ) {
      return { label: t("form.status.healthy"), variant: "default" as const };
    }
    return { label: t("form.status.error"), variant: "destructive" as const };
  };

  const status = getStatus();

  const generateCurlCommand = (config: HeartbeatUrlConfig): string => {
    let curl = `curl -X ${config.method}`;
    curl += ` \\\n  '${config.url}'`;

    if (config.headers && Object.keys(config.headers).length > 0) {
      for (const [key, value] of Object.entries(config.headers)) {
        const escapedValue = value.replace(/'/g, "'\\''");
        curl += ` \\\n  -H '${key}: ${escapedValue}'`;
      }
    }

    if (config.body && config.method !== "GET" && config.method !== "HEAD") {
      let body = config.body;

      try {
        const bodyObj = JSON.parse(body);
        if (bodyObj.metadata && typeof bodyObj.metadata === "object") {
          bodyObj.metadata.user_id =
            bodyObj.metadata.user_id ||
            "user_heartbeat_probe_account_heartbeat_probe_session_00000000-0000-0000-0000-000000000000";
          body = JSON.stringify(bodyObj, null, 2);
        }
      } catch {
        // 如果不是有效的 JSON，保持原样
      }

      const escapedBody = body.replace(/'/g, "'\\''");
      curl += ` \\\n  -d '${escapedBody}'`;
    }

    return curl;
  };

  const handleCopyCurl = async () => {
    const curl = generateCurlCommand(config);
    const success = await copyToClipboard(curl);
    if (success) {
      toast.success(t("form.toast.copyCurlSuccess"));
    } else {
      toast.error(t("form.toast.copyCurlFailed"));
    }
  };

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-3">
              {/* 名称和状态 */}
              <div className="flex items-center gap-2">
                <h3 className="font-medium">{config.name}</h3>
                <Badge variant={status.variant}>{status.label}</Badge>
                {config.isEnabled ? (
                  <Badge variant="outline">{t("form.enabledStatus")}</Badge>
                ) : (
                  <Badge variant="secondary">{t("form.disabledStatus")}</Badge>
                )}
              </div>

              {/* URL和方法 */}
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground break-all">{config.url}</p>
                <p className="text-xs text-muted-foreground">
                  {config.method} · {t("form.intervalSeconds.label")}: {config.intervalSeconds}s
                </p>
              </div>

              {/* 统计信息 */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">{t("form.stats.success")}: </span>
                  <span className="font-medium text-green-600">{config.successCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("form.stats.failure")}: </span>
                  <span className="font-medium text-red-600">{config.failureCount}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">{t("form.stats.lastSuccess")}: </span>
                  <span>{formatDate(config.lastSuccessAt)}</span>
                </div>
                {config.lastErrorAt && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">{t("form.stats.lastError")}: </span>
                    <span>{formatDate(config.lastErrorAt)}</span>
                    {config.lastErrorMessage && (
                      <p className="text-xs text-red-600 mt-1">{config.lastErrorMessage}</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex flex-col items-end gap-2">
              <Switch
                checked={config.isEnabled}
                onCheckedChange={(enabled) => onToggle(config.id, enabled)}
                disabled={isLoading}
              />
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleCopyCurl}
                  disabled={isLoading}
                  title={t("form.actions.copyCurl")}
                >
                  <Terminal className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onCopy(config)}
                  disabled={isLoading}
                  title={t("form.actions.copy")}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onEdit(config)}
                  disabled={isLoading}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowDeleteDialog(true)}
                  disabled={isLoading}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 删除确认对话框 */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("form.deleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>{config.name}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("form.cancelButton")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDelete(config.id);
                setShowDeleteDialog(false);
              }}
            >
              {t("form.deleteButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
