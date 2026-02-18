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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { AnthropicAdaptiveThinkingConfig, ProviderDisplay } from "@/types/provider";
import { AdaptiveThinkingEditor } from "../adaptive-thinking-editor";
import { ThinkingBudgetEditor } from "../thinking-budget-editor";
import type { BatchActionMode } from "./provider-batch-actions";

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
// State
// ---------------------------------------------------------------------------

interface BatchEditFieldState {
  isEnabled: "no_change" | "true" | "false";
  priority: string;
  weight: string;
  costMultiplier: string;
  groupTag: string;
  thinkingBudget: string;
  adaptiveThinkingEnabled: "no_change" | "true" | "false";
  adaptiveThinkingConfig: AnthropicAdaptiveThinkingConfig;
}

const INITIAL_EDIT_STATE: BatchEditFieldState = {
  isEnabled: "no_change",
  priority: "",
  weight: "",
  costMultiplier: "",
  groupTag: "",
  thinkingBudget: "",
  adaptiveThinkingEnabled: "no_change",
  adaptiveThinkingConfig: {
    effort: "medium",
    modelMatchMode: "all",
    models: [],
  },
};

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
  const t = useTranslations("settings.providers.batchEdit");
  const queryClient = useQueryClient();

  const [editState, setEditState] = useState<BatchEditFieldState>(INITIAL_EDIT_STATE);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedCount = selectedProviderIds.size;

  // Affected providers: filter by selectedProviderIds
  const affectedProviders = useMemo(() => {
    return providers.filter((p) => selectedProviderIds.has(p.id));
  }, [providers, selectedProviderIds]);

  // Check if any field has been changed from its default
  const hasChanges = useMemo(() => {
    if (mode !== "edit") return true;
    return (
      editState.isEnabled !== "no_change" ||
      editState.priority !== "" ||
      editState.weight !== "" ||
      editState.costMultiplier !== "" ||
      editState.groupTag !== "" ||
      editState.thinkingBudget !== "" ||
      editState.adaptiveThinkingEnabled !== "no_change"
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
    if (!hasChanges) return;
    setConfirmOpen(true);
  }, [hasChanges]);

  const handleConfirm = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const providerIds = Array.from(selectedProviderIds);

      if (mode === "edit") {
        const updates: BatchUpdateProvidersParams["updates"] = {};

        // isEnabled
        if (editState.isEnabled !== "no_change") {
          updates.is_enabled = editState.isEnabled === "true";
        }

        // priority
        if (editState.priority.trim()) {
          const val = Number.parseInt(editState.priority, 10);
          if (!Number.isNaN(val) && val >= 0) {
            updates.priority = val;
          }
        }

        // weight
        if (editState.weight.trim()) {
          const val = Number.parseInt(editState.weight, 10);
          if (!Number.isNaN(val) && val >= 0) {
            updates.weight = val;
          }
        }

        // costMultiplier
        if (editState.costMultiplier.trim()) {
          const val = Number.parseFloat(editState.costMultiplier);
          if (!Number.isNaN(val) && val >= 0) {
            updates.cost_multiplier = val;
          }
        }

        // groupTag
        if (editState.groupTag !== "") {
          if (editState.groupTag === "__clear__") {
            updates.group_tag = null;
          } else {
            updates.group_tag = editState.groupTag.trim() || null;
          }
        }

        // thinkingBudget
        if (editState.thinkingBudget !== "") {
          if (editState.thinkingBudget === "inherit") {
            updates.anthropic_thinking_budget_preference = null;
          } else {
            updates.anthropic_thinking_budget_preference = editState.thinkingBudget;
          }
        }

        // adaptiveThinking
        if (editState.adaptiveThinkingEnabled === "true") {
          updates.anthropic_adaptive_thinking = editState.adaptiveThinkingConfig;
        } else if (editState.adaptiveThinkingEnabled === "false") {
          updates.anthropic_adaptive_thinking = null;
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

          {mode === "edit" && (
            <div className="space-y-6 py-4 max-h-[60vh] overflow-y-auto">
              {/* Affected Provider Summary */}
              <AffectedProviderSummary providers={affectedProviders} />

              {/* Section 1: Basic Settings */}
              <SectionBlock title={t("sections.basic")} dataSection="basic">
                {/* isEnabled - three-state select */}
                <div className="flex items-center justify-between gap-4" data-field="isEnabled">
                  <Label className="text-sm whitespace-nowrap">{t("fields.isEnabled.label")}</Label>
                  <Select
                    value={editState.isEnabled}
                    onValueChange={(v) =>
                      setEditState((s) => ({
                        ...s,
                        isEnabled: v as "no_change" | "true" | "false",
                      }))
                    }
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no_change">{t("fields.isEnabled.noChange")}</SelectItem>
                      <SelectItem value="true">{t("fields.isEnabled.enable")}</SelectItem>
                      <SelectItem value="false">{t("fields.isEnabled.disable")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* priority */}
                <div className="flex items-center justify-between gap-4" data-field="priority">
                  <Label className="text-sm whitespace-nowrap">{t("fields.priority")}</Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={editState.priority}
                    onChange={(e) => setEditState((s) => ({ ...s, priority: e.target.value }))}
                    placeholder="0"
                    className="w-24"
                  />
                </div>

                {/* weight */}
                <div className="flex items-center justify-between gap-4" data-field="weight">
                  <Label className="text-sm whitespace-nowrap">{t("fields.weight")}</Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={editState.weight}
                    onChange={(e) => setEditState((s) => ({ ...s, weight: e.target.value }))}
                    placeholder="1"
                    className="w-24"
                  />
                </div>

                {/* costMultiplier */}
                <div
                  className="flex items-center justify-between gap-4"
                  data-field="costMultiplier"
                >
                  <Label className="text-sm whitespace-nowrap">{t("fields.costMultiplier")}</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={editState.costMultiplier}
                    onChange={(e) =>
                      setEditState((s) => ({ ...s, costMultiplier: e.target.value }))
                    }
                    placeholder="1.0"
                    className="w-24"
                  />
                </div>
              </SectionBlock>

              <Separator />

              {/* Section 2: Group & Routing */}
              <SectionBlock title={t("sections.routing")} dataSection="routing">
                {/* groupTag */}
                <div className="flex items-center justify-between gap-4" data-field="groupTag">
                  <Label className="text-sm whitespace-nowrap">{t("fields.groupTag.label")}</Label>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={editState.groupTag}
                      onChange={(e) => setEditState((s) => ({ ...s, groupTag: e.target.value }))}
                      placeholder="tag1, tag2"
                      className="w-40"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditState((s) => ({ ...s, groupTag: "__clear__" }))}
                    >
                      {t("fields.groupTag.clear")}
                    </Button>
                  </div>
                </div>

                {/* modelRedirects - coming soon */}
                <div className="flex items-center justify-between gap-4">
                  <Label className="text-sm whitespace-nowrap text-muted-foreground">
                    {t("fields.modelRedirects")}
                  </Label>
                  <span className="text-sm text-muted-foreground">{t("fields.comingSoon")}</span>
                </div>

                {/* allowedModels - coming soon */}
                <div className="flex items-center justify-between gap-4">
                  <Label className="text-sm whitespace-nowrap text-muted-foreground">
                    {t("fields.allowedModels")}
                  </Label>
                  <span className="text-sm text-muted-foreground">{t("fields.comingSoon")}</span>
                </div>
              </SectionBlock>

              <Separator />

              {/* Section 3: Anthropic Settings */}
              <SectionBlock title={t("sections.anthropic")} dataSection="anthropic">
                {/* ThinkingBudgetEditor */}
                <div className="space-y-2" data-field="thinkingBudget">
                  <Label className="text-sm">{t("fields.thinkingBudget")}</Label>
                  <ThinkingBudgetEditor
                    value={editState.thinkingBudget || "inherit"}
                    onChange={(v) => setEditState((s) => ({ ...s, thinkingBudget: v }))}
                  />
                </div>

                {/* AdaptiveThinkingEditor */}
                <div className="space-y-2" data-field="adaptiveThinking">
                  <Label className="text-sm">{t("fields.adaptiveThinking")}</Label>
                  <AdaptiveThinkingEditor
                    enabled={editState.adaptiveThinkingEnabled === "true"}
                    config={editState.adaptiveThinkingConfig}
                    onEnabledChange={(val) =>
                      setEditState((s) => ({
                        ...s,
                        adaptiveThinkingEnabled: val ? "true" : "false",
                      }))
                    }
                    onConfigChange={(config) =>
                      setEditState((s) => ({ ...s, adaptiveThinkingConfig: config }))
                    }
                  />
                </div>
              </SectionBlock>
            </div>
          )}

          {(mode === "delete" || mode === "resetCircuit") && (
            <div className="py-4 text-sm text-muted-foreground">{dialogDescription}</div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              {t("confirm.cancel")}
            </Button>
            <Button onClick={handleNext} disabled={!hasChanges}>
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const MAX_DISPLAYED_PROVIDERS = 5;

function AffectedProviderSummary({ providers }: { providers: ProviderDisplay[] }) {
  const t = useTranslations("settings.providers.batchEdit");

  if (providers.length === 0) return null;

  const displayed = providers.slice(0, MAX_DISPLAYED_PROVIDERS);
  const remaining = providers.length - displayed.length;

  return (
    <div className="rounded-md border bg-muted/50 p-3 text-sm" data-testid="affected-summary">
      <p className="font-medium">
        {t("affectedProviders.title")} ({providers.length})
      </p>
      <div className="mt-1 space-y-0.5 text-muted-foreground">
        {displayed.map((p) => (
          <p key={p.id}>
            {p.name} ({p.maskedKey})
          </p>
        ))}
        {remaining > 0 && (
          <p className="text-xs">{t("affectedProviders.more", { count: remaining })}</p>
        )}
      </div>
    </div>
  );
}

function SectionBlock({
  title,
  dataSection,
  children,
}: {
  title: string;
  dataSection: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3" data-section={dataSection}>
      <h4 className="text-sm font-medium">{title}</h4>
      <div className="space-y-3 pl-1">{children}</div>
    </div>
  );
}
