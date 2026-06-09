"use client";

import { Loader2 } from "lucide-react";
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
import { addModelGroupMember, createModelGroup } from "@/lib/api-client/v1/actions/model-groups";
import { ModelMembersSelect } from "./model-members-select";

interface CreateModelGroupDialogProps {
  availableModels: string[];
  onSaved: () => void | Promise<void>;
  trigger?: React.ReactNode;
}

export function CreateModelGroupDialog({
  availableModels,
  onSaved,
  trigger,
}: CreateModelGroupDialogProps) {
  const t = useTranslations("quota.modelGroups");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState<string[]>([]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setMembers([]);
  };

  const handleOpenChange = (next: boolean) => {
    if (next) resetForm();
    setOpen(next);
  };

  const handleSubmit = () => {
    startTransition(async () => {
      if (!name.trim()) {
        toast.error(t("nameRequired"));
        return;
      }

      const result = await createModelGroup({
        name: name.trim(),
        description: description.trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error || t("createError"));
        return;
      }

      const errors: string[] = [];
      for (const model of members) {
        const r = await addModelGroupMember(result.data.id, model);
        if (!r.ok) errors.push(`${model}: ${r.error}`);
      }

      if (errors.length > 0) {
        toast.error(t("memberUpdatePartialError", { errors: errors.join("; ") }));
      } else {
        toast.success(t("createSuccess"));
      }

      setOpen(false);
      await onSaved();
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button size="sm">{t("addGroup")}</Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("dialog.addTitle")}</DialogTitle>
          <DialogDescription>{t("dialog.addDescription")}</DialogDescription>
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
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("dialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
