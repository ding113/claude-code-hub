"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw, Trash2, UserCog } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { z } from "zod";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  editUser,
  removeUser,
  resetUserAllStatistics,
  resetUserLimitsOnly,
  toggleUserEnabled,
} from "@/lib/api-client/v1/actions/users";
import { useZodForm } from "@/lib/hooks/use-zod-form";
import { cn } from "@/lib/utils";
import { UpdateUserSchema } from "@/lib/validation/schemas";
import type { UserDisplay } from "@/types/user";
import { resetUser5hLimitOnly } from "./actions/reset-user-5h-limit";
import { DangerZone } from "./forms/danger-zone";
import { UserEditSection } from "./forms/user-edit-section";
import { useModelSuggestions } from "./hooks/use-model-suggestions";
import { useUserTranslations } from "./hooks/use-user-translations";
import { getFirstErrorMessage } from "./utils/form-utils";
import { normalizeProviderGroup } from "./utils/provider-group";

export interface EditUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserDisplay;
  onSuccess?: () => void;
}

const EditUserSchema = UpdateUserSchema.extend({
  name: z.string().min(1).max(64),
  providerGroup: z.string().max(200).nullable().optional(),
  allowedClients: z.array(z.string().max(64)).max(50).optional().default([]),
  blockedClients: z.array(z.string().max(64)).max(50).optional().default([]),
  allowedModels: z.array(z.string().max(64)).max(50).optional().default([]),
  dailyQuota: z.number().nullable().optional(),
});

type EditUserValues = z.infer<typeof EditUserSchema>;

function buildDefaultValues(user: UserDisplay): EditUserValues {
  return {
    name: user.name || "",
    note: user.note || "",
    tags: user.tags || [],
    expiresAt: user.expiresAt ?? undefined,
    providerGroup: normalizeProviderGroup(user.providerGroup),
    rpm: user.rpm ?? 0,
    limit5hUsd: user.limit5hUsd ?? null,
    limit5hResetMode: user.limit5hResetMode ?? "rolling",
    dailyQuota: user.dailyQuota ?? null,
    limitWeeklyUsd: user.limitWeeklyUsd ?? null,
    limitMonthlyUsd: user.limitMonthlyUsd ?? null,
    limitTotalUsd: user.limitTotalUsd ?? null,
    limitConcurrentSessions: user.limitConcurrentSessions ?? null,
    dailyResetMode: user.dailyResetMode ?? "fixed",
    dailyResetTime: user.dailyResetTime ?? "00:00",
    allowedClients: user.allowedClients || [],
    blockedClients: user.blockedClients || [],
    allowedModels: user.allowedModels || [],
  };
}

