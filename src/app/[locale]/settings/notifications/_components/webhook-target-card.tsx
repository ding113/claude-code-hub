"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { WebhookTargetState } from "../_lib/hooks";
import type { NotificationType } from "../_lib/schemas";
import { TestWebhookButton } from "./test-webhook-button";

interface WebhookTargetCardProps {
  target: WebhookTargetState;
  onEdit: (target: WebhookTargetState) => void;
  onDelete: (id: number) => Promise<void> | void;
  onToggleEnabled: (id: number, enabled: boolean) => Promise<void> | void;
  onTest: (id: number, type: NotificationType) => Promise<void> | void;
}

function formatLastTest(target: WebhookTargetState, locale: string): string | null {
  if (!target.lastTestAt) return null;
  try {
    const date =
      typeof target.lastTestAt === "string" ? new Date(target.lastTestAt) : target.lastTestAt;
    return date.toLocaleString(locale, { hour12: false });
  } catch {
    return null;
  }
}

export function WebhookTargetCard({
  target,
  onEdit,
  onDelete,
  onToggleEnabled,
  onTest,
}: WebhookTargetCardProps) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const [isDeleting, setIsDeleting] = useState(false);

  const typeLabel = useMemo(() => {
    return t(`notifications.targetDialog.types.${target.providerType}` as any);
  }, [t, target.providerType]);

  const lastTestText = useMemo(() => formatLastTest(target, locale), [target, locale]);
  const lastTestOk = target.lastTestResult?.success;
  const lastTestLatency = target.lastTestResult?.latencyMs;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(target.id);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0">
            <CardTitle className="truncate">{target.name}</CardTitle>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{typeLabel}</Badge>
              <Badge variant={target.isEnabled ? "default" : "secondary"}>
                {target.isEnabled
                  ? t("notifications.targets.statusEnabled")
                  : t("notifications.targets.statusDisabled")}
              </Badge>
              {lastTestOk !== undefined ? (
                <Badge variant={lastTestOk ? "default" : "destructive"}>
                  {lastTestOk
                    ? t("notifications.targets.lastTestSuccess")
                    : t("notifications.targets.lastTestFailed")}
                  {lastTestLatency ? ` ${lastTestLatency}ms` : ""}
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onEdit(target)}>
              <Pencil className="mr-2 h-4 w-4" />
              {t("notifications.targets.edit")}
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" size="sm">
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("notifications.targets.delete")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("notifications.targets.deleteConfirmTitle")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("notifications.targets.deleteConfirm")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
                    {t("common.confirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={`target-enabled-${target.id}`}>{t("notifications.targets.enable")}</Label>
          <Switch
            id={`target-enabled-${target.id}`}
            checked={target.isEnabled}
            onCheckedChange={(checked) => onToggleEnabled(target.id, checked)}
          />
        </div>

        <div className="text-muted-foreground text-sm">
          {lastTestText ? (
            <span>
              {t("notifications.targets.lastTestAt")}: {lastTestText}
            </span>
          ) : (
            <span>{t("notifications.targets.lastTestNever")}</span>
          )}
        </div>

        <TestWebhookButton targetId={target.id} disabled={!target.isEnabled} onTest={onTest} />
      </CardContent>
    </Card>
  );
}
