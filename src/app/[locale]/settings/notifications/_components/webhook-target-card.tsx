"use client";

import { ExternalLink, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
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
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

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
      setShowDeleteDialog(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          "p-4 rounded-xl bg-white/[0.02] border border-white/5",
          "hover:bg-white/[0.04] hover:border-white/10 transition-colors"
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="p-2 rounded-lg bg-blue-500/10 shrink-0">
              <ExternalLink className="h-4 w-4 text-blue-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium text-foreground truncate">{target.name}</p>
                <Badge variant="secondary" className="text-[10px] shrink-0">
                  {typeLabel}
                </Badge>
              </div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {lastTestOk !== undefined ? (
                  <Badge variant={lastTestOk ? "default" : "destructive"} className="text-[10px]">
                    {lastTestOk
                      ? t("notifications.targets.lastTestSuccess")
                      : t("notifications.targets.lastTestFailed")}
                    {lastTestLatency ? ` ${lastTestLatency}ms` : ""}
                  </Badge>
                ) : null}
                {lastTestText && (
                  <span className="text-[10px] text-muted-foreground">
                    {t("notifications.targets.lastTestAt")}: {lastTestText}
                  </span>
                )}
                {!lastTestText && (
                  <span className="text-[10px] text-muted-foreground">
                    {t("notifications.targets.lastTestNever")}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Switch
              checked={target.isEnabled}
              onCheckedChange={(checked) => onToggleEnabled(target.id, checked)}
              aria-label={t("notifications.targets.enable")}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(target)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  {t("notifications.targets.edit")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setShowDeleteDialog(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("notifications.targets.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-white/5">
          <TestWebhookButton targetId={target.id} disabled={!target.isEnabled} onTest={onTest} />
        </div>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("notifications.targets.deleteConfirmTitle")}</AlertDialogTitle>
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
    </>
  );
}
