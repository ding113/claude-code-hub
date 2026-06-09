"use client";

import { Pencil, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import {
  createUserGroup,
  deleteUserGroup,
  updateUserGroup,
} from "@/lib/api-client/v1/actions/user-groups";

interface GroupItem {
  id: number;
  tag: string;
  name: string | null;
  description: string | null;
  memberCount?: number | null;
}

interface UserGroupClientProps {
  groups: GroupItem[];
  availableTags: string[];
}

const UNREGISTERED_SENTINEL = "__unregistered__";

export function UserGroupClient({ groups, availableTags }: UserGroupClientProps) {
  const t = useTranslations("quota.userGroups");
  const router = useRouter();

  const [createOpen, setCreateOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<GroupItem | null>(null);
  const [deleteGroup, setDeleteGroup] = useState<GroupItem | null>(null);

  const [selectedTag, setSelectedTag] = useState<string>("");
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registeredTags = new Set(groups.map((g) => g.tag));
  const unregisteredTags = availableTags.filter((tag) => !registeredTags.has(tag));

  function openCreate() {
    setSelectedTag("");
    setFormName("");
    setFormDescription("");
    setError(null);
    setCreateOpen(true);
  }

  function openEdit(group: GroupItem) {
    setFormName(group.name ?? "");
    setFormDescription(group.description ?? "");
    setError(null);
    setEditGroup(group);
  }

  async function handleCreate() {
    if (!selectedTag || selectedTag === UNREGISTERED_SENTINEL) {
      setError(t("tagRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await createUserGroup({
        tag: selectedTag,
        name: formName.trim() || null,
        description: formDescription.trim() || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCreateOpen(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit() {
    if (!editGroup) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await updateUserGroup(editGroup.id, {
        name: formName.trim() || null,
        description: formDescription.trim() || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditGroup(null);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteGroup) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await deleteUserGroup(deleteGroup.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDeleteGroup(null);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("totalCount", { count: groups.length })}</p>
        <Button onClick={openCreate} disabled={unregisteredTags.length === 0}>
          {t("createGroup")}
        </Button>
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">{t("noGroups")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <Card key={group.id} className="flex flex-col">
              <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
                <div className="space-y-1">
                  <CardTitle className="text-base">{group.name || group.tag}</CardTitle>
                  <Badge variant="secondary" className="text-xs font-mono">
                    {group.tag}
                  </Badge>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEdit(group)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => setDeleteGroup(group)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex-1 space-y-2">
                {group.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{group.description}</p>
                )}
                <div className="flex items-center gap-1.5 text-sm">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">{group.memberCount}</span>
                  <span className="text-muted-foreground">{t("members")}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createDialog.title")}</DialogTitle>
            <DialogDescription>{t("createDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-tag">{t("form.tag")}</Label>
              <Select value={selectedTag} onValueChange={setSelectedTag}>
                <SelectTrigger id="create-tag">
                  <SelectValue placeholder={t("form.tagPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {unregisteredTags.length === 0 ? (
                    <SelectItem value={UNREGISTERED_SENTINEL} disabled>
                      {t("form.noAvailableTags")}
                    </SelectItem>
                  ) : (
                    unregisteredTags.map((tag) => (
                      <SelectItem key={tag} value={tag}>
                        {tag}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-name">{t("form.name")}</Label>
              <Input
                id="create-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t("form.namePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-description">{t("form.description")}</Label>
              <Textarea
                id="create-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder={t("form.descriptionPlaceholder")}
                rows={3}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={submitting}>
              {t("form.cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={submitting}>
              {submitting ? t("form.saving") : t("form.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editGroup !== null}
        onOpenChange={(open) => {
          if (!open) setEditGroup(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("editDialog.description", { tag: editGroup?.tag ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">{t("form.name")}</Label>
              <Input
                id="edit-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t("form.namePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">{t("form.description")}</Label>
              <Textarea
                id="edit-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder={t("form.descriptionPlaceholder")}
                rows={3}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditGroup(null)} disabled={submitting}>
              {t("form.cancel")}
            </Button>
            <Button onClick={handleEdit} disabled={submitting}>
              {submitting ? t("form.saving") : t("form.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteGroup !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteGroup(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("deleteDialog.description", { tag: deleteGroup?.tag ?? "" })}
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteGroup(null)} disabled={submitting}>
              {t("form.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={submitting}>
              {submitting ? t("form.saving") : t("deleteDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
