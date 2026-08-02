"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronRight,
  Edit,
  GripVertical,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type * as React from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import type { BatchActionMode } from "@/app/[locale]/settings/providers/_components/batch-edit/provider-batch-actions";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProviderGroupWithCount } from "@/lib/api-client/v1/actions/provider-groups";
import {
  createProviderGroup,
  deleteProviderGroup,
  getProviderGroups,
  reorderProviderGroups,
  updateProviderGroup,
} from "@/lib/api-client/v1/actions/provider-groups";
import type { ProviderGroupMatchRule } from "@/lib/provider-groups/match-rules";
import type { ProviderGroupModelMatchRule } from "@/lib/provider-groups/model-match-rules";
import type { ProviderGroupSharedSettings } from "@/lib/provider-groups/shared-settings";
import { editProvider } from "@/lib/api-client/v1/actions/providers";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { getProviderTypeConfig, getProviderTypeTranslationKey } from "@/lib/provider-type-utils";
import { parsePublicStatusDescription } from "@/lib/public-status/config";
import { exceedsProviderGroupDescriptionLimit } from "@/lib/public-status/description-limit";
import { cn } from "@/lib/utils";
import { resolveProviderGroupsWithDefault } from "@/lib/utils/provider-group";
import type { ProviderDisplay, ProviderType } from "@/types/provider";
import { ProviderBatchActions, ProviderBatchDialog, ProviderBatchToolbar } from "./batch-edit";
import { GroupMatchRulesEditor } from "./group-match-rules-editor";
import { InlineEditPopover } from "./inline-edit-popover";
import { invalidateProviderQueries } from "./invalidate-provider-queries";

interface GroupFormState {
  name: string;
  costMultiplier: string;
  description: string;
  healthTestModel: string;
  matchRules: ProviderGroupMatchRule[];
  modelMatchRules: ProviderGroupModelMatchRule[];
  sharedProviderType: string; // "" | ProviderType
  sharedPriority: string;
  sharedWeight: string;
  sharedProxyUrl: string;
  sharedProxyFallback: boolean;
  sharedPreserveClientIp: boolean;
  sharedDisableSessionReuse: boolean;
  sharedMaxRetryAttempts: string;
  sharedCbFailureThreshold: string;
  sharedCbOpenDurationSec: string;
  sharedCbHalfOpenSuccess: string;
  sharedLimit5hUsd: string;
  sharedLimitDailyUsd: string;
  sharedLimitWeeklyUsd: string;
  sharedLimitMonthlyUsd: string;
  sharedLimitTotalUsd: string;
  sharedLimitConcurrent: string;
  applySharedToMembers: boolean;
}

interface ProviderGroupTabProps {
  providers: ProviderDisplay[];
  isAdmin: boolean;
  onRequestEditProvider: (providerId: number) => void;
}

const INITIAL_FORM: GroupFormState = {
  name: "",
  costMultiplier: "1.0",
  description: "",
  healthTestModel: "",
  matchRules: [],
  modelMatchRules: [],
  sharedProviderType: "",
  sharedPriority: "",
  sharedWeight: "",
  sharedProxyUrl: "",
  sharedProxyFallback: false,
  sharedPreserveClientIp: false,
  sharedDisableSessionReuse: false,
  sharedMaxRetryAttempts: "",
  sharedCbFailureThreshold: "",
  sharedCbOpenDurationSec: "",
  sharedCbHalfOpenSuccess: "",
  sharedLimit5hUsd: "",
  sharedLimitDailyUsd: "",
  sharedLimitWeeklyUsd: "",
  sharedLimitMonthlyUsd: "",
  sharedLimitTotalUsd: "",
  sharedLimitConcurrent: "",
  applySharedToMembers: true,
};

const PROVIDER_TYPE_OPTIONS: ProviderType[] = [
  "claude",
  "codex",
  "gemini",
  "openai-compatible",
];

