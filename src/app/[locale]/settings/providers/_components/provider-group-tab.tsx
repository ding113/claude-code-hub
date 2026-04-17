"use client";

import { ChevronDown, ChevronRight, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ProviderGroupWithCount } from "@/actions/provider-groups";
import {
  createProviderGroup,
  deleteProviderGroup,
  getProviderGroups,
  updateProviderGroup,
} from "@/actions/provider-groups";
import { editProvider, getProviders } from "@/actions/providers";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { parseProviderGroups } from "@/lib/utils/provider-group";
import type { ProviderDisplay } from "@/types/provider";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GroupFormState {
  name: string;
  costMultiplier: string;
  description: string;
}

const INITIAL_FORM: GroupFormState = {
  name: "",
  costMultiplier: "1.0",
  description: "",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProviderGroupTab() {
  const t = useTranslations("settings.providers.providerGroups");

  // Data
  const [groups, setGroups] = useState<ProviderGroupWithCount[]>([]);
  const [providers, setProviders] = useState<ProviderDisplay[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [isLoading, startLoadTransition] = useTransition();

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ProviderGroupWithCount | null>(null);
  const [form, setForm] = useState<GroupFormState>(INITIAL_FORM);
  const [isSaving, startSaveTransition] = useTransition();

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<ProviderGroupWithCount | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchGroups = useCallback(() => {
    startLoadTransition(async () => {
      const [groupsResult, providersResult] = await Promise.all([
        getProviderGroups(),
        getProviders(),
      ]);
      if (groupsResult.ok) {
        setGroups(groupsResult.data);
      } else {
        toast.error(groupsResult.error);
      }
      setProviders(providersResult);
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

  // ---------------------------------------------------------------------------
  // Dialog handlers
  // ---------------------------------------------------------------------------

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

  // Map server-side error codes to localized toast messages. Falls back to
  // the provided fallback when the code is unknown or absent.
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

  const handleSave = useCallback(() => {
    // All synchronous validation happens BEFORE the transition so that
    // `isSaving` never briefly flips true for validation failures.
    const costMultiplier = Number.parseFloat(form.costMultiplier);
    if (!Number.isFinite(costMultiplier) || costMultiplier < 0) {
      toast.error(t("invalidMultiplier"));
      return;
    }

    const trimmedName = form.name.trim();
    if (!editingGroup && !trimmedName) {
      toast.error(t("nameRequired"));
      return;
    }

    startSaveTransition(async () => {
      if (editingGroup) {
        // Update
        const result = await updateProviderGroup(editingGroup.id, {
          costMultiplier,
          description: form.description || null,
        });
        if (result.ok) {
          toast.success(t("updateSuccess"));
          closeDialog();
          fetchGroups();
        } else {
          toast.error(mapSaveError(result.errorCode, result.error ?? t("updateFailed")));
        }
      } else {
        // Create
        const result = await createProviderGroup({
          name: trimmedName,
          costMultiplier,
          description: form.description || undefined,
        });
        if (result.ok) {
          toast.success(t("createSuccess"));
          closeDialog();
          fetchGroups();
        } else {
          toast.error(mapSaveError(result.errorCode, result.error ?? t("createFailed")));
        }
      }
    });
  }, [editingGroup, form, t, closeDialog, fetchGroups, mapSaveError]);

  // ---------------------------------------------------------------------------
  // Delete handlers
  // ---------------------------------------------------------------------------

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
      } else {
        // Map known error codes to localized messages.
        if (result.errorCode === "GROUP_IN_USE") {
          toast.error(t("groupInUse"));
        } else if (result.errorCode === "CANNOT_DELETE_DEFAULT") {
          toast.error(t("cannotDeleteDefault"));
        } else {
          toast.error(result.error ?? t("deleteFailed"));
        }
      }
    });
  }, [deleteTarget, t, closeDeleteConfirm, fetchGroups]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">{t("title")}</h3>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button onClick={openCreateDialog} size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          {t("addGroup")}
        </Button>
      </div>

      {/* Table */}
      {isLoading && groups.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm font-medium text-muted-foreground">{t("noGroups")}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("noGroupsDesc")}</p>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]" />
                <TableHead>{t("groupName")}</TableHead>
                <TableHead className="w-[140px]">{t("costMultiplier")}</TableHead>
                <TableHead>{t("descriptionLabel")}</TableHead>
                <TableHead className="w-[100px] text-center">{t("providerCount")}</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => {
                const isDefault = group.name === PROVIDER_GROUP.DEFAULT;
                const isExpanded = expandedGroups.has(group.id);
                const members = filterGroupMembers(providers, group.name);
                return (
                  <Fragment key={group.id}>
                    <TableRow>
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
                      <TableCell className="font-medium">
                        {group.name}
                        {isDefault && (
                          <Badge variant="secondary" className="ml-2">
                            {t("defaultGroup")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono">{group.costMultiplier}x</TableCell>
                      <TableCell className="text-muted-foreground">
                        {group.description || "-"}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {group.providerCount}
                      </TableCell>
                      <TableCell>
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
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={6} className="bg-muted/30 p-0">
                          <GroupMembersTable
                            groupName={group.name}
                            members={members}
                            onSaved={fetchGroups}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingGroup ? t("editGroup") : t("addGroup")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Name */}
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

            {/* Cost Multiplier */}
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

            {/* Description */}
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

      {/* Delete Confirmation Dialog */}
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

// ---------------------------------------------------------------------------
// Helpers & sub-components
// ---------------------------------------------------------------------------

function filterGroupMembers(providers: ProviderDisplay[], groupName: string): ProviderDisplay[] {
  return providers.filter((provider) => {
    const tags = parseProviderGroups(provider.groupTag);
    if (tags.includes(groupName)) return true;
    if (groupName === PROVIDER_GROUP.DEFAULT && tags.length === 0) return true;
    return false;
  });
}

interface GroupMembersTableProps {
  groupName: string;
  members: ProviderDisplay[];
  onSaved: () => void;
}

function GroupMembersTable({ groupName, members, onSaved }: GroupMembersTableProps) {
  const t = useTranslations("settings.providers.providerGroups");

  if (members.length === 0) {
    return (
      <div className="px-6 py-6 text-center text-sm text-muted-foreground">{t("noMembers")}</div>
    );
  }

  return (
    <div className="px-6 py-3">
      <div className="text-xs font-medium text-muted-foreground mb-2">{t("groupMembers")}</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("groupName")}</TableHead>
            <TableHead className="w-[180px]">{t("effectivePriority")}</TableHead>
            <TableHead className="w-[120px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <MemberRow key={member.id} member={member} groupName={groupName} onSaved={onSaved} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface MemberRowProps {
  member: ProviderDisplay;
  groupName: string;
  onSaved: () => void;
}

function MemberRow({ member, groupName, onSaved }: MemberRowProps) {
  const t = useTranslations("settings.providers.providerGroups");
  const effective = useMemo(() => {
    const groupPriorities = (member.groupPriorities ?? null) as Record<string, number> | null;
    return groupPriorities?.[groupName] ?? member.priority;
  }, [member.groupPriorities, member.priority, groupName]);

  const [draft, setDraft] = useState<string>(String(effective));
  const [isSaving, startSaveTransition] = useTransition();

  useEffect(() => {
    setDraft(String(effective));
  }, [effective]);

  const handleSave = useCallback(() => {
    const trimmed = draft.trim();
    const value = Number(trimmed);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      toast.error(t("savePriorityFailed"));
      return;
    }

    const existing = (member.groupPriorities ?? null) as Record<string, number> | null;
    const merged: Record<string, number> = { ...(existing ?? {}), [groupName]: value };

    startSaveTransition(async () => {
      const result = await editProvider(member.id, { group_priorities: merged });
      if (result.ok) {
        toast.success(t("savePrioritySuccess"));
        onSaved();
      } else {
        toast.error(result.error ?? t("savePriorityFailed"));
      }
    });
  }, [draft, member.groupPriorities, member.id, groupName, onSaved, t]);

  const isDirty = draft.trim() !== String(effective);

  return (
    <TableRow>
      <TableCell className="font-medium">{member.name}</TableCell>
      <TableCell>
        <Input
          type="number"
          min={0}
          step={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={isSaving}
          className="tabular-nums w-28"
          aria-label={t("effectivePriority")}
        />
      </TableCell>
      <TableCell>
        <Button size="sm" onClick={handleSave} disabled={isSaving || !isDirty}>
          {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {t("save")}
        </Button>
      </TableCell>
    </TableRow>
  );
}
