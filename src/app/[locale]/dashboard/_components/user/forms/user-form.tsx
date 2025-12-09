"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { getAvailableProviderGroups } from "@/actions/providers";
import { addUser, editUser } from "@/actions/users";
import { DatePickerField } from "@/components/form/date-picker-field";
import { ArrayTagInputField, TagInputField, TextField } from "@/components/form/form-field";
import { DialogFormLayout, FormGrid } from "@/components/form/form-layout";
import { Switch } from "@/components/ui/switch";
import { USER_DEFAULTS, USER_LIMITS } from "@/lib/constants/user.constants";
import { useZodForm } from "@/lib/hooks/use-zod-form";
import { getErrorMessage } from "@/lib/utils/error-messages";
import { setZodErrorMap } from "@/lib/utils/zod-i18n";
import { CreateUserSchema } from "@/lib/validation/schemas";

// 前端表单使用的 schema（接受字符串日期）
const UserFormSchema = CreateUserSchema.extend({
  expiresAt: z.string().optional(),
});

interface UserFormProps {
  user?: {
    id: number;
    name: string;
    note?: string;
    rpm: number;
    dailyQuota: number;
    providerGroup?: string | null;
    tags?: string[];
    limit5hUsd?: number | null;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
    limitTotalUsd?: number | null;
    limitConcurrentSessions?: number | null;
    isEnabled?: boolean;
    expiresAt?: Date | null;
  };
  onSuccess?: () => void;
  currentUser?: {
    role: string;
  };
}