function formToOptionalNumber(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function numToForm(value: number | null | undefined): string {
  return value == null || !Number.isFinite(Number(value)) ? "" : String(value);
}

function sharedSettingsFromForm(form: GroupFormState): ProviderGroupSharedSettings | null {
  const out: ProviderGroupSharedSettings = {};
  if (form.sharedProviderType && form.sharedProviderType !== "inherit") {
    out.providerType = form.sharedProviderType as ProviderType;
  }
  const priority = formToOptionalNumber(form.sharedPriority);
  const weight = formToOptionalNumber(form.sharedWeight);
  if (priority !== undefined) out.priority = priority;
  if (weight !== undefined) out.weight = weight;
  if (form.sharedProxyUrl.trim()) out.proxyUrl = form.sharedProxyUrl.trim();
  if (form.sharedProxyFallback) out.proxyFallbackToDirect = true;
  if (form.sharedPreserveClientIp) out.preserveClientIp = true;
  if (form.sharedDisableSessionReuse) out.disableSessionReuse = true;
  const retry = formToOptionalNumber(form.sharedMaxRetryAttempts);
  if (retry !== undefined) out.maxRetryAttempts = retry;
  const fail = formToOptionalNumber(form.sharedCbFailureThreshold);
  if (fail !== undefined) out.circuitBreakerFailureThreshold = fail;
  const open = formToOptionalNumber(form.sharedCbOpenDurationSec);
  if (open !== undefined) out.circuitBreakerOpenDuration = open == null ? null : Math.round(open * 1000);
  const half = formToOptionalNumber(form.sharedCbHalfOpenSuccess);
  if (half !== undefined) out.circuitBreakerHalfOpenSuccessThreshold = half;
  const l5 = formToOptionalNumber(form.sharedLimit5hUsd);
  if (l5 !== undefined) out.limit5hUsd = l5;
  const ld = formToOptionalNumber(form.sharedLimitDailyUsd);
  if (ld !== undefined) out.limitDailyUsd = ld;
  const lw = formToOptionalNumber(form.sharedLimitWeeklyUsd);
  if (lw !== undefined) out.limitWeeklyUsd = lw;
  const lm = formToOptionalNumber(form.sharedLimitMonthlyUsd);
  if (lm !== undefined) out.limitMonthlyUsd = lm;
  const lt = formToOptionalNumber(form.sharedLimitTotalUsd);
  if (lt !== undefined) out.limitTotalUsd = lt;
  const lc = formToOptionalNumber(form.sharedLimitConcurrent);
  if (lc !== undefined) out.limitConcurrentSessions = lc;
  return Object.keys(out).length > 0 ? out : null;
}

function formFromSharedSettings(
  shared: ProviderGroupSharedSettings | null | undefined
): Partial<GroupFormState> {
  if (!shared) return {};
  return {
    sharedProviderType: shared.providerType ?? "",
    sharedPriority: numToForm(shared.priority),
    sharedWeight: numToForm(shared.weight),
    sharedProxyUrl: shared.proxyUrl ?? "",
    sharedProxyFallback: Boolean(shared.proxyFallbackToDirect),
    sharedPreserveClientIp: Boolean(shared.preserveClientIp),
    sharedDisableSessionReuse: Boolean(shared.disableSessionReuse),
    sharedMaxRetryAttempts: numToForm(shared.maxRetryAttempts),
    sharedCbFailureThreshold: numToForm(shared.circuitBreakerFailureThreshold),
    sharedCbOpenDurationSec:
      shared.circuitBreakerOpenDuration == null
        ? ""
        : String(shared.circuitBreakerOpenDuration / 1000),
    sharedCbHalfOpenSuccess: numToForm(shared.circuitBreakerHalfOpenSuccessThreshold),
    sharedLimit5hUsd: numToForm(shared.limit5hUsd),
    sharedLimitDailyUsd: numToForm(shared.limitDailyUsd),
    sharedLimitWeeklyUsd: numToForm(shared.limitWeeklyUsd),
    sharedLimitMonthlyUsd: numToForm(shared.limitMonthlyUsd),
    sharedLimitTotalUsd: numToForm(shared.limitTotalUsd),
    sharedLimitConcurrent: numToForm(shared.limitConcurrentSessions),
  };
}









function getProviderGroupDescriptionNote(description: string | null | undefined): string {
  return parsePublicStatusDescription(description).note ?? "";
}

export function ProviderGroupTab({
  providers,
  isAdmin,
  onRequestEditProvider,
}: ProviderGroupTabProps) {
  const t = useTranslations("settings.providers.providerGroups");
  const queryClient = useQueryClient();
  const [groups, setGroups] = useState<ProviderGroupWithCount[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [isLoading, startLoadTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ProviderGroupWithCount | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<ProviderGroupWithCount | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const [form, setForm] = useState<GroupFormState>(INITIAL_FORM);
  const [isSaving, startSaveTransition] = useTransition();
  const [isReordering, startReorderTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const fetchGroups = useCallback(() => {
    startLoadTransition(async () => {
      const groupsResult = await getProviderGroups();
      if (groupsResult.ok) {
        setGroups(groupsResult.data);
      } else {
        toast.error(groupsResult.error);
      }
    });
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!isAdmin) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const sortableGroups = groups.filter((g) => g.name !== PROVIDER_GROUP.DEFAULT);
      const oldIndex = sortableGroups.findIndex((g) => g.id === Number(active.id));
      const newIndex = sortableGroups.findIndex((g) => g.id === Number(over.id));
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

      const reordered = arrayMove(sortableGroups, oldIndex, newIndex);
      const defaultGroup = groups.find((g) => g.name === PROVIDER_GROUP.DEFAULT);
      const optimistic = defaultGroup ? [defaultGroup, ...reordered] : reordered;
      setGroups(
        optimistic.map((g) => ({
          ...g,
          providerCount: groups.find((x) => x.id === g.id)?.providerCount ?? g.providerCount,
        }))
      );

      startReorderTransition(async () => {
        const result = await reorderProviderGroups(reordered.map((g) => g.id));
        if (result.ok) {
          setGroups(result.data);
          toast.success(t("reorderSuccess"));
        } else {
          toast.error(result.error ?? t("reorderFailed"));
          fetchGroups();
        }
      });
    },
    [fetchGroups, groups, isAdmin, t]
  );

  const toggleExpand = useCallback((groupId: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const openCreateDialog = useCallback(() => {
    setEditingGroup(null);
    setForm(INITIAL_FORM);
    setDialogOpen(true);
  }, []);

  const openEditDialog = useCallback((group: ProviderGroupWithCount) => {
    setEditingGroup(group);
    setForm({
      ...INITIAL_FORM,
      name: group.name,
      costMultiplier: String(group.costMultiplier),
      description: getProviderGroupDescriptionNote(group.description),
      healthTestModel: group.healthTestModel ?? "",
      matchRules: group.matchRules ?? [],
      modelMatchRules: group.modelMatchRules ?? [],
      ...formFromSharedSettings(group.sharedSettings),
      applySharedToMembers: true,
    });
    setDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setEditingGroup(null);
    setForm(INITIAL_FORM);
  }, []);

  const mapSaveError = useCallback(
    (errorCode: string | undefined, fallback: string): string => {
      switch (errorCode) {
        case "NAME_REQUIRED":
          return t("nameRequired");
        case "DUPLICATE_NAME":
          return t("duplicateName");
        case "INVALID_MULTIPLIER":
          return t("invalidMultiplier");
        case "DESCRIPTION_TOO_LONG":
          return t("descriptionTooLong");
        default:
          return fallback;
      }
    },
    [t]
  );

  const saveGroupPatch = useCallback(
    async (
      groupId: number,
      patch: {
        costMultiplier?: number;
        description?: string | null;
        descriptionNote?: string | null;
        healthTestModel?: string | null;
        matchRules?: ProviderGroupMatchRule[] | null;
        modelMatchRules?: ProviderGroupModelMatchRule[] | null;
        sharedSettings?: ProviderGroupSharedSettings | null;
        applySharedSettingsToMembers?: boolean;
      }
    ): Promise<boolean> => {
      const result = await updateProviderGroup(groupId, patch);
      if (result.ok) {
        toast.success(t("updateSuccess"));
        fetchGroups();
        return true;
      }
      toast.error(mapSaveError(result.errorCode, result.error ?? t("updateFailed")));
      return false;
    },
    [fetchGroups, mapSaveError, t]
  );

  const handleDeleteGroup = useCallback(() => {
    if (!deletingGroup) return;
    startDelete(async () => {
      const result = await deleteProviderGroup(deletingGroup.id);
      if (!result.ok) {
        toast.error(result.error ?? t("deleteFailed"));
        return;
      }
      toast.success(t("deleteSuccess"));
      setDeletingGroup(null);
      fetchGroups();
    });
  }, [deletingGroup, fetchGroups, t]);

  const handleSave = useCallback(() => {
    const costMultiplier = Number.parseFloat(form.costMultiplier);
    if (!Number.isFinite(costMultiplier) || costMultiplier < 0) {
      toast.error(t("invalidMultiplier"));
      return;
    }

    const trimmedName = form.name.trim();
    const trimmedDescription = form.description.trim();
    if (!editingGroup && !trimmedName) {
      toast.error(t("nameRequired"));
      return;
    }
    if (exceedsProviderGroupDescriptionLimit(trimmedDescription)) {
      toast.error(t("descriptionTooLong"));
      return;
    }

    startSaveTransition(async () => {
      const sharedSettings = sharedSettingsFromForm(form);
      if (editingGroup) {
        const ok = await saveGroupPatch(editingGroup.id, {
          costMultiplier,
          descriptionNote: trimmedDescription || null,
          healthTestModel: form.healthTestModel.trim() || null,
          matchRules: form.matchRules,
          modelMatchRules: form.modelMatchRules,
          sharedSettings,
          applySharedSettingsToMembers: form.applySharedToMembers,
        });
        if (ok) {
          if (form.applySharedToMembers && sharedSettings) {
            toast.success(t("sharedAppliedHint"));
            await invalidateProviderQueries(queryClient);
          }
          closeDialog();
        }
        return;
      }

      const result = await createProviderGroup({
        name: trimmedName,
        costMultiplier,
        healthTestModel: form.healthTestModel.trim() || null,
        description: trimmedDescription || undefined,
        matchRules: form.matchRules,
        modelMatchRules: form.modelMatchRules,
        sharedSettings,
        applySharedSettingsToMembers: form.applySharedToMembers,
      });
      if (result.ok) {
        toast.success(
          form.applySharedToMembers && sharedSettings
            ? t("createSuccessWithApply")
            : t("createSuccess")
        );
        closeDialog();
        fetchGroups();
        if (form.applySharedToMembers && sharedSettings) {
          await invalidateProviderQueries(queryClient);
        }
      } else {
        toast.error(mapSaveError(result.errorCode, result.error ?? t("createFailed")));
      }
    });
  }, [closeDialog, editingGroup, fetchGroups, form, mapSaveError, queryClient, saveGroupPatch, t]);

  const validateCostMultiplier = useCallback(
    (raw: string) => {
      if (raw.length === 0) return t("invalidMultiplier");
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) return t("invalidMultiplier");
      return null;
    },
    [t]
  );

  const validateDescription = useCallback(
    (raw: string) => {
      if (exceedsProviderGroupDescriptionLimit(raw)) return t("descriptionTooLong");
      return null;
    },
    [t]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-lg font-medium">{t("title")}</h3>
            <Badge variant="secondary" className="tabular-nums">
              {groups.length}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {isAdmin ? (
          <Button onClick={openCreateDialog} size="sm">
            <Plus className="mr-1.5 h-4 w-4" />
            {t("addGroup")}
          </Button>
        ) : null}
      </div>

      {isLoading && groups.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border bg-card py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-12 text-center">
          <p className="text-sm font-medium text-muted-foreground">{t("noGroups")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("noGroupsDesc")}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                {isAdmin ? <TableHead className="w-9" /> : null}
                <TableHead className="w-10" />
                <TableHead className="w-[12%]">{t("groupName")}</TableHead>
                <TableHead className="w-[9%]">{t("costMultiplier")}</TableHead>
                <TableHead className="w-[18%]">{t("descriptionLabel")}</TableHead>
                <TableHead className="w-[16%]">{t("colMatchRules")}</TableHead>
                <TableHead className="w-[18%]">{t("healthTestModel")}</TableHead>
                <TableHead className="w-[8%] text-center">{t("providerCount")}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={groups
                    .filter((g) => g.name !== PROVIDER_GROUP.DEFAULT)
                    .map((g) => g.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {groups.map((group) => {
                    const isDefault = group.name === PROVIDER_GROUP.DEFAULT;
                    const isExpanded = expandedGroups.has(group.id);
                    const members = filterGroupMembers(providers, group.name);
                    return (
                      <SortableGroupRow
                        key={group.id}
                        group={group}
                        isDefault={isDefault}
                        isExpanded={isExpanded}
                        isAdmin={isAdmin}
                        members={members}
                        disabled={!isAdmin || isReordering || isDefault}
                        onToggleExpand={() => toggleExpand(group.id)}
                        onEdit={() => openEditDialog(group)}
                        onDelete={isDefault ? undefined : () => setDeletingGroup(group)}
                        saveGroupPatch={saveGroupPatch}
                        validateCostMultiplier={validateCostMultiplier}
                        validateDescription={validateDescription}
                        onRequestEditProvider={onRequestEditProvider}
                        onSaved={fetchGroups}
                        t={t}
                      />
                    );
                  })}
                </SortableContext>
              </DndContext>
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingGroup ? t("editGroup") : t("addGroup")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <section className="space-y-3 rounded-xl border bg-muted/10 p-4">
              <div className="text-sm font-medium">{t("sectionBasic")}</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="group-name">{t("groupName")}</Label>
                  <Input
                    id="group-name"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder={t("groupNamePlaceholder")}
                    readOnly={!!editingGroup}
                    disabled={!!editingGroup}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="group-multiplier">{t("costMultiplier")}</Label>
                  <Input
                    id="group-multiplier"
                    type="number"
                    min={0}
                    step={0.01}
                    value={form.costMultiplier}
                    onChange={(e) => setForm((prev) => ({ ...prev, costMultiplier: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="group-health-model">{t("healthTestModel")}</Label>
                  <Input
                    id="group-health-model"
                    value={form.healthTestModel}
                    onChange={(e) => setForm((prev) => ({ ...prev, healthTestModel: e.target.value }))}
                    placeholder={t("healthTestModelPlaceholder")}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="group-description">{t("descriptionLabel")}</Label>
                  <Input
                    id="group-description"
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder={t("descriptionPlaceholder")}
                  />
                  <p className="text-xs text-muted-foreground">{t("healthTestModelHelp")}</p>
                </div>
              </div>
            </section>

            <section className="space-y-3 rounded-xl border bg-muted/10 p-4">
              <div className="text-sm font-medium">{t("sectionMatch")}</div>
              <GroupMatchRulesEditor
                value={form.matchRules}
                onChange={(matchRules) => setForm((prev) => ({ ...prev, matchRules }))}
                disabled={isSaving}
              />
            </section>

            <section className="space-y-3 rounded-xl border bg-muted/10 p-4">
              <div className="text-sm font-medium">{t("sectionModelMatch")}</div>
              <GroupMatchRulesEditor
                value={form.modelMatchRules}
                onChange={(modelMatchRules) => setForm((prev) => ({ ...prev, modelMatchRules }))}
                disabled={isSaving}
                title={t("modelMatchRulesTitle")}
                help={t("modelMatchRulesHelp")}
                emptyLabel={t("modelMatchRulesEmpty")}
                patternLabel={t("modelPatternLabel")}
                patternPlaceholder={t("modelPatternPlaceholder")}
                idPrefix="group-model-match"
              />
            </section>

            <section className="space-y-3 rounded-xl border bg-muted/10 p-4">
              <div>
                <div className="text-sm font-medium">{t("sharedSettingsTitle")}</div>
                <p className="text-xs text-muted-foreground">{t("sharedSettingsHelp")}</p>
              </div>

              <div className="space-y-2">
                <Label>{t("sharedProviderType")}</Label>
                <Select
                  value={form.sharedProviderType || "inherit"}
                  onValueChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      sharedProviderType: value === "inherit" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("sharedProviderTypeInherit")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">{t("sharedProviderTypeInherit")}</SelectItem>
                    {PROVIDER_TYPE_OPTIONS.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t("sharedProviderTypeHelp")}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("sharedPriority")}</Label>
                  <Input
                    type="number"
                    value={form.sharedPriority}
                    onChange={(e) => setForm((prev) => ({ ...prev, sharedPriority: e.target.value }))}
                    placeholder={t("sharedLeaveEmpty")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("sharedWeight")}</Label>
                  <Input
                    type="number"
                    value={form.sharedWeight}
                    onChange={(e) => setForm((prev) => ({ ...prev, sharedWeight: e.target.value }))}
                    placeholder={t("sharedLeaveEmpty")}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs">{t("sharedProxyUrl")}</Label>
                  <Input
                    value={form.sharedProxyUrl}
                    onChange={(e) => setForm((prev) => ({ ...prev, sharedProxyUrl: e.target.value }))}
                    placeholder="socks5://..."
                  />
                </div>
                <label className="flex items-center gap-2 text-xs sm:col-span-2">
                  <Checkbox
                    checked={form.sharedProxyFallback}
                    onCheckedChange={(checked) =>
                      setForm((prev) => ({ ...prev, sharedProxyFallback: checked === true }))
                    }
                  />
                  {t("sharedProxyFallback")}
                </label>
                <label className="flex items-center gap-2 text-xs sm:col-span-2">
                  <Checkbox
                    checked={form.sharedPreserveClientIp}
                    onCheckedChange={(checked) =>
                      setForm((prev) => ({ ...prev, sharedPreserveClientIp: checked === true }))
                    }
                  />
                  {t("sharedPreserveClientIp")}
                </label>
                <label className="flex items-center gap-2 text-xs sm:col-span-2">
                  <Checkbox
                    checked={form.sharedDisableSessionReuse}
                    onCheckedChange={(checked) =>
                      setForm((prev) => ({ ...prev, sharedDisableSessionReuse: checked === true }))
                    }
                  />
                  {t("sharedDisableSessionReuse")}
                </label>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("sharedMaxRetry")}</Label>
                  <Input
                    type="number"
                    value={form.sharedMaxRetryAttempts}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, sharedMaxRetryAttempts: e.target.value }))
                    }
                    placeholder={t("sharedLeaveEmpty")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("sharedCbFailure")}</Label>
                  <Input
                    type="number"
                    value={form.sharedCbFailureThreshold}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, sharedCbFailureThreshold: e.target.value }))
                    }
                    placeholder={t("sharedLeaveEmpty")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("sharedCbOpen")}</Label>
                  <Input
                    type="number"
                    value={form.sharedCbOpenDurationSec}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, sharedCbOpenDurationSec: e.target.value }))
                    }
                    placeholder={t("sharedSecondsPlaceholder")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("sharedCbHalfOpen")}</Label>
                  <Input
                    type="number"
                    value={form.sharedCbHalfOpenSuccess}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, sharedCbHalfOpenSuccess: e.target.value }))
                    }
                    placeholder={t("sharedLeaveEmpty")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("sharedLimitDaily")}</Label>
                  <Input
                    type="number"
                    value={form.sharedLimitDailyUsd}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, sharedLimitDailyUsd: e.target.value }))
                    }
                    placeholder={t("sharedLeaveEmpty")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("sharedLimit5h")}</Label>
                  <Input
                    type="number"
                    value={form.sharedLimit5hUsd}
                    onChange={(e) => setForm((prev) => ({ ...prev, sharedLimit5hUsd: e.target.value }))}
                    placeholder={t("sharedLeaveEmpty")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("sharedLimitWeekly")}</Label>
                  <Input
                    type="number"
                    value={form.sharedLimitWeeklyUsd}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, sharedLimitWeeklyUsd: e.target.value }))
                    }
                    placeholder={t("sharedLeaveEmpty")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("sharedLimitMonthly")}</Label>
                  <Input
                    type="number"
                    value={form.sharedLimitMonthlyUsd}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, sharedLimitMonthlyUsd: e.target.value }))
                    }
                    placeholder={t("sharedLeaveEmpty")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("sharedLimitTotal")}</Label>
                  <Input
                    type="number"
                    value={form.sharedLimitTotalUsd}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, sharedLimitTotalUsd: e.target.value }))
                    }
                    placeholder={t("sharedLeaveEmpty")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("sharedLimitConcurrent")}</Label>
                  <Input
                    type="number"
                    value={form.sharedLimitConcurrent}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, sharedLimitConcurrent: e.target.value }))
                    }
                    placeholder={t("sharedLeaveEmpty")}
                  />
                </div>
              </div>

              <label className="flex items-start gap-2 text-xs">
                <Checkbox
                  checked={form.applySharedToMembers}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({ ...prev, applySharedToMembers: checked === true }))
                  }
                  className="mt-0.5"
                />
                <span>{t("applySharedToMembers")}</span>
              </label>
            </section>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isSaving}>
              {t("cancel")}
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingGroup} onOpenChange={(open) => !open && setDeletingGroup(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteGroup")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteGroupConfirm", { name: deletingGroup?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteGroup();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t("deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

interface SortableGroupRowProps {
  group: ProviderGroupWithCount;
  isDefault: boolean;
  isExpanded: boolean;
  isAdmin: boolean;
  members: ProviderDisplay[];
  disabled: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete?: () => void;
  saveGroupPatch: (
    groupId: number,
    patch: {
      costMultiplier?: number;
      description?: string | null;
      descriptionNote?: string | null;
      healthTestModel?: string | null;
      matchRules?: ProviderGroupMatchRule[] | null;
    }
  ) => Promise<boolean>;
  validateCostMultiplier: (raw: string) => string | null;
  validateDescription: (raw: string) => string | null;
  onRequestEditProvider: (providerId: number) => void;
  onSaved: () => void;
  t: (key: string, values?: Record<string, string | number | Date>) => string;
}

function SortableGroupRow({
  group,
  isDefault,
  isExpanded,
  isAdmin,
  members,
  disabled,
  onToggleExpand,
  onEdit,
  onDelete,
  saveGroupPatch,
  validateCostMultiplier,
  validateDescription,
  onRequestEditProvider,
  onSaved,
  t,
}: SortableGroupRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
    disabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  };

  const ruleCount = group.matchRules?.length ?? 0;
  const rulePreview = (group.matchRules ?? [])
    .slice(0, 2)
    .map((r) => r.pattern)
    .join(", ");

  return (
    <Fragment>
      <TableRow
        ref={setNodeRef}
        style={style}
        className={cn(
          "group/row align-middle",
          isExpanded && "bg-muted/20",
          isDragging && "bg-primary/5"
        )}
      >
        {isAdmin ? (
          <TableCell className="w-[36px] pr-0">
            {isDefault ? (
              <span className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground/40">
                <GripVertical className="h-4 w-4" />
              </span>
            ) : (
              <button
                type="button"
                className="inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={t("dragHandle")}
                disabled={disabled}
                {...attributes}
                {...listeners}
              >
                <GripVertical className="h-4 w-4" />
              </button>
            )}
          </TableCell>
        ) : null}
        <TableCell>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onToggleExpand}
            aria-label={t("groupMembers")}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <span className="font-medium">{group.name}</span>
            {isDefault ? <Badge variant="secondary">{t("defaultGroup")}</Badge> : null}
          </div>
        </TableCell>
        <TableCell>
          {isAdmin ? (
            <InlineEditPopover
              value={group.costMultiplier}
              label={t("groupMultiplierLabel")}
              validator={validateCostMultiplier}
              onSave={(value) => saveGroupPatch(group.id, { costMultiplier: value })}
              suffix="x"
              type="number"
            />
          ) : (
            <span className="font-mono">{group.costMultiplier}x</span>
          )}
        </TableCell>
        <TableCell className="min-w-0 overflow-hidden">
          {isAdmin ? (
            <InlineTextEditPopover
              value={getProviderGroupDescriptionNote(group.description)}
              emptyLabel={t("noDescription")}
              label={t("groupDescriptionLabel")}
              placeholder={t("descriptionPlaceholder")}
              validator={validateDescription}
              onSave={(value) =>
                saveGroupPatch(group.id, {
                  descriptionNote: value || null,
                })
              }
            />
          ) : getProviderGroupDescriptionNote(group.description) ? (
            <span className="text-muted-foreground">
              {getProviderGroupDescriptionNote(group.description)}
            </span>
          ) : (
            <span className="text-muted-foreground">{t("noDescription")}</span>
          )}
        </TableCell>
        <TableCell className="min-w-0 overflow-hidden">
          {ruleCount > 0 ? (
            <button
              type="button"
              className="block w-full min-w-0 text-left text-xs text-muted-foreground hover:text-foreground"
              onClick={onEdit}
              title={rulePreview}
            >
              <span className="font-medium text-foreground/80">
                {t("matchRulesCount", { count: ruleCount })}
              </span>
              {rulePreview ? (
                <span className="mt-0.5 block truncate font-mono text-[11px]">{rulePreview}</span>
              ) : null}
            </button>
          ) : (
            <button
              type="button"
              className="block w-full min-w-0 truncate text-xs text-muted-foreground hover:text-foreground"
              onClick={onEdit}
              title={t("matchRulesEmpty")}
            >
              {t("matchRulesEmptyShort")}
            </button>
          )}
        </TableCell>
        <TableCell className="min-w-0 overflow-hidden">
          {isAdmin ? (
            <InlineTextEditPopover
              value={group.healthTestModel ?? ""}
              emptyLabel={t("healthTestModelEmpty")}
              label={t("groupHealthTestModelLabel")}
              placeholder={t("healthTestModelPlaceholder")}
              validator={(raw) => {
                if (raw.length > 200) return t("descriptionTooLong");
                return null;
              }}
              onSave={(value) =>
                saveGroupPatch(group.id, {
                  healthTestModel: value.trim() || null,
                })
              }
            />
          ) : group.healthTestModel ? (
            <span className="font-mono text-sm">{group.healthTestModel}</span>
          ) : (
            <span className="text-xs text-muted-foreground">{t("healthTestModelEmpty")}</span>
          )}
        </TableCell>
        <TableCell className="text-center">
          <Badge variant="outline" className="tabular-nums">
            {group.providerCount}
          </Badge>
        </TableCell>
        <TableCell>
          {isAdmin ? (
            <div className="flex items-center justify-end gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit} title={t("editGroup")}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {onDelete ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/row:opacity-100"
                  onClick={onDelete}
                  title={t("deleteGroup")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          ) : null}
        </TableCell>
      </TableRow>
      {isExpanded ? (
        <TableRow>
          <TableCell colSpan={isAdmin ? 9 : 8} className="bg-muted/20 p-0">
            <GroupMembersPanel
              groupName={group.name}
              members={members}
              canEdit={isAdmin}
              onSaved={onSaved}
              onRequestEditProvider={onRequestEditProvider}
            />
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
}

function filterGroupMembers(providers: ProviderDisplay[], groupName: string): ProviderDisplay[] {
  return providers.filter((provider) =>
    resolveProviderGroupsWithDefault(provider.groupTag).includes(groupName)
  );
}

interface GroupMembersPanelProps {
  groupName: string;
  members: ProviderDisplay[];
  canEdit: boolean;
  onSaved: () => void;
  onRequestEditProvider: (providerId: number) => void;
}

function GroupMembersPanel({
  groupName,
  members,
  canEdit,
  onSaved,
  onRequestEditProvider,
}: GroupMembersPanelProps) {
  const t = useTranslations("settings.providers.providerGroups");
  const queryClient = useQueryClient();
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedProviderIds, setSelectedProviderIds] = useState<Set<number>>(new Set());
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchActionMode, setBatchActionMode] = useState<BatchActionMode>(null);

  const allSelected = members.length > 0 && selectedProviderIds.size === members.length;

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedProviderIds(new Set(members.map((member) => member.id)));
      } else {
        setSelectedProviderIds(new Set());
      }
    },
    [members]
  );

  const handleInvertSelection = useCallback(() => {
    const next = new Set(
      members.map((member) => member.id).filter((id) => !selectedProviderIds.has(id))
    );
    setSelectedProviderIds(next);
  }, [members, selectedProviderIds]);

  const handleSelectByType = useCallback(
    (type: ProviderDisplay["providerType"]) => {
      setSelectedProviderIds((prev) => {
        const next = new Set(prev);
        for (const member of members) {
          if (member.providerType === type) {
            next.add(member.id);
          }
        }
        return next;
      });
    },
    [members]
  );

  const handleSelectMember = useCallback((providerId: number, checked: boolean) => {
    setSelectedProviderIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(providerId);
      } else {
        next.delete(providerId);
      }
      return next;
    });
  }, []);

  const handleOpenBatchEdit = useCallback(() => {
    setBatchActionMode("edit");
    setBatchDialogOpen(true);
  }, []);

  const handleBatchAction = useCallback((mode: BatchActionMode) => {
    setBatchActionMode(mode);
    setBatchDialogOpen(true);
  }, []);

  const handleBatchSuccess = useCallback(() => {
    setSelectedProviderIds(new Set());
    setIsMultiSelectMode(false);
    onSaved();
  }, [onSaved]);

  const handleExitMultiSelectMode = useCallback(() => {
    setSelectedProviderIds(new Set());
    setIsMultiSelectMode(false);
  }, []);

  if (members.length === 0) {
    return (
      <div className="px-6 py-6 text-center text-sm text-muted-foreground">{t("noMembers")}</div>
    );
  }

  return (
    <div className="space-y-4 px-6 py-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-background/80 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{t("groupMembers")}</span>
              <Badge variant="outline" className="tabular-nums">
                {members.length}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{t("groupMembersHint", { groupName })}</p>
          </div>
          {canEdit ? (
            <ProviderBatchToolbar
              isMultiSelectMode={isMultiSelectMode}
              allSelected={allSelected}
              selectedCount={selectedProviderIds.size}
              totalCount={members.length}
              onEnterMode={() => setIsMultiSelectMode(true)}
              onExitMode={handleExitMultiSelectMode}
              onSelectAll={handleSelectAll}
              onInvertSelection={handleInvertSelection}
              onOpenBatchEdit={handleOpenBatchEdit}
              providers={members}
              onSelectByType={handleSelectByType}
              onSelectByGroup={() => {}}
              showSelectByGroup={false}
            />
          ) : null}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              {isMultiSelectMode ? <TableHead className="w-[44px]" /> : null}
              <TableHead>{t("providerName")}</TableHead>
              <TableHead className="w-[180px]">{t("providerType")}</TableHead>
              <TableHead className="w-[180px]">{t("effectivePriority")}</TableHead>
              <TableHead className="w-[88px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                groupName={groupName}
                canEdit={canEdit}
                isMultiSelectMode={isMultiSelectMode}
                isSelected={selectedProviderIds.has(member.id)}
                onSelectChange={(checked) => handleSelectMember(member.id, checked)}
                onSaved={onSaved}
                onRequestEditProvider={onRequestEditProvider}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <ProviderBatchActions
        selectedCount={selectedProviderIds.size}
        isVisible={isMultiSelectMode}
        onAction={handleBatchAction}
        onClose={handleExitMultiSelectMode}
      />

      <ProviderBatchDialog
        open={batchDialogOpen}
        mode={batchActionMode}
        onOpenChange={setBatchDialogOpen}
        selectedProviderIds={selectedProviderIds}
        providers={members}
        onSuccess={handleBatchSuccess}
      />
    </div>
  );
}

