"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { type BatchUpdateKeysParams, batchUpdateKeys } from "@/actions/keys";
import { type BatchUpdateUsersParams, batchUpdateUsers } from "@/actions/users";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { BatchKeySection, type BatchKeySectionState } from "./batch-key-section";
import { BatchUserSection, type BatchUserSectionState } from "./batch-user-section";

export interface BatchEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedUserIds: Set<number>;
  selectedKeyIds: Set<number>;
  onSuccess?: () => void;
}

type ValidationMessages = {
  invalidNumber: string;
  negativeNumber: string;
};

type UserFieldLabels = {
  note: string;
  tags: string;
  rpm: string;
  limit5h: string;
  limitDaily: string;
  limitWeekly: string;
  limitMonthly: string;
};

type KeyFieldLabels = {
  providerGroup: string;
  limit5h: string;
  limitDaily: string;
  limitWeekly: string;
  limitMonthly: string;
  canLoginWebUi: string;
  keyEnabled: string;
};

const INITIAL_USER_STATE: BatchUserSectionState = {
  noteEnabled: false,
  note: "",
  tagsEnabled: false,
  tags: [],
  rpmEnabled: false,
  rpm: "",
  limit5hUsdEnabled: false,
  limit5hUsd: "",
  dailyQuotaEnabled: false,
  dailyQuota: "",
  limitWeeklyUsdEnabled: false,
  limitWeeklyUsd: "",
  limitMonthlyUsdEnabled: false,
  limitMonthlyUsd: "",
};

const INITIAL_KEY_STATE: BatchKeySectionState = {
  providerGroupEnabled: false,
  providerGroup: "",
  limit5hUsdEnabled: false,
  limit5hUsd: "",
  limitDailyUsdEnabled: false,
  limitDailyUsd: "",
  limitWeeklyUsdEnabled: false,
  limitWeeklyUsd: "",
  limitMonthlyUsdEnabled: false,
  limitMonthlyUsd: "",
  canLoginWebUiEnabled: false,
  canLoginWebUi: true,
  isEnabledEnabled: false,
  isEnabled: true,
};

function parseNumberOrNull(value: string, messages: ValidationMessages): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(messages.invalidNumber);
  }
  if (parsed < 0) {
    throw new Error(messages.negativeNumber);
  }
  return parsed;
}

function buildUserUpdates(
  state: BatchUserSectionState,
  args: { validationMessages: ValidationMessages; fieldLabels: UserFieldLabels }
): {
  updates: BatchUpdateUsersParams["updates"];
  enabledFields: string[];
} {
  const updates: BatchUpdateUsersParams["updates"] = {};
  const enabledFields: string[] = [];

  if (state.noteEnabled) {
    updates.note = state.note;
    enabledFields.push(args.fieldLabels.note);
  }
  if (state.tagsEnabled) {
    updates.tags = state.tags;
    enabledFields.push(args.fieldLabels.tags);
  }
  if (state.rpmEnabled) {
    const rpmValue = parseNumberOrNull(state.rpm, args.validationMessages);
    updates.rpm = rpmValue !== null ? Math.floor(rpmValue) : null;
    enabledFields.push(args.fieldLabels.rpm);
  }
  if (state.limit5hUsdEnabled) {
    updates.limit5hUsd = parseNumberOrNull(state.limit5hUsd, args.validationMessages);
    enabledFields.push(args.fieldLabels.limit5h);
  }
  if (state.dailyQuotaEnabled) {
    updates.dailyQuota = parseNumberOrNull(state.dailyQuota, args.validationMessages);
    enabledFields.push(args.fieldLabels.limitDaily);
  }
  if (state.limitWeeklyUsdEnabled) {
    updates.limitWeeklyUsd = parseNumberOrNull(state.limitWeeklyUsd, args.validationMessages);
    enabledFields.push(args.fieldLabels.limitWeekly);
  }
  if (state.limitMonthlyUsdEnabled) {
    updates.limitMonthlyUsd = parseNumberOrNull(state.limitMonthlyUsd, args.validationMessages);
    enabledFields.push(args.fieldLabels.limitMonthly);
  }

  return { updates, enabledFields };
}

