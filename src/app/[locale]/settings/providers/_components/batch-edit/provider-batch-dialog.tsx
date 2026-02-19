"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  applyProviderBatchPatch,
  batchDeleteProviders,
  batchResetProviderCircuits,
  type PreviewProviderBatchPatchResult,
  previewProviderBatchPatch,
  undoProviderDelete,
  undoProviderPatch,
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
import { PROVIDER_BATCH_PATCH_ERROR_CODES } from "@/lib/provider-batch-patch-error-codes";
import type { ProviderDisplay } from "@/types/provider";
import { FormTabNav } from "../forms/provider-form/components/form-tab-nav";
import {
  ProviderFormProvider,
  useProviderForm,
} from "../forms/provider-form/provider-form-context";
import { BasicInfoSection } from "../forms/provider-form/sections/basic-info-section";
import { LimitsSection } from "../forms/provider-form/sections/limits-section";
import { NetworkSection } from "../forms/provider-form/sections/network-section";
import { RoutingSection } from "../forms/provider-form/sections/routing-section";
import { TestingSection } from "../forms/provider-form/sections/testing-section";
import { buildPatchDraftFromFormState } from "./build-patch-draft";
import type { BatchActionMode } from "./provider-batch-actions";
import { ProviderBatchPreviewStep } from "./provider-batch-preview-step";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ProviderBatchDialogProps {
  open: boolean;
  mode: BatchActionMode;
  onOpenChange: (open: boolean) => void;
  selectedProviderIds: Set<number>;
  providers: ProviderDisplay[];
  onSuccess?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProviderBatchDialog({
  open,
  mode,
  onOpenChange,
  selectedProviderIds,
  providers,
  onSuccess,
}: ProviderBatchDialogProps) {
  // For edit mode: delegate to form-based dialog
  if (mode === "edit") {
    return (
      <BatchEditDialog
        open={open}
        onOpenChange={onOpenChange}
        selectedProviderIds={selectedProviderIds}
        providers={providers}
        onSuccess={onSuccess}
      />
    );
  }

  // For delete/resetCircuit: use AlertDialog
  return (
    <BatchConfirmDialog
      open={open}
      mode={mode}
      onOpenChange={onOpenChange}
      selectedProviderIds={selectedProviderIds}
      providers={providers}
      onSuccess={onSuccess}
    />
  );
}

// ---------------------------------------------------------------------------
// BatchEditDialog: Uses ProviderFormProvider mode="batch"
// ---------------------------------------------------------------------------

function BatchEditDialog({
  open,
  onOpenChange,
  selectedProviderIds,
  providers,
  onSuccess,
}: Omit<ProviderBatchDialogProps, "mode">) {
  const selectedCount = selectedProviderIds.size;

  const affectedProviders = useMemo(() => {
    return providers.filter((p) => selectedProviderIds.has(p.id));
  }, [providers, selectedProviderIds]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <ProviderFormProvider
          mode="batch"
          enableMultiProviderTypes={false}
          groupSuggestions={[]}
          batchProviders={affectedProviders}
        >
          <BatchEditDialogContent
            selectedProviderIds={selectedProviderIds}
            selectedCount={selectedCount}
            onOpenChange={onOpenChange}
            onSuccess={onSuccess}
          />
        </ProviderFormProvider>
      </DialogContent>
    </Dialog>
  );
}

// Inner component that can use useProviderForm()
type DialogStep = "edit" | "preview";

function BatchEditDialogContent({
  selectedProviderIds,
  selectedCount,
  onOpenChange,
  onSuccess,
}: {
  selectedProviderIds: Set<number>;
  selectedCount: number;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}) {
  const t = useTranslations("settings.providers.batchEdit");
  const queryClient = useQueryClient();
  const { state, dispatch, dirtyFields } = useProviderForm();

  const [step, setStep] = useState<DialogStep>("edit");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewResult, setPreviewResult] = useState<PreviewProviderBatchPatchResult | null>(null);
  const [excludedProviderIds, setExcludedProviderIds] = useState<Set<number>>(new Set());

  const hasChanges = dirtyFields.size > 0;

  const handleExcludeToggle = useCallback((providerId: number) => {
    setExcludedProviderIds((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  }, []);

  const handleNext = useCallback(async () => {
    if (!hasChanges) return;

    setIsLoadingPreview(true);
    setStep("preview");

    try {
      const providerIds = Array.from(selectedProviderIds);
      const patch = buildPatchDraftFromFormState(state, dirtyFields);
      const result = await previewProviderBatchPatch({ providerIds, patch });

      if (result.ok) {
        setPreviewResult(result.data);
      } else {
        toast.error(t("toast.previewFailed", { error: result.error }));
        setStep("edit");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t("toast.unknownError");
      toast.error(t("toast.previewFailed", { error: message }));
      setStep("edit");
    } finally {
      setIsLoadingPreview(false);
    }
  }, [hasChanges, selectedProviderIds, state, dirtyFields, t]);

  const handleBackToEdit = useCallback(() => {
    setStep("edit");
    setPreviewResult(null);
    setExcludedProviderIds(new Set());
  }, []);

  const handleApply = useCallback(async () => {
    if (isSubmitting || !previewResult) return;
    setIsSubmitting(true);

    try {
      const providerIds = Array.from(selectedProviderIds);
      const patch = buildPatchDraftFromFormState(state, dirtyFields);
      const result = await applyProviderBatchPatch({
        previewToken: previewResult.previewToken,
        previewRevision: previewResult.previewRevision,
        providerIds,
        patch,
        excludeProviderIds: Array.from(excludedProviderIds),
      });

      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: ["providers"] });
        onOpenChange(false);
        onSuccess?.();

        const undoToken = result.data.undoToken;
        const operationId = result.data.operationId;
        toast.success(t("toast.updated", { count: result.data.updatedCount }), {
          duration: 10000,
          action: {
            label: t("toast.undo"),
            onClick: async () => {
              try {
                const undoResult = await undoProviderPatch({ undoToken, operationId });
                if (undoResult.ok) {
                  toast.success(t("toast.undoSuccess", { count: undoResult.data.revertedCount }));
                  queryClient.invalidateQueries({ queryKey: ["providers"] });
                } else {
                  toast.error(t("toast.undoFailed", { error: undoResult.error }));
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : t("toast.unknownError");
                toast.error(t("toast.undoFailed", { error: msg }));
              }
            },
          },
        });
      } else {
        toast.error(t("toast.failed", { error: result.error }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t("toast.unknownError");
      toast.error(t("toast.failed", { error: message }));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting,
    previewResult,
    selectedProviderIds,
    state,
    dirtyFields,
    excludedProviderIds,
    queryClient,
    onOpenChange,
    onSuccess,
    t,
  ]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{step === "preview" ? t("preview.title") : t("dialog.editTitle")}</DialogTitle>
        <DialogDescription>
          {step === "preview"
            ? t("preview.description", { count: selectedCount })
            : t("dialog.editDesc", { count: selectedCount })}
        </DialogDescription>
      </DialogHeader>

      {step === "edit" && (
        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          <FormTabNav
            activeTab={state.ui.activeTab}
            onTabChange={(tab) => dispatch({ type: "SET_ACTIVE_TAB", payload: tab })}
            layout="horizontal"
          />
          <div className="flex-1 overflow-y-auto pr-1">
            {state.ui.activeTab === "basic" && <BasicInfoSection />}
            {state.ui.activeTab === "routing" && <RoutingSection />}
            {state.ui.activeTab === "limits" && <LimitsSection />}
            {state.ui.activeTab === "network" && <NetworkSection />}
            {state.ui.activeTab === "testing" && <TestingSection />}
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="flex-1 overflow-y-auto py-4">
          <ProviderBatchPreviewStep
            rows={previewResult?.rows ?? []}
            summary={previewResult?.summary ?? { providerCount: 0, fieldCount: 0, skipCount: 0 }}
            excludedProviderIds={excludedProviderIds}
            onExcludeToggle={handleExcludeToggle}
            isLoading={isLoadingPreview}
          />
        </div>
      )}

      <DialogFooter>
        {step === "preview" ? (
          <>
            <Button variant="outline" onClick={handleBackToEdit}>
              {t("preview.back")}
            </Button>
            <Button
              onClick={handleApply}
              disabled={
                isSubmitting ||
                isLoadingPreview ||
                !previewResult ||
                previewResult.summary.fieldCount === 0
              }
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("confirm.processing")}
                </>
              ) : (
                t("preview.apply")
              )}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("confirm.cancel")}
            </Button>
            <Button onClick={handleNext} disabled={!hasChanges}>
              {t("dialog.next")}
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// BatchConfirmDialog: Delete / Reset Circuit (unchanged)
// ---------------------------------------------------------------------------

function BatchConfirmDialog({
  open,
  mode,
  onOpenChange,
  selectedProviderIds,
  providers: _providers,
  onSuccess,
}: ProviderBatchDialogProps) {
  const t = useTranslations("settings.providers.batchEdit");
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedCount = selectedProviderIds.size;

  const dialogTitle = useMemo(() => {
    switch (mode) {
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
      case "delete":
        return t("dialog.deleteDesc", { count: selectedCount });
      case "resetCircuit":
        return t("dialog.resetCircuitDesc", { count: selectedCount });
      default:
        return "";
    }
  }, [mode, selectedCount, t]);

  const handleConfirm = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const providerIds = Array.from(selectedProviderIds);

      if (mode === "delete") {
        const result = await batchDeleteProviders({ providerIds });
        if (result.ok) {
          const deletedCount = result.data.deletedCount;
          const undoToken = result.data.undoToken;
          const operationId = result.data.operationId;

          toast.success(t("undo.batchDeleteSuccess", { count: deletedCount }), {
            duration: 10000,
            action: {
              label: t("undo.button"),
              onClick: async () => {
                try {
                  const undoResult = await undoProviderDelete({ undoToken, operationId });
                  if (undoResult.ok) {
                    toast.success(
                      t("undo.batchDeleteUndone", { count: undoResult.data.restoredCount })
                    );
                    await queryClient.invalidateQueries({ queryKey: ["providers"] });
                  } else if (
                    undoResult.errorCode === PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_EXPIRED
                  ) {
                    toast.error(t("undo.expired"));
                  } else {
                    toast.error(t("undo.failed"));
                  }
                } catch {
                  toast.error(t("undo.failed"));
                }
              },
            },
          });
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
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("toast.unknownError");
      toast.error(t("toast.failed", { error: message }));
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, selectedProviderIds, mode, queryClient, onOpenChange, onSuccess, t]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{dialogTitle}</AlertDialogTitle>
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
  );
}