function EditUserDialogInner({ onOpenChange, user, onSuccess }: EditUserDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("dashboard.userManagement");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();
  const [isResettingAll, setIsResettingAll] = useState(false);
  const [resetAllDialogOpen, setResetAllDialogOpen] = useState(false);
  const [isResetting5h, setIsResetting5h] = useState(false);
  const [reset5hDialogOpen, setReset5hDialogOpen] = useState(false);
  const [isResettingLimits, setIsResettingLimits] = useState(false);
  const [resetLimitsDialogOpen, setResetLimitsDialogOpen] = useState(false);

  // Always show providerGroup field in edit mode
  const userEditTranslations = useUserTranslations({ showProviderGroup: true });

  const defaultValues = useMemo(() => buildDefaultValues(user), [user]);

  const form = useZodForm({
    schema: EditUserSchema,
    defaultValues,
    onSubmit: async (data) => {
      startTransition(async () => {
        try {
          const userRes = await editUser(user.id, {
            name: data.name,
            note: data.note,
            tags: data.tags,
            expiresAt: data.expiresAt ?? null,
            providerGroup: normalizeProviderGroup(data.providerGroup),
            rpm: data.rpm,
            limit5hUsd: data.limit5hUsd,
            limit5hResetMode: data.limit5hResetMode,
            dailyQuota: data.dailyQuota,
            limitWeeklyUsd: data.limitWeeklyUsd,
            limitMonthlyUsd: data.limitMonthlyUsd,
            limitTotalUsd: data.limitTotalUsd,
            limitConcurrentSessions: data.limitConcurrentSessions,
            dailyResetMode: data.dailyResetMode,
            dailyResetTime: data.dailyResetTime,
            allowedClients: data.allowedClients,
            blockedClients: data.blockedClients,
            allowedModels: data.allowedModels,
          });
          if (!userRes.ok) {
            toast.error(userRes.error || t("editDialog.saveFailed"));
            return;
          }

          toast.success(t("editDialog.saveSuccess"));
          onSuccess?.();
          onOpenChange(false);
          queryClient.invalidateQueries({ queryKey: ["users"] });
          queryClient.invalidateQueries({ queryKey: ["userKeyGroups"] });
          queryClient.invalidateQueries({ queryKey: ["userTags"] });
          router.refresh();
        } catch (error) {
          console.error("[EditUserDialog] submit failed", error);
          toast.error(t("editDialog.saveFailed"));
        }
      });
    },
  });

  const errorMessage = useMemo(() => getFirstErrorMessage(form.errors), [form.errors]);

  const currentUserDraft = form.values || defaultValues;

  // Model suggestions based on current providerGroup value
  const modelSuggestions = useModelSuggestions(currentUserDraft.providerGroup);

  const handleUserChange = (field: string | Record<string, any>, value?: any) => {
    const prev = form.values || defaultValues;
    const next = { ...prev } as EditUserValues;

    if (typeof field === "object") {
      Object.entries(field).forEach(([key, val]) => {
        const mappedField = key === "description" ? "note" : key;
        (next as any)[mappedField] = mappedField === "expiresAt" ? (val ?? undefined) : val;
      });
    } else {
      const mappedField = field === "description" ? "note" : field;
      if (mappedField === "expiresAt") {
        (next as any)[mappedField] = value ?? undefined;
      } else {
        (next as any)[mappedField] = value;
      }
    }
    // Set all changed fields
    Object.keys(next).forEach((key) => {
      if ((next as any)[key] !== (prev as any)[key]) {
        form.setValue(key as keyof EditUserValues, (next as any)[key]);
      }
    });
  };

  const handleDisableUser = async () => {
    try {
      const res = await toggleUserEnabled(user.id, false);
      if (!res.ok) {
        toast.error(res.error || t("editDialog.operationFailed"));
        return;
      }
      toast.success(t("editDialog.userDisabled"));
      onSuccess?.();
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["userKeyGroups"] });
      queryClient.invalidateQueries({ queryKey: ["userTags"] });
      router.refresh();
    } catch (error) {
      console.error("[EditUserDialog] disable user failed", error);
      toast.error(t("editDialog.operationFailed"));
    }
  };

  const handleEnableUser = async () => {
    try {
      const res = await toggleUserEnabled(user.id, true);
      if (!res.ok) {
        toast.error(res.error || t("editDialog.operationFailed"));
        return;
      }
      toast.success(t("editDialog.userEnabled"));
      onSuccess?.();
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["userKeyGroups"] });
      queryClient.invalidateQueries({ queryKey: ["userTags"] });
      router.refresh();
    } catch (error) {
      console.error("[EditUserDialog] enable user failed", error);
      toast.error(t("editDialog.operationFailed"));
    }
  };

  const handleDeleteUser = async () => {
    const res = await removeUser(user.id);
    if (!res.ok) {
      throw new Error(res.error || t("editDialog.deleteFailed"));
    }
    toast.success(t("editDialog.userDeleted"));
    onSuccess?.();
    onOpenChange(false);
    queryClient.invalidateQueries({ queryKey: ["users"] });
    queryClient.invalidateQueries({ queryKey: ["userKeyGroups"] });
    queryClient.invalidateQueries({ queryKey: ["userTags"] });
    router.refresh();
  };

  const handleResetAllStatistics = async () => {
    setIsResettingAll(true);
    try {
      const res = await resetUserAllStatistics(user.id);
      if (!res.ok) {
        toast.error(res.error || t("editDialog.resetData.error"));
        return;
      }
      toast.success(t("editDialog.resetData.success"));
      setResetAllDialogOpen(false);

      // Full page reload to ensure all cached data is refreshed
      window.location.reload();
    } catch (error) {
      console.error("[EditUserDialog] reset all statistics failed", error);
      toast.error(t("editDialog.resetData.error"));
    } finally {
      setIsResettingAll(false);
    }
  };

  const handleResetLimitsOnly = async () => {
    setIsResettingLimits(true);
    try {
      const res = await resetUserLimitsOnly(user.id);
      if (!res.ok) {
        toast.error(res.error || t("editDialog.resetLimits.error"));
        return;
      }
      toast.success(t("editDialog.resetLimits.success"));
      setResetLimitsDialogOpen(false);
      window.location.reload();
    } catch (error) {
      console.error("[EditUserDialog] reset limits only failed", error);
      toast.error(t("editDialog.resetLimits.error"));
    } finally {
      setIsResettingLimits(false);
    }
  };

  const handleReset5hLimitOnly = async () => {
    setIsResetting5h(true);
    try {
      const res = await resetUser5hLimitOnly(user.id);
      if (!res.ok) {
        toast.error(res.error || t("editDialog.reset5h.error"));
        return;
      }

      toast.success(
        res.data?.resetMode === "fixed"
          ? t("editDialog.reset5h.successFixed")
          : t("editDialog.reset5h.successRolling")
      );
      setReset5hDialogOpen(false);
      window.location.reload();
    } catch (error) {
      console.error("[EditUserDialog] reset 5h limit failed", error);
      toast.error(t("editDialog.reset5h.error"));
    } finally {
      setIsResetting5h(false);
    }
  };

  const canReset5h = (user.limit5hUsd ?? null) !== null && (user.limit5hUsd ?? 0) > 0;
  const reset5hMode = user.limit5hResetMode ?? "rolling";

  return (
    <DialogContent className="w-full max-w-[95vw] sm:max-w-[85vw] md:max-w-[70vw] lg:max-w-3xl max-h-[var(--cch-viewport-height-90,90vh)] p-0 flex flex-col overflow-hidden">
      <form onSubmit={form.handleSubmit} className="flex flex-1 min-h-0 flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
          <div className="flex items-center gap-2">
            <UserCog className="h-5 w-5 text-primary" aria-hidden="true" />
            <DialogTitle>{t("editDialog.title")}</DialogTitle>
          </div>
          <DialogDescription className="sr-only">{t("editDialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-6 pb-6 space-y-8">
          <UserEditSection
            user={{
              id: user.id,
              name: currentUserDraft.name || "",
              description: currentUserDraft.note || "",
              tags: currentUserDraft.tags || [],
              expiresAt: currentUserDraft.expiresAt ?? null,
              providerGroup: normalizeProviderGroup(currentUserDraft.providerGroup),
              rpm: currentUserDraft.rpm ?? 0,
              limit5hUsd: currentUserDraft.limit5hUsd ?? null,
              limit5hResetMode: currentUserDraft.limit5hResetMode ?? "rolling",
              dailyQuota: currentUserDraft.dailyQuota ?? null,
              limitWeeklyUsd: currentUserDraft.limitWeeklyUsd ?? null,
              limitMonthlyUsd: currentUserDraft.limitMonthlyUsd ?? null,
              limitTotalUsd: currentUserDraft.limitTotalUsd ?? null,
              limitConcurrentSessions: currentUserDraft.limitConcurrentSessions ?? null,
              dailyResetMode: currentUserDraft.dailyResetMode ?? "fixed",
              dailyResetTime: currentUserDraft.dailyResetTime ?? "00:00",
              allowedClients: currentUserDraft.allowedClients || [],
              blockedClients: currentUserDraft.blockedClients || [],
              allowedModels: currentUserDraft.allowedModels || [],
            }}
            isEnabled={user.isEnabled}
            onToggleEnabled={async () => {
              if (user.isEnabled) {
                await handleDisableUser();
              } else {
                await handleEnableUser();
              }
            }}
            showProviderGroup
            onChange={handleUserChange}
            translations={userEditTranslations}
            modelSuggestions={modelSuggestions}
          />

          {/* Reset Data Section - Admin Only */}
          <section className="rounded-lg border border-muted p-4 space-y-3">
            <h3 className="text-sm font-medium">{t("editDialog.resetSection.title")}</h3>

            {/* Reset Limits Only - Less destructive (amber) */}
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <h4 className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    {t("editDialog.resetLimits.title")}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {t("editDialog.resetLimits.description")}
                  </p>
                  {!canReset5h && (
                    <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
                      {t("editDialog.reset5h.unavailableReason")}
                    </p>
                  )}
                  {user.costResetAt && (
                    <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
                      {t("editDialog.resetLimits.lastResetAt", {
                        date: new Intl.DateTimeFormat(locale, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(user.costResetAt)),
                      })}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <AlertDialog open={reset5hDialogOpen} onOpenChange={setReset5hDialogOpen}>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!canReset5h}
                        className="border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/10"
                      >
                        <RotateCcw className="h-4 w-4" />
                        {t("editDialog.reset5h.button")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("editDialog.reset5h.confirmTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t(
                            reset5hMode === "fixed"
                              ? "editDialog.reset5h.confirmDescriptionFixed"
                              : "editDialog.reset5h.confirmDescriptionRolling"
                          )}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={isResetting5h}>
                          {tCommon("cancel")}
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={(e) => {
                            e.preventDefault();
                            handleReset5hLimitOnly();
                          }}
                          disabled={isResetting5h}
                          className="bg-amber-600 text-white hover:bg-amber-700"
                        >
                          {isResetting5h ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              {t("editDialog.reset5h.loading")}
                            </>
                          ) : (
                            t("editDialog.reset5h.confirm")
                          )}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

                  <AlertDialog open={resetLimitsDialogOpen} onOpenChange={setResetLimitsDialogOpen}>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/10"
                      >
                        <RotateCcw className="h-4 w-4" />
                        {t("editDialog.resetLimits.button")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t("editDialog.resetLimits.confirmTitle")}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("editDialog.resetLimits.confirmDescription")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={isResettingLimits}>
                          {tCommon("cancel")}
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={(e) => {
                            e.preventDefault();
                            handleResetLimitsOnly();
                          }}
                          disabled={isResettingLimits}
                          className="bg-amber-600 text-white hover:bg-amber-700"
                        >
                          {isResettingLimits ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              {t("editDialog.resetLimits.loading")}
                            </>
                          ) : (
                            t("editDialog.resetLimits.confirm")
                          )}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>

            {/* Reset All Statistics - Destructive (red) */}
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <h4 className="text-sm font-medium text-destructive">
                    {t("editDialog.resetData.title")}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {t("editDialog.resetData.description")}
                  </p>
                </div>

                <AlertDialog open={resetAllDialogOpen} onOpenChange={setResetAllDialogOpen}>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive">
                      <Trash2 className="h-4 w-4" />
                      {t("editDialog.resetData.button")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("editDialog.resetData.confirmTitle")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("editDialog.resetData.confirmDescription")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={isResettingAll}>
                        {tCommon("cancel")}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(e) => {
                          e.preventDefault();
                          handleResetAllStatistics();
                        }}
                        disabled={isResettingAll}
                        className={cn(buttonVariants({ variant: "destructive" }))}
                      >
                        {isResettingAll ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t("editDialog.resetData.loading")}
                          </>
                        ) : (
                          t("editDialog.resetData.confirm")
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </section>

          <DangerZone
            userId={user.id}
            userName={user.name}
            onDelete={handleDeleteUser}
            translations={t.raw("dangerZone") as Record<string, unknown>}
          />
        </div>

        {errorMessage && <div className="px-6 pb-2 text-sm text-destructive">{errorMessage}</div>}

        <DialogFooter className="px-6 pb-6 flex-shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isPending ? t("editDialog.saving") : tCommon("save")}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

export function EditUserDialog(props: EditUserDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <EditUserDialogInner key={props.user.id} {...props} /> : null}
    </Dialog>
  );
}
