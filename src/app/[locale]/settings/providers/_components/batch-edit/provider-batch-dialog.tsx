"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type BatchUpdateProvidersParams,
  batchDeleteProviders,
  batchResetProviderCircuits,
  batchUpdateProviders,
} from "@/actions/providers";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { BatchActionMode } from "./provider-batch-actions";

export interface ProviderBatchDialogProps {
  open: boolean;
  mode: BatchActionMode;
  onOpenChange: (open: boolean) => void;
  selectedProviderIds: Set<number>;
  onSuccess?: () => void;
}

interface EditFieldState {
  isEnabledEnabled: boolean;
  isEnabled: boolean;
  priorityEnabled: boolean;
  priority: string;
  weightEnabled: boolean;
  weight: string;
  costMultiplierEnabled: boolean;
  costMultiplier: string;
  groupTagEnabled: boolean;
  groupTag: string;
}

const INITIAL_EDIT_STATE: EditFieldState = {
  isEnabledEnabled: false,
  isEnabled: true,
  priorityEnabled: false,
  priority: "",
  weightEnabled: false,
  weight: "",
  costMultiplierEnabled: false,
  costMultiplier: "",
  groupTagEnabled: false,
  groupTag: "",
};

export function ProviderBatchDialog({
  open,
  mode,
  onOpenChange,
  selectedProviderIds,
  onSuccess,
}: ProviderBatchDialogProps) {
  const t = useTranslations("settings.providers.batchEdit");
  const queryClient = useQueryClient();

  const [editState, setEditState] = useState<EditFieldState>(INITIAL_EDIT_STATE);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedCount = selectedProviderIds.size;

  const hasEnabledFields = useMemo(() => {
    if (mode !== "edit") return true;
    return (
      editState.isEnabledEnabled ||
      editState.priorityEnabled ||
      editState.weightEnabled ||
      editState.costMultiplierEnabled ||
      editState.groupTagEnabled
    );
  }, [mode, editState]);

  const resetState = useCallback(() => {
    setEditState(INITIAL_EDIT_STATE);
    setConfirmOpen(false);
    setIsSubmitting(false);
  }, []);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        resetState();
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, resetState]
  );

  const handleNext = useCallback(() => {
    if (!hasEnabledFields) {
      toast.error(t("dialog.noFieldEnabled"));
      return;
    }
    setConfirmOpen(true);
  }, [hasEnabledFields, t]);

  const handleConfirm = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const providerIds = Array.from(selectedProviderIds);

      if (mode === "edit") {
        const updates: BatchUpdateProvidersParams["updates"] = {};

        if (editState.isEnabledEnabled) {
          updates.is_enabled = editState.isEnabled;
        }
        if (editState.priorityEnabled && editState.priority.trim()) {
          const val = Number.parseInt(editState.priority, 10);
          if (!Number.isNaN(val) && val >= 0) {
            updates.priority = val;
          }
        }
        if (editState.weightEnabled && editState.weight.trim()) {
          const val = Number.parseInt(editState.weight, 10);
          if (!Number.isNaN(val) && val >= 0) {
            updates.weight = val;
          }
        }
        if (editState.costMultiplierEnabled && editState.costMultiplier.trim()) {
          const val = Number.parseFloat(editState.costMultiplier);
          if (!Number.isNaN(val) && val >= 0) {
            updates.cost_multiplier = val;
          }
        }
        if (editState.groupTagEnabled) {
          updates.group_tag = editState.groupTag.trim() || null;
        }

        const result = await batchUpdateProviders({ providerIds, updates });
        if (result.ok) {
          toast.success(t("toast.updated", { count: result.data?.updatedCount ?? 0 }));
        } else {
          toast.error(t("toast.failed", { error: result.error }));
          setIsSubmitting(false);
          return;
        }
      } else if (mode === "delete") {
        const result = await batchDeleteProviders({ providerIds });
        if (result.ok) {
          toast.success(t("toast.deleted", { count: result.data?.deletedCount ?? 0 }));
        } else {
          toast.error(t("toast.failed", { error: result.error }));
          setIsSubmitting(false);
          return;
        }
      } else if (mode === "resetCircuit") {
        const result = await batchResetProviderCircuits({ providerIds });
        if (result.ok) {
          toast.success(t("toast.circuitReset", { count: result.data?.resetCount ?? 0 }));
        } else {
          toast.error(t("toast.failed", { error: result.error }));
          setIsSubmitting(false);
          return;
        }
      }

      await queryClient.invalidateQueries({ queryKey: ["providers"] });
      handleOpenChange(false);
      onSuccess?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(t("toast.failed", { error: message }));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting,
    selectedProviderIds,
    mode,
    editState,
    queryClient,
    handleOpenChange,
    onSuccess,
    t,
  ]);

  const dialogTitle = useMemo(() => {
    switch (mode) {
      case "edit":
        return t("dialog.editTitle");
      case "delete":
        return t("dialog.deleteTitle");
      case "resetCircuit":
        return t("dialog.resetCircuitTitle");
      default:
        return "";
    }
  }, [mode, t]);

  const dialogDescription = useMemo(() => {
    switch (mode) {
      case "edit":
        return t("dialog.editDesc", { count: selectedCount });
      case "delete":
        return t("dialog.deleteDesc", { count: selectedCount });
      case "resetCircuit":
        return t("dialog.resetCircuitDesc", { count: selectedCount });
      default:
        return "";
    }
  }, [mode, selectedCount, t]);

  return (
    <>
      <Dialog open={open && !confirmOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

          {mode === "edit" && (
            <div className="space-y-4 py-4">
              <FieldToggle
                label={t("fields.isEnabled")}
                enabled={editState.isEnabledEnabled}
                onEnabledChange={(v) => setEditState((s) => ({ ...s, isEnabledEnabled: v }))}
              >
                <Switch
                  checked={editState.isEnabled}
                  onCheckedChange={(v) => setEditState((s) => ({ ...s, isEnabled: v }))}
                />
              </FieldToggle>

              <Separator />

              <FieldToggle
                label={t("fields.priority")}
                enabled={editState.priorityEnabled}
                onEnabledChange={(v) => setEditState((s) => ({ ...s, priorityEnabled: v }))}
              >
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={editState.priority}
                  onChange={(e) => setEditState((s) => ({ ...s, priority: e.target.value }))}
                  placeholder="0"
                  className="w-24"
                />
              </FieldToggle>

              <FieldToggle
                label={t("fields.weight")}
                enabled={editState.weightEnabled}
                onEnabledChange={(v) => setEditState((s) => ({ ...s, weightEnabled: v }))}
              >
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={editState.weight}
                  onChange={(e) => setEditState((s) => ({ ...s, weight: e.target.value }))}
                  placeholder="1"
                  className="w-24"
                />
              </FieldToggle>

              <FieldToggle
                label={t("fields.costMultiplier")}
                enabled={editState.costMultiplierEnabled}
                onEnabledChange={(v) => setEditState((s) => ({ ...s, costMultiplierEnabled: v }))}
              >
                <Input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={editState.costMultiplier}
                  onChange={(e) => setEditState((s) => ({ ...s, costMultiplier: e.target.value }))}
                  placeholder="1.0"
                  className="w-24"
                />
              </FieldToggle>

              <Separator />

              <FieldToggle
                label={t("fields.groupTag")}
                enabled={editState.groupTagEnabled}
                onEnabledChange={(v) => setEditState((s) => ({ ...s, groupTagEnabled: v }))}
              >
                <Input
                  type="text"
                  value={editState.groupTag}
                  onChange={(e) => setEditState((s) => ({ ...s, groupTag: e.target.value }))}
                  placeholder="tag1, tag2"
                  className="w-40"
                />
              </FieldToggle>
            </div>
          )}

          {(mode === "delete" || mode === "resetCircuit") && (
            <div className="py-4 text-sm text-muted-foreground">{dialogDescription}</div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              {t("confirm.cancel")}
            </Button>
            <Button onClick={handleNext} disabled={!hasEnabledFields}>
              {t("dialog.next")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>{dialogDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>{t("confirm.goBack")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("confirm.processing")}
                </>
              ) : (
                t("confirm.confirm")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface FieldToggleProps {
  label: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  children: React.ReactNode;
}

function FieldToggle({ label, enabled, onEnabledChange, children }: FieldToggleProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
        <Label className={enabled ? "" : "text-muted-foreground"}>{label}</Label>
      </div>
      <div className={enabled ? "" : "opacity-50 pointer-events-none"}>{children}</div>
    </div>
  );
}
