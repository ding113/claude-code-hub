"use client";

import { Loader2, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface DangerZoneProps {
  userId: number;
  userName: string;
  isEnabled: boolean;
  onEnable: () => Promise<void>;
  onDisable: () => Promise<void>;
  onDelete: () => Promise<void>;
  /**
   * i18n strings passed from parent.
   * Expected keys (optional):
   * - title, description
   * - enable.title, enable.description, enable.trigger, enable.confirm
   * - disable.title, disable.description, disable.trigger, disable.confirm
   * - delete.title, delete.description, delete.trigger, delete.confirm
   * - delete.confirmHint (e.g. "Type {name} to confirm")
   * - actions.cancel
   * - errors.enableFailed, errors.disableFailed, errors.deleteFailed
   */
  translations: Record<string, unknown>;
}

function getTranslation(translations: Record<string, unknown>, path: string, fallback: string) {
  const value = path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, translations);
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function DangerZone({
  userId,
  userName,
  isEnabled,
  onEnable,
  onDisable,
  onDelete,
  translations,
}: DangerZoneProps) {
  const [enableOpen, setEnableOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);
  const [isDisabling, setIsDisabling] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const [enableError, setEnableError] = useState<string | null>(null);
  const [disableError, setDisableError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const canDelete = useMemo(
    () => deleteConfirmText.trim() === userName,
    [deleteConfirmText, userName]
  );

  const handleEnable = async () => {
    setEnableError(null);
    setIsEnabling(true);
    try {
      await onEnable();
      setEnableOpen(false);
    } catch (err) {
      console.error("启用用户失败:", { userId, err });
      setEnableError(getTranslation(translations, "errors.enableFailed", "操作失败，请稍后重试"));
    } finally {
      setIsEnabling(false);
    }
  };

  const handleDisable = async () => {
    setDisableError(null);
    setIsDisabling(true);
    try {
      await onDisable();
      setDisableOpen(false);
    } catch (err) {
      console.error("禁用用户失败:", { userId, err });
      setDisableError(getTranslation(translations, "errors.disableFailed", "操作失败，请稍后重试"));
    } finally {
      setIsDisabling(false);
    }
  };

  const handleDelete = async () => {
    setDeleteError(null);
    setIsDeleting(true);
    try {
      await onDelete();
      setDeleteOpen(false);
    } catch (err) {
      console.error("删除用户失败:", { userId, err });
      setDeleteError(getTranslation(translations, "errors.deleteFailed", "操作失败，请稍后重试"));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <header className="space-y-1">
        <h3 className="text-sm font-medium text-destructive">
          {getTranslation(translations, "title", "危险操作")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {getTranslation(translations, "description", "以下操作不可逆，请谨慎执行")}
        </p>
      </header>

      <div className="mt-4 grid gap-3">
        {/* Enable/Disable user - conditional rendering based on current state */}
        {isEnabled ? (
          /* Disable user (when currently enabled) */
          <div className="flex flex-col gap-3 rounded-md border border-destructive/20 bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="text-sm font-medium">
                {getTranslation(translations, "disable.title", "禁用用户")}
              </div>
              <div className="text-xs text-muted-foreground">
                {getTranslation(
                  translations,
                  "disable.description",
                  "禁用后该用户及其密钥将无法继续使用"
                )}
              </div>
            </div>

            <AlertDialog open={disableOpen} onOpenChange={setDisableOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10"
                >
                  <ShieldOff className="h-4 w-4" />
                  {getTranslation(translations, "disable.trigger", "禁用")}
                </Button>
              </AlertDialogTrigger>

              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {getTranslation(translations, "disable.title", "禁用用户")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {getTranslation(
                      translations,
                      "disable.confirmDescription",
                      `确认要禁用用户 "${userName}" 吗？`
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>

                {disableError && <p className="text-sm text-destructive">{disableError}</p>}

                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDisabling}>
                    {getTranslation(translations, "actions.cancel", "取消")}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      handleDisable();
                    }}
                    disabled={isDisabling}
                    className={cn(buttonVariants({ variant: "destructive" }))}
                  >
                    {isDisabling ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {getTranslation(translations, "disable.loading", "处理中...")}
                      </>
                    ) : (
                      getTranslation(translations, "disable.confirm", "确认禁用")
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : (
          /* Enable user (when currently disabled) */
          <div className="flex flex-col gap-3 rounded-md border border-green-500/20 bg-green-500/5 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="text-sm font-medium text-green-700 dark:text-green-400">
                {getTranslation(translations, "enable.title", "启用用户")}
              </div>
              <div className="text-xs text-muted-foreground">
                {getTranslation(
                  translations,
                  "enable.description",
                  "启用后该用户及其密钥将恢复正常使用"
                )}
              </div>
            </div>

            <AlertDialog open={enableOpen} onOpenChange={setEnableOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="border-green-500/40 text-green-700 hover:bg-green-500/10 dark:text-green-400"
                >
                  <ShieldCheck className="h-4 w-4" />
                  {getTranslation(translations, "enable.trigger", "启用")}
                </Button>
              </AlertDialogTrigger>

              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {getTranslation(translations, "enable.title", "启用用户")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {getTranslation(
                      translations,
                      "enable.confirmDescription",
                      `确认要启用用户 "${userName}" 吗？`
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>

                {enableError && <p className="text-sm text-destructive">{enableError}</p>}

                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isEnabling}>
                    {getTranslation(translations, "actions.cancel", "取消")}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      handleEnable();
                    }}
                    disabled={isEnabling}
                    className="bg-green-600 text-white hover:bg-green-700"
                  >
                    {isEnabling ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {getTranslation(translations, "enable.loading", "处理中...")}
                      </>
                    ) : (
                      getTranslation(translations, "enable.confirm", "确认启用")
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}

        {/* Delete user */}
        <div className="flex flex-col gap-3 rounded-md border border-destructive/20 bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium">
              {getTranslation(translations, "delete.title", "删除用户")}
            </div>
            <div className="text-xs text-muted-foreground">
              {getTranslation(
                translations,
                "delete.description",
                "将删除该用户的所有关联数据，此操作无法撤销"
              )}
            </div>
          </div>

          <AlertDialog
            open={deleteOpen}
            onOpenChange={(next) => {
              setDeleteOpen(next);
              if (!next) {
                // Reset the second confirmation input when closed.
                setDeleteConfirmText("");
                setDeleteError(null);
              }
            }}
          >
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive">
                <Trash2 className="h-4 w-4" />
                {getTranslation(translations, "delete.trigger", "删除")}
              </Button>
            </AlertDialogTrigger>

            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {getTranslation(translations, "delete.title", "删除用户")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {getTranslation(
                    translations,
                    "delete.confirmDescription",
                    `此操作将删除用户 "${userName}" 的所有关联数据，且无法撤销。`
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>

              {/* Second confirmation: type exact user name. */}
              <div className="grid gap-2">
                <Label htmlFor="delete-confirm-input">
                  {getTranslation(translations, "delete.confirmLabel", "二次确认")}
                </Label>
                <Input
                  id="delete-confirm-input"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={getTranslation(
                    translations,
                    "delete.confirmHint",
                    `请输入 "${userName}" 以确认删除`
                  )}
                  autoComplete="off"
                />
              </div>

              {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}

              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting}>
                  {getTranslation(translations, "actions.cancel", "取消")}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    handleDelete();
                  }}
                  disabled={isDeleting || !canDelete}
                  className={cn(buttonVariants({ variant: "destructive" }))}
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {getTranslation(translations, "delete.loading", "删除中...")}
                    </>
                  ) : (
                    getTranslation(translations, "delete.confirm", "确认删除")
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </section>
  );
}
