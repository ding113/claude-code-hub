"use client";
import { useTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { addUser, editUser } from "@/actions/users";
import { DialogFormLayout } from "@/components/form/form-layout";
import { TextField } from "@/components/form/form-field";
import { useZodForm } from "@/lib/hooks/use-zod-form";
import { CreateUserSchema } from "@/lib/validation/schemas";
import { USER_DEFAULTS } from "@/lib/constants/user.constants";
import { toast } from "sonner";
import { setZodErrorMap } from "@/lib/utils/zod-i18n";
import { getErrorMessage } from "@/lib/utils/error-messages";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface UserFormProps {
  user?: {
    id: number;
    name: string;
    note?: string;
    rpm: number;
    dailyQuota: number;
    providerGroup?: string | null;
    tags?: string[] | null;
  };
  onSuccess?: () => void;
}

export function UserForm({ user, onSuccess }: UserFormProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const isEdit = Boolean(user?.id);

  // Tag state management
  const [tags, setTags] = useState<string[]>(user?.tags ?? []);
  const [tagInput, setTagInput] = useState("");

  // i18n translations
  const tErrors = useTranslations("errors");
  const tNotifications = useTranslations("notifications");

  // Set Zod error map for client-side validation
  useEffect(() => {
    setZodErrorMap(tErrors);
  }, [tErrors]);

  // Tag handlers
  const handleAddTag = () => {
    const trimmedTag = tagInput.trim();
    if (!trimmedTag) return;

    // Validation: max 10 tags
    if (tags.length >= 10) {
      toast.error("最多只能添加 10 个标签");
      return;
    }

    // Validation: max 20 characters
    if (trimmedTag.length > 20) {
      toast.error("标签长度不能超过 20 个字符");
      return;
    }

    // Validation: no duplicates
    if (tags.includes(trimmedTag)) {
      toast.error("该标签已存在");
      return;
    }

    setTags([...tags, trimmedTag]);
    setTagInput("");
  };

  const handleRemoveTag = (index: number) => {
    setTags(tags.filter((_, idx) => idx !== index));
  };

  const form = useZodForm({
    schema: CreateUserSchema, // Use CreateUserSchema for both, it has all fields with defaults
    defaultValues: {
      name: user?.name || "",
      note: user?.note || "",
      rpm: user?.rpm || USER_DEFAULTS.RPM,
      dailyQuota: user?.dailyQuota || USER_DEFAULTS.DAILY_QUOTA,
      providerGroup: user?.providerGroup || "",
    },
    onSubmit: async (data) => {
      startTransition(async () => {
        try {
          let res;
          if (isEdit) {
            res = await editUser(user!.id, {
              name: data.name,
              note: data.note,
              rpm: data.rpm,
              dailyQuota: data.dailyQuota,
              providerGroup: data.providerGroup || null,
              tags: tags.length > 0 ? tags : null,
            });
          } else {
            res = await addUser({
              name: data.name,
              note: data.note,
              rpm: data.rpm,
              dailyQuota: data.dailyQuota,
              providerGroup: data.providerGroup || null,
              tags: tags.length > 0 ? tags : null,
            });
          }

          if (!res.ok) {
            // Translate error code or use fallback error message
            const msg = res.errorCode
              ? getErrorMessage(tErrors, res.errorCode, res.errorParams)
              : res.error || tNotifications(isEdit ? "update_failed" : "create_failed");
            toast.error(msg);
            return;
          }

          // Show success notification
          toast.success(tNotifications(isEdit ? "user_updated" : "user_created"));
          onSuccess?.();
          router.refresh();
        } catch (err) {
          console.error(`${isEdit ? "编辑" : "添加"}用户失败:`, err);
          toast.error(tNotifications(isEdit ? "update_failed" : "create_failed"));
        }
      });
    },
  });

  // Use dashboard translations for form
  const tForm = useTranslations("dashboard.userForm");

  return (
    <DialogFormLayout
      config={{
        title: tForm(isEdit ? "title.edit" : "title.add"),
        description: tForm(isEdit ? "description.edit" : "description.add"),
        submitText: tForm(isEdit ? "submitText.edit" : "submitText.add"),
        loadingText: tForm(isEdit ? "loadingText.edit" : "loadingText.add"),
      }}
      onSubmit={form.handleSubmit}
      isSubmitting={isPending}
      canSubmit={form.canSubmit}
      error={form.errors._form}
    >
      <TextField
        label={tForm("username.label")}
        required
        maxLength={64}
        autoFocus
        placeholder={tForm("username.placeholder")}
        {...form.getFieldProps("name")}
      />

      <TextField
        label={tForm("note.label")}
        maxLength={200}
        placeholder={tForm("note.placeholder")}
        description={tForm("note.description")}
        {...form.getFieldProps("note")}
      />

      <TextField
        label={tForm("providerGroup.label")}
        maxLength={50}
        placeholder={tForm("providerGroup.placeholder")}
        description={tForm("providerGroup.description")}
        {...form.getFieldProps("providerGroup")}
      />

      {/* Tags editing section */}
      <div className="space-y-2">
        <Label htmlFor="tags">标签</Label>
        <div className="space-y-2">
          {/* Badge chips display */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag, idx) => (
                <Badge key={idx} variant="secondary" className="gap-1">
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(idx)}
                    className="ml-1 hover:text-destructive"
                    disabled={isPending}
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          )}
          {/* Input for adding new tags */}
          <div className="flex gap-2">
            <Input
              id="tags"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="输入标签名称"
              disabled={isPending}
              maxLength={20}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTag();
                }
                if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
                  handleRemoveTag(tags.length - 1);
                }
              }}
            />
            <Button
              type="button"
              onClick={handleAddTag}
              disabled={isPending || !tagInput.trim()}
              variant="outline"
            >
              添加
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {tags.length === 0
            ? "可添加最多 10 个标签，每个标签最多 20 个字符"
            : `已添加 ${tags.length}/10 个标签`}
        </p>
      </div>

      <TextField
        label={tForm("rpm.label")}
        type="number"
        required
        min={1}
        max={10000}
        placeholder={tForm("rpm.placeholder")}
        description={tForm("rpm.description", { default: USER_DEFAULTS.RPM })}
        {...form.getFieldProps("rpm")}
      />

      <TextField
        label={tForm("dailyQuota.label")}
        type="number"
        required
        min={0.01}
        max={1000}
        step={0.01}
        placeholder={tForm("dailyQuota.placeholder")}
        description={tForm("dailyQuota.description", { default: USER_DEFAULTS.DAILY_QUOTA })}
        {...form.getFieldProps("dailyQuota")}
      />
    </DialogFormLayout>
  );
}