function buildKeyUpdates(
  state: BatchKeySectionState,
  args: { validationMessages: ValidationMessages; fieldLabels: KeyFieldLabels }
): {
  updates: BatchUpdateKeysParams["updates"];
  enabledFields: string[];
} {
  const updates: BatchUpdateKeysParams["updates"] = {};
  const enabledFields: string[] = [];

  if (state.providerGroupEnabled) {
    const normalized = state.providerGroup.trim();
    updates.providerGroup = normalized ? normalized : null;
    enabledFields.push(args.fieldLabels.providerGroup);
  }
  if (state.limit5hUsdEnabled) {
    updates.limit5hUsd = parseNumberOrNull(state.limit5hUsd, args.validationMessages);
    enabledFields.push(args.fieldLabels.limit5h);
  }
  if (state.limitDailyUsdEnabled) {
    updates.limitDailyUsd = parseNumberOrNull(state.limitDailyUsd, args.validationMessages);
    enabledFields.push(args.fieldLabels.limitDaily);
  }
  if (state.limitWeeklyUsdEnabled) {
    updates.limitWeeklyUsd = parseNumberOrNull(state.limitWeeklyUsd, args.validationMessages);
    enabledFields.push(args.fieldLabels.limitWeekly);
  }
  if (state.limitMonthlyUsdEnabled) {
    updates.limitMonthlyUsd = parseNumberOrNull(state.limitMonthlyUsd, args.validationMessages);
    enabledFields.push(args.fieldLabels.limitMonthly);
  }
  if (state.canLoginWebUiEnabled) {
    updates.canLoginWebUi = state.canLoginWebUi;
    enabledFields.push(args.fieldLabels.canLoginWebUi);
  }
  if (state.isEnabledEnabled) {
    updates.isEnabled = state.isEnabled;
    enabledFields.push(args.fieldLabels.keyEnabled);
  }

  return { updates, enabledFields };
}

type PendingBatchUpdate = {
  userIds: number[];
  keyIds: number[];
  userUpdates?: BatchUpdateUsersParams["updates"];
  keyUpdates?: BatchUpdateKeysParams["updates"];
  enabledUserFields: string[];
  enabledKeyFields: string[];
};

