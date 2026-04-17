"use client";

import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ProviderGroupWithCount } from "@/actions/provider-groups";
import {
  createProviderGroup,
  deleteProviderGroup,
  getProviderGroups,
  updateProviderGroup,
} from "@/actions/provider-groups";
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
      const result = await getProviderGroups();
      if (result.ok) {
        setGroups(result.data);
      } else {
        toast.error(result.error);
      }
    });
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

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

  const handleSave = useCallback(() => {
    const costMultiplier = Number.parseFloat(form.costMultiplier);
    if (!Number.isFinite(costMultiplier) || costMultiplier < 0) {
      toast.error(t("invalidMultiplier"));
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
          toast.error(result.error ?? t("updateFailed"));
        }
      } else {
        // Create
        if (!form.name.trim()) {
          toast.error(t("nameRequired"));
          return;
        }
        const result = await createProviderGroup({
          name: form.name.trim(),
          costMultiplier,
          description: form.description || undefined,
        });
        if (result.ok) {
          toast.success(t("createSuccess"));
          closeDialog();
          fetchGroups();
        } else {
          toast.error(result.error ?? t("createFailed"));
        }
      }
    });
  }, [editingGroup, form, t, closeDialog, fetchGroups]);

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
                <TableHead>{t("groupName")}</TableHead>
                <TableHead className="w-[140px]">{t("costMultiplier")}</TableHead>
                <TableHead>{t("descriptionLabel")}</TableHead>
                <TableHead className="w-[100px] text-center">{t("providerCount")}</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => {
                const isDefault = group.name === "default";
                return (
                  <TableRow key={group.id}>
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
