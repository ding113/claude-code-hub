"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Edit,
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
import type { ProviderGroupWithCount } from "@/actions/provider-groups";
import {
  createProviderGroup,
  deleteProviderGroup,
  getProviderGroups,
  updateProviderGroup,
} from "@/actions/provider-groups";
import { editProvider } from "@/actions/providers";
import type { BatchActionMode } from "@/app/[locale]/settings/providers/_components/batch-edit/provider-batch-actions";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { getProviderTypeConfig, getProviderTypeTranslationKey } from "@/lib/provider-type-utils";
import { cn } from "@/lib/utils";
import { parseProviderGroups } from "@/lib/utils/provider-group";
import type { ProviderDisplay } from "@/types/provider";
import { ProviderBatchActions, ProviderBatchDialog, ProviderBatchToolbar } from "./batch-edit";
import { InlineEditPopover } from "./inline-edit-popover";
import { invalidateProviderQueries } from "./invalidate-provider-queries";

interface GroupFormState {
  name: string;
  costMultiplier: string;
  description: string;
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
};

export function ProviderGroupTab({
  providers,
  isAdmin,
  onRequestEditProvider,
}: ProviderGroupTabProps) {
  const t = useTranslations("settings.providers.providerGroups");
  const [groups, setGroups] = useState<ProviderGroupWithCount[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [isLoading, startLoadTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ProviderGroupWithCount | null>(null);
  const [form, setForm] = useState<GroupFormState>(INITIAL_FORM);
  const [isSaving, startSaveTransition] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<ProviderGroupWithCount | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

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
      name: group.name,
      costMultiplier: String(group.costMultiplier),
      description: group.description ?? "",
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
    if (trimmedDescription.length > 500) {
      toast.error(t("descriptionTooLong"));
      return;
    }

    startSaveTransition(async () => {
      if (editingGroup) {
        const ok = await saveGroupPatch(editingGroup.id, {
          costMultiplier,
          description: trimmedDescription || null,
        });
        if (ok) {
          closeDialog();
        }
        return;
      }

      const result = await createProviderGroup({
        name: trimmedName,
        costMultiplier,
        description: trimmedDescription || undefined,
      });
      if (result.ok) {
        toast.success(t("createSuccess"));
        closeDialog();
        fetchGroups();
      } else {
        toast.error(mapSaveError(result.errorCode, result.error ?? t("createFailed")));
      }
    });
  }, [closeDialog, editingGroup, fetchGroups, form, mapSaveError, saveGroupPatch, t]);

  const openDeleteConfirm = useCallback((group: ProviderGroupWithCount) => {
    setDeleteTarget(group);
  }, []);

  const closeDeleteConfirm = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;

    startDeleteTransition(async () => {
      const result = await deleteProviderGroup(deleteTarget.id);
      if (result.ok) {
        toast.success(t("deleteSuccess"));
        closeDeleteConfirm();
        fetchGroups();
      } else if (result.errorCode === "GROUP_IN_USE") {
        toast.error(t("groupInUse"));
      } else if (result.errorCode === "CANNOT_DELETE_DEFAULT") {
        toast.error(t("cannotDeleteDefault"));
      } else {
        toast.error(result.error ?? t("deleteFailed"));
      }
    });
  }, [closeDeleteConfirm, deleteTarget, fetchGroups, t]);

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
      if (raw.length > 500) return t("descriptionTooLong");
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[44px]" />
                <TableHead>{t("groupName")}</TableHead>
                <TableHead className="w-[180px]">{t("costMultiplier")}</TableHead>
                <TableHead>{t("descriptionLabel")}</TableHead>
                <TableHead className="w-[120px] text-center">{t("providerCount")}</TableHead>
                <TableHead className="w-[96px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => {
                const isDefault = group.name === PROVIDER_GROUP.DEFAULT;
                const isExpanded = expandedGroups.has(group.id);
                const members = filterGroupMembers(providers, group.name);

                return (
                  <Fragment key={group.id}>
                    <TableRow className={cn("align-top", isExpanded && "bg-muted/20")}>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => toggleExpand(group.id)}
                          aria-label={t("groupMembers")}
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{group.name}</span>
                          {isDefault ? (
                            <Badge variant="secondary">{t("defaultGroup")}</Badge>
                          ) : null}
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
                      <TableCell className="max-w-[360px]">
                        {isAdmin ? (
                          <InlineTextEditPopover
                            value={group.description ?? ""}
                            emptyLabel={t("noDescription")}
                            label={t("groupDescriptionLabel")}
                            placeholder={t("descriptionPlaceholder")}
                            validator={validateDescription}
                            onSave={(value) =>
                              saveGroupPatch(group.id, { description: value || null })
                            }
                          />
                        ) : group.description ? (
                          <span className="text-muted-foreground">{group.description}</span>
                        ) : (
                          <span className="text-muted-foreground">{t("noDescription")}</span>
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
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEditDialog(group)}
                              title={t("editGroup")}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => openDeleteConfirm(group)}
                              disabled={isDefault}
                              title={isDefault ? t("cannotDeleteDefault") : t("deleteGroup")}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>

                    {isExpanded ? (
                      <TableRow>
                        <TableCell colSpan={6} className="bg-muted/20 p-0">
                          <GroupMembersPanel
                            groupName={group.name}
                            members={members}
                            canEdit={isAdmin}
                            onSaved={fetchGroups}
                            onRequestEditProvider={onRequestEditProvider}
                          />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingGroup ? t("editGroup") : t("addGroup")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="group-name" className="text-sm font-medium">
                {t("groupName")}
              </label>
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
              <label htmlFor="group-multiplier" className="text-sm font-medium">
                {t("costMultiplier")}
              </label>
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
              <label htmlFor="group-description" className="text-sm font-medium">
                {t("descriptionLabel")}
              </label>
              <Input
                id="group-description"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder={t("descriptionPlaceholder")}
              />
            </div>
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

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && closeDeleteConfirm()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("confirmDeleteTitle")}</DialogTitle>
            <DialogDescription>
              {deleteTarget ? t("confirmDeleteDesc", { name: deleteTarget.name }) : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={closeDeleteConfirm} disabled={isDeleting}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function filterGroupMembers(providers: ProviderDisplay[], groupName: string): ProviderDisplay[] {
  return providers.filter((provider) => {
    const tags = parseProviderGroups(provider.groupTag);
    if (tags.includes(groupName)) return true;
    if (groupName === PROVIDER_GROUP.DEFAULT && tags.length === 0) return true;
    return false;
  });
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