export function UserForm({ user, onSuccess, currentUser }: UserFormProps) {
  const [isPending, startTransition] = useTransition();
  const [providerGroupSuggestions, setProviderGroupSuggestions] = useState<string[]>([]);
  const router = useRouter();
  const isEdit = Boolean(user?.id);
  const isAdmin = currentUser?.role === "admin";

  // i18n translations
  const tErrors = useTranslations("errors");
  const tNotifications = useTranslations("notifications");
  const tUI = useTranslations("ui.tagInput");

  // Set Zod error map for client-side validation
  useEffect(() => {
    setZodErrorMap(tErrors);
  }, [tErrors]);

  // 加载供应商分组建议
  useEffect(() => {
    getAvailableProviderGroups().then(setProviderGroupSuggestions);
  }, []);

  const form = useZodForm({
    schema: UserFormSchema, // 使用前端表单的 schema（接受字符串日期）
    defaultValues: {
      name: user?.name || "",
      note: user?.note || "",
      rpm: user?.rpm || USER_DEFAULTS.RPM,
      dailyQuota: user?.dailyQuota || USER_DEFAULTS.DAILY_QUOTA,
      providerGroup: user?.providerGroup || "",
      tags: user?.tags || [],
      limit5hUsd: user?.limit5hUsd ?? null,
      limitWeeklyUsd: user?.limitWeeklyUsd ?? null,
      limitMonthlyUsd: user?.limitMonthlyUsd ?? null,
      limitTotalUsd: user?.limitTotalUsd ?? null,
      limitConcurrentSessions: user?.limitConcurrentSessions ?? null,
      isEnabled: user?.isEnabled ?? true,
      expiresAt: user?.expiresAt ? user.expiresAt.toISOString().split("T")[0] : "",
    },
    onSubmit: async (data) => {
      // 将纯日期转换为当天结束时间（本地时区 23:59:59.999），避免默认 UTC 零点导致提前过期
      const toEndOfDay = (dateStr: string) => {
        const d = new Date(dateStr);
        d.setHours(23, 59, 59, 999);
        return d;
      };

      startTransition(async () => {
        try {
          let res;
          if (isEdit && user?.id) {
            res = await editUser(user.id, {
              name: data.name,
              note: data.note,
              rpm: data.rpm,
              dailyQuota: data.dailyQuota,
              providerGroup: data.providerGroup || null,
              tags: data.tags,
              limit5hUsd: data.limit5hUsd,
              limitWeeklyUsd: data.limitWeeklyUsd,
              limitMonthlyUsd: data.limitMonthlyUsd,
              limitTotalUsd: data.limitTotalUsd,
              limitConcurrentSessions: data.limitConcurrentSessions,
              isEnabled: data.isEnabled,
              expiresAt: data.expiresAt ? toEndOfDay(data.expiresAt) : null,
            });
          } else {
            res = await addUser({
              name: data.name,
              note: data.note,
              rpm: data.rpm,
              dailyQuota: data.dailyQuota,
              providerGroup: data.providerGroup || null,
              tags: data.tags,
              limit5hUsd: data.limit5hUsd,
              limitWeeklyUsd: data.limitWeeklyUsd,
              limitMonthlyUsd: data.limitMonthlyUsd,
              limitTotalUsd: data.limitTotalUsd,
              limitConcurrentSessions: data.limitConcurrentSessions,
              isEnabled: data.isEnabled,
              expiresAt: data.expiresAt ? toEndOfDay(data.expiresAt) : null,
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

      <TagInputField
        label={tForm("providerGroup.label")}
        maxTagLength={50}
        placeholder={tForm("providerGroup.placeholder")}
        description={tForm("providerGroup.description")}
        suggestions={providerGroupSuggestions}
        onInvalidTag={(_tag, reason) => {
          const messages: Record<string, string> = {
            empty: tUI("emptyTag"),
            duplicate: tUI("duplicateTag"),
            too_long: tUI("tooLong", { max: 50 }),
            invalid_format: tUI("invalidFormat"),
            max_tags: tUI("maxTags"),
          };
          toast.error(messages[reason] || reason);
        }}
        value={String(form.getFieldProps("providerGroup").value)}
        onChange={form.getFieldProps("providerGroup").onChange}
        error={form.getFieldProps("providerGroup").error}
        touched={form.getFieldProps("providerGroup").touched}
      />

      <ArrayTagInputField
        label={tForm("tags.label")}
        maxTagLength={32}
        maxTags={20}
        placeholder={tForm("tags.placeholder")}
        description={tForm("tags.description")}
        onInvalidTag={(_tag, reason) => {
          const messages: Record<string, string> = {
            empty: tUI("emptyTag"),
            duplicate: tUI("duplicateTag"),
            too_long: tUI("tooLong", { max: 32 }),
            invalid_format: tUI("invalidFormat"),
            max_tags: tUI("maxTags"),
          };
          toast.error(messages[reason] || reason);
        }}
        {...form.getArrayFieldProps("tags")}
      />

      <FormGrid columns={2}>
        <TextField
          label={tForm("rpm.label")}
          type="number"
          required
          min={USER_LIMITS.RPM.MIN}
          max={USER_LIMITS.RPM.MAX}
          placeholder={tForm("rpm.placeholder")}
          {...form.getFieldProps("rpm")}
        />

        <TextField
          label={tForm("dailyQuota.label")}
          type="number"
          required
          min={USER_LIMITS.DAILY_QUOTA.MIN}
          max={USER_LIMITS.DAILY_QUOTA.MAX}
          step={0.01}
          placeholder={tForm("dailyQuota.placeholder")}
          {...form.getFieldProps("dailyQuota")}
        />
      </FormGrid>

      {/* Admin-only quota fields */}
      {isAdmin && (
        <FormGrid columns={2}>
          <TextField
            label={tForm("limit5hUsd.label")}
            type="number"
            min={0}
            max={10000}
            step={0.01}
            placeholder={tForm("limit5hUsd.placeholder")}
            {...form.getFieldProps("limit5hUsd")}
          />

          <TextField
            label={tForm("limitWeeklyUsd.label")}
            type="number"
            min={0}
            max={50000}
            step={0.01}
            placeholder={tForm("limitWeeklyUsd.placeholder")}
            {...form.getFieldProps("limitWeeklyUsd")}
          />

          <TextField
            label={tForm("limitMonthlyUsd.label")}
            type="number"
            min={0}
            max={200000}
            step={0.01}
            placeholder={tForm("limitMonthlyUsd.placeholder")}
            {...form.getFieldProps("limitMonthlyUsd")}
          />

          <TextField
            label={tForm("limitTotalUsd.label")}
            type="number"
            min={0}
            max={10000000}
            step={0.01}
            placeholder={tForm("limitTotalUsd.placeholder")}
            {...form.getFieldProps("limitTotalUsd")}
          />

          <TextField
            label={tForm("limitConcurrentSessions.label")}
            type="number"
            min={0}
            max={1000}
            step={1}
            placeholder={tForm("limitConcurrentSessions.placeholder")}
            {...form.getFieldProps("limitConcurrentSessions")}
          />
        </FormGrid>
      )}

      {/* Admin-only user status fields */}
      {isAdmin && (
        <>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label htmlFor="is-enabled" className="text-sm font-medium">
                {tForm("isEnabled.label")}
              </label>
              <p className="text-xs text-muted-foreground mt-1">{tForm("isEnabled.description")}</p>
            </div>
            <Switch
              id="is-enabled"
              checked={form.values.isEnabled ?? true}
              onCheckedChange={(checked) => form.setValue("isEnabled", checked)}
            />
          </div>

          <DatePickerField
            label={tForm("expiresAt.label")}
            placeholder={tForm("expiresAt.placeholder")}
            description={tForm("expiresAt.description")}
            value={String(form.values.expiresAt || "")}
            onChange={(val) => form.setValue("expiresAt", val)}
            error={form.getFieldProps("expiresAt").error}
            touched={form.getFieldProps("expiresAt").touched}
          />
        </>
      )}
    </DialogFormLayout>
  );
}