function BatchEditDialogInner({
  onOpenChange,
  selectedUserIds,
  selectedKeyIds,
  onSuccess,
}: BatchEditDialogProps) {
  const t = useTranslations("dashboard.userManagement.batchEdit");
  const queryClient = useQueryClient();
  const [userState, setUserState] = useState<BatchUserSectionState>(INITIAL_USER_STATE);
  const [keyState, setKeyState] = useState<BatchKeySectionState>(INITIAL_KEY_STATE);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<PendingBatchUpdate | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedUsersCount = selectedUserIds.size;
  const selectedKeysCount = selectedKeyIds.size;

  const selectedUserIdList = useMemo(() => Array.from(selectedUserIds), [selectedUserIds]);
  const selectedKeyIdList = useMemo(() => Array.from(selectedKeyIds), [selectedKeyIds]);

  const validationMessages = useMemo<ValidationMessages>(
    () => ({
      invalidNumber: t("validation.invalidNumber"),
      negativeNumber: t("validation.negativeNumber"),
    }),
    [t]
  );

  const userFieldLabels = useMemo<UserFieldLabels>(
    () => ({
      note: t("user.fields.note"),
      tags: t("user.fields.tags"),
      rpm: t("user.fields.rpm"),
      limit5h: t("user.fields.limit5h"),
      limitDaily: t("user.fields.limitDaily"),
      limitWeekly: t("user.fields.limitWeekly"),
      limitMonthly: t("user.fields.limitMonthly"),
    }),
    [t]
  );

  const keyFieldLabels = useMemo<KeyFieldLabels>(
    () => ({
      providerGroup: t("key.fields.providerGroup"),
      limit5h: t("key.fields.limit5h"),
      limitDaily: t("key.fields.limitDaily"),
      limitWeekly: t("key.fields.limitWeekly"),
      limitMonthly: t("key.fields.limitMonthly"),
      canLoginWebUi: t("key.fields.canLoginWebUi"),
      keyEnabled: t("key.fields.keyEnabled"),
    }),
    [t]
  );

  useEffect(() => {
    if (confirmOpen) return;
    setPendingUpdate(null);
  }, [confirmOpen]);

  const resetForm = () => {
    setUserState(INITIAL_USER_STATE);
    setKeyState(INITIAL_KEY_STATE);
    setConfirmOpen(false);
    setPendingUpdate(null);
    setIsSubmitting(false);
  };

  const handleRequestClose = (nextOpen: boolean) => {
    if (isSubmitting) return;
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  const handlePrepareConfirm = () => {
    try {
      const { updates: userUpdates, enabledFields: enabledUserFields } = buildUserUpdates(
        userState,
        { validationMessages, fieldLabels: userFieldLabels }
      );
      const { updates: keyUpdates, enabledFields: enabledKeyFields } = buildKeyUpdates(keyState, {
        validationMessages,
        fieldLabels: keyFieldLabels,
      });

      const willUpdateUsers = selectedUsersCount > 0 && enabledUserFields.length > 0;
      const willUpdateKeys = selectedKeysCount > 0 && enabledKeyFields.length > 0;

      if (!willUpdateUsers && !willUpdateKeys) {
        toast.error(t("dialog.noFieldEnabled"));
        return;
      }

      setPendingUpdate({
        userIds: selectedUserIdList,
        keyIds: selectedKeyIdList,
        userUpdates: willUpdateUsers ? userUpdates : undefined,
        keyUpdates: willUpdateKeys ? keyUpdates : undefined,
        enabledUserFields,
        enabledKeyFields,
      });
      setConfirmOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("validation.invalidNumber");
      toast.error(message);
    }
  };

  const executeUpdate = async () => {
    if (!pendingUpdate) return;

    setIsSubmitting(true);
    try {
      const tasks: Array<Promise<{ kind: "users" | "keys"; result: any }>> = [];

      if (pendingUpdate.userUpdates && pendingUpdate.userIds.length > 0) {
        tasks.push(
          batchUpdateUsers({ userIds: pendingUpdate.userIds, updates: pendingUpdate.userUpdates })
            .then((result) => ({ kind: "users" as const, result }))
            .catch((error) => ({ kind: "users" as const, result: { ok: false, error } }))
        );
      }

      if (pendingUpdate.keyUpdates && pendingUpdate.keyIds.length > 0) {
        tasks.push(
          batchUpdateKeys({ keyIds: pendingUpdate.keyIds, updates: pendingUpdate.keyUpdates })
            .then((result) => ({ kind: "keys" as const, result }))
            .catch((error) => ({ kind: "keys" as const, result: { ok: false, error } }))
        );
      }

      if (tasks.length === 0) {
        toast.error(t("dialog.noUpdate"));
        return;
      }

      const results = await Promise.all(tasks);
      let anySuccess = false;
      let anyFailed = false;

      for (const { kind, result } of results) {
        if (result?.ok) {
          anySuccess = true;
          const updatedCount =
            typeof result.data?.updatedCount === "number"
              ? result.data.updatedCount
              : kind === "users"
                ? pendingUpdate.userIds.length
                : pendingUpdate.keyIds.length;
          toast.success(
            kind === "users"
              ? t("toast.usersUpdated", { count: updatedCount })
              : t("toast.keysUpdated", { count: updatedCount })
          );
        } else {
          anyFailed = true;
          const errorMessage =
            typeof result?.error === "string"
              ? result.error
              : result?.error instanceof Error
                ? result.error.message
                : t("toast.batchFailed");
          toast.error(
            kind === "users"
              ? t("toast.usersFailed", { error: errorMessage })
              : t("toast.keysFailed", { error: errorMessage })
          );
        }
      }

      if (anySuccess) {
        await queryClient.invalidateQueries({ queryKey: ["users"] });
      }

      // Only close dialog and clear selection when fully successful
      // On partial success (some failed), keep dialog open to let user see results
      if (anySuccess && !anyFailed) {
        onSuccess?.();
        handleRequestClose(false);
      } else {
        // Close confirm dialog, but keep main dialog open for retry/review
        setConfirmOpen(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDescription = useMemo(() => {
    if (!pendingUpdate) return null;
    const willUpdateUsers = Boolean(pendingUpdate.userUpdates && pendingUpdate.userIds.length > 0);
    const willUpdateKeys = Boolean(pendingUpdate.keyUpdates && pendingUpdate.keyIds.length > 0);
    const usersCount = willUpdateUsers ? pendingUpdate.userIds.length : 0;
    const keysCount = willUpdateKeys ? pendingUpdate.keyIds.length : 0;

    return (
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground">
          {t("confirm.description", { users: usersCount, keys: keysCount })}
        </div>
        {willUpdateUsers ? (
          <div className="text-sm">
            <div className="font-medium">{t("confirm.userFields")}</div>
            <div className="text-muted-foreground">
              {pendingUpdate.enabledUserFields.join(", ")}
            </div>
          </div>
        ) : null}
        {willUpdateKeys ? (
          <div className="text-sm">
            <div className="font-medium">{t("confirm.keyFields")}</div>
            <div className="text-muted-foreground">{pendingUpdate.enabledKeyFields.join(", ")}</div>
          </div>
        ) : null}
      </div>
    );
  }, [pendingUpdate, t]);

  return (
    <>
      <DialogContent
        className="max-w-3xl"
        showCloseButton={!isSubmitting}
        onEscapeKeyDown={(e) => {
          if (isSubmitting) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (isSubmitting) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("dialog.title")}</DialogTitle>
          <DialogDescription>
            {t("dialog.description", { users: selectedUsersCount, keys: selectedKeysCount })}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto space-y-6 pr-1">
          {selectedUsersCount > 0 ? (
            <BatchUserSection
              affectedUsersCount={selectedUsersCount}
              state={userState}
              onChange={(patch) => setUserState((prev) => ({ ...prev, ...patch }))}
              translations={{
                title: t("user.title"),
                affected: t.raw("user.affected") as string,
                enableFieldAria: t.raw("user.enableFieldAria") as string,
                fields: userFieldLabels,
                placeholders: {
                  emptyToClear: t("user.placeholders.emptyToClear"),
                  tagsPlaceholder: t("user.placeholders.tagsPlaceholder"),
                  emptyNoLimit: t("user.placeholders.emptyNoLimit"),
                },
              }}
            />
          ) : null}

          {selectedUsersCount > 0 && selectedKeysCount > 0 ? <Separator /> : null}

          {selectedKeysCount > 0 ? (
            <BatchKeySection
              affectedKeysCount={selectedKeysCount}
              state={keyState}
              onChange={(patch) => setKeyState((prev) => ({ ...prev, ...patch }))}
              translations={{
                title: t("key.title"),
                affected: t.raw("key.affected") as string,
                enableFieldAria: t.raw("user.enableFieldAria") as string,
                fields: keyFieldLabels,
                placeholders: {
                  groupPlaceholder: t("key.placeholders.groupPlaceholder"),
                  emptyNoLimit: t("key.placeholders.emptyNoLimit"),
                },
                targetValue: t("key.targetValue"),
              }}
            />
          ) : null}

          {selectedUsersCount === 0 && selectedKeysCount === 0 ? (
            <div className="rounded-md border p-4 text-sm text-muted-foreground">
              {t("dialog.noSelection")}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleRequestClose(false)}
            disabled={isSubmitting}
          >
            {t("dialog.cancel")}
          </Button>
          <Button type="button" onClick={handlePrepareConfirm} disabled={isSubmitting}>
            {t("dialog.next")}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(next) => {
          if (isSubmitting) return;
          setConfirmOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirm.title")}</AlertDialogTitle>
            <AlertDialogDescription asChild>{confirmDescription ?? <div />}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>{t("confirm.goBack")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void executeUpdate();
              }}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("confirm.updating")}
                </>
              ) : (
                t("confirm.update")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function BatchEditDialog(props: BatchEditDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <BatchEditDialogInner {...props} /> : null}
    </Dialog>
  );
}
