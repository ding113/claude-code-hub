"use client";

import { Loader2, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addModelGroupMember,
  removeModelGroupMember,
  updateModelGroup,
} from "@/lib/api-client/v1/actions/model-groups";
import { ModelMembersSelect } from "./model-members-select";

interface GroupItem {
  id: number;
  name: string;
  description: string | null;
  members: string[];
}

interface ManageMembersDialogProps {
  group: GroupItem;
  availableModels: string[];
  onSaved: () => void | Promise<void>;
}

export function ManageMembersDialog({ group, availableModels, onSaved }: ManageMembersDialogProps) {
  const t = useTranslations("quota.modelGroups");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [members, setMembers] = useState<string[]>(group.members);

  const resetForm = () => {
    setName(group.name);
    setDescription(group.description ?? "");
    setMembers(group.members);
  };

  const handleOpenChange = (next: boolean) => {
    if (next) resetForm();
    setOpen(next);
  };

  const handleSave = () => {
    startTransition(async () => {
      if (!name.trim()) {
        toast.error(t("nameRequired"));
        return;
      }

      const metaResult = await updateModelGroup(group.id, {
        name: name.trim(),
        description: description.trim() || null,
      });
      if (!metaResult.ok) {
        toast.error(metaResult.error || t("updateError"));
        return;
      }

      const originalMembers = new Set(group.members);
      const nextMembers = new Set(members);

      const toAdd = members.filter((m) => !originalMembers.has(m));
      const toRemove = group.members.filter((m) => !nextMembers.has(m));

      const errors: string[] = [];

      for (const model of toAdd) {
        const r = await addModelGroupMember(group.id, model);
        if (!r.ok) errors.push(`${model}: ${r.error}`);
      }

      for (const model of toRemove) {
        const r = await removeModelGroupMember(group.id, model);
        if (!r.ok) errors.push(`${model}: ${r.error}`);
      }

      if (errors.length > 0) {
        toast.error(t("memberUpdatePartialError", { errors: errors.join("; ") }));
      } else {
        toast.success(t("updateSuccess"));
      }

      setOpen(false);
      await onSaved();
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Settings2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("dialog.manageTitle", { name: group.name })}</DialogTitle>
          <DialogDescription>{t("dialog.manageDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>
              {t("dialog.name")}
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("dialog.namePlaceholder")}
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t("dialog.description")}</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("dialog.descriptionPlaceholder")}
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t("dialog.members")}</Label>
            <ModelMembersSelect
              value={members}
              onChange={setMembers}
              availableModels={availableModels}
              placeholder={t("dialog.modelPlaceholder")}
              searchPlaceholder={t("dialog.searchModel")}
              noResultsLabel={t("dialog.noModels")}
              selectedLabel={t("dialog.selectedCount", { count: members.length })}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">{t("dialog.memberConflictNote")}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            {t("dialog.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("dialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