interface MemberRowProps {
  member: ProviderDisplay;
  groupName: string;
  canEdit: boolean;
  isMultiSelectMode: boolean;
  isSelected: boolean;
  onSelectChange: (checked: boolean) => void;
  onSaved: () => void;
  onRequestEditProvider: (providerId: number) => void;
}

function MemberRow({
  member,
  groupName,
  canEdit,
  isMultiSelectMode,
  isSelected,
  onSelectChange,
  onSaved,
  onRequestEditProvider,
}: MemberRowProps) {
  const t = useTranslations("settings.providers.providerGroups");
  const tTypes = useTranslations("settings.providers.types");
  const queryClient = useQueryClient();

  const effectivePriority = useMemo(() => {
    const groupPriorities = (member.groupPriorities ?? null) as Record<string, number> | null;
    return groupPriorities?.[groupName] ?? member.priority;
  }, [groupName, member.groupPriorities, member.priority]);

  const typeConfig = getProviderTypeConfig(member.providerType);
  const TypeIcon = typeConfig.icon;
  const typeKey = getProviderTypeTranslationKey(member.providerType);
  const typeLabel = tTypes(`${typeKey}.label`);

  const validatePriority = useCallback(
    (raw: string) => {
      if (raw.length === 0) return t("savePriorityFailed");
      const value = Number(raw);
      if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
        return t("savePriorityFailed");
      }
      return null;
    },
    [t]
  );

  const handleSavePriority = useCallback(
    async (value: number) => {
      const existing = (member.groupPriorities ?? null) as Record<string, number> | null;
      const merged: Record<string, number> = { ...(existing ?? {}), [groupName]: value };
      const result = await editProvider(member.id, { group_priorities: merged });
      if (!result.ok) {
        toast.error(result.error ?? t("savePriorityFailed"));
        return false;
      }

      toast.success(t("savePrioritySuccess"));
      await invalidateProviderQueries(queryClient);
      onSaved();
      return true;
    },
    [groupName, member.groupPriorities, member.id, onSaved, queryClient, t]
  );

  return (
    <TableRow>
      {isMultiSelectMode ? (
        <TableCell>
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onSelectChange(Boolean(checked))}
          />
        </TableCell>
      ) : null}
      <TableCell>
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md border bg-muted/40",
              typeConfig.iconColor
            )}
            title={typeLabel}
          >
            <TypeIcon className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            {canEdit ? (
              <button
                type="button"
                className="truncate text-left font-medium underline-offset-4 hover:underline"
                onClick={() => onRequestEditProvider(member.id)}
              >
                {member.name}
              </button>
            ) : (
              <span className="truncate text-left font-medium">{member.name}</span>
            )}
            <div className="truncate text-xs text-muted-foreground">{member.url}</div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="gap-1.5">
          <TypeIcon className={cn("h-3.5 w-3.5", typeConfig.iconColor)} aria-hidden />
          <span>{typeLabel}</span>
        </Badge>
      </TableCell>
      <TableCell>
        {canEdit ? (
          <InlineEditPopover
            value={effectivePriority}
            label={t("effectivePriority")}
            validator={validatePriority}
            onSave={handleSavePriority}
            type="integer"
          />
        ) : (
          <span className="tabular-nums font-medium">{effectivePriority}</span>
        )}
      </TableCell>
      <TableCell>
        {canEdit ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            onClick={() => onRequestEditProvider(member.id)}
            title={t("openProviderEditor")}
            aria-label={t("openProviderEditor")}
          >
            <Edit className="h-4 w-4" />
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

interface InlineTextEditPopoverProps {
  value: string;
  emptyLabel: string;
  label: string;
  placeholder: string;
  validator: (value: string) => string | null;
  onSave: (value: string) => Promise<boolean>;
}

function InlineTextEditPopover({
  value,
  emptyLabel,
  label,
  placeholder,
  validator,
  onSave,
}: InlineTextEditPopoverProps) {
  const t = useTranslations("settings.providers.providerGroups");
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmedDraft = draft.trim();
  const validationError = useMemo(() => validator(trimmedDraft), [trimmedDraft, validator]);
  const canSave = !saving && validationError == null;

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const resetDraft = useCallback(() => {
    setDraft(value);
  }, [value]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setDraft(value);
      } else {
        resetDraft();
        setSaving(false);
      }
      setOpen(nextOpen);
    },
    [resetDraft, value]
  );

  const handleCancel = useCallback(() => {
    resetDraft();
    setOpen(false);
  }, [resetDraft]);

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const ok = await onSave(trimmedDraft);
      if (ok) {
        setOpen(false);
      }
    } finally {
      setSaving(false);
    }
  }, [canSave, onSave, trimmedDraft]);

  const stopPropagation = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  const trigger = (
    <button
      type="button"
      className={cn(
        "max-w-full rounded-sm text-left underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        value
          ? "text-muted-foreground hover:underline"
          : "text-muted-foreground/80 italic hover:underline"
      )}
      onPointerDown={stopPropagation}
      onClick={(event) => {
        event.stopPropagation();
        if (!isDesktop) handleOpenChange(true);
      }}
    >
      <span className="line-clamp-2">{value || emptyLabel}</span>
    </button>
  );

  const inputProps = {
    ref: inputRef,
    value: draft,
    placeholder,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
    disabled: saving,
    "aria-label": label,
    "aria-invalid": validationError != null,
    onPointerDown: stopPropagation,
    onClick: stopPropagation,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        handleCancel();
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void handleSave();
      }
    },
  };

  const content = (
    <div className="grid gap-2">
      <div className="hidden text-xs font-medium md:block">{label}</div>
      <Input {...inputProps} className="w-full md:w-[320px]" />
      {validationError ? <div className="text-xs text-destructive">{validationError}</div> : null}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" size="sm" variant="outline" onClick={handleCancel} disabled={saving}>
          {t("cancel")}
        </Button>
        <Button type="button" size="sm" onClick={handleSave} disabled={!canSave}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t("save")}
        </Button>
      </div>
    </div>
  );

  if (!isDesktop) {
    return (
      <>
        {trigger}
        <Drawer open={open} onOpenChange={handleOpenChange}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{label}</DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-6">
              <div className="grid gap-3">
                <Input
                  {...inputProps}
                  className="text-base"
                  onPointerDown={undefined}
                  onClick={undefined}
                />
                {validationError ? (
                  <div className="text-sm text-destructive">{validationError}</div>
                ) : null}
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={handleCancel}
                    disabled={saving}
                    className="flex-1"
                    size="lg"
                  >
                    {t("cancel")}
                  </Button>
                  <Button onClick={handleSave} disabled={!canSave} className="flex-1" size="lg">
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {t("save")}
                  </Button>
                </div>
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-auto p-3"
        onPointerDown={stopPropagation}
        onClick={stopPropagation}
      >
        {content}
      </PopoverContent>
    </Popover>
  );
}
