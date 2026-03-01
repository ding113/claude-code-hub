"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { getAvailableProviderGroups } from "@/actions/providers";
import { addUser, editUser } from "@/actions/users";
import { DatePickerField } from "@/components/form/date-picker-field";
import { ArrayTagInputField, TagInputField, TextField } from "@/components/form/form-field";
import { DialogFormLayout, FormGrid } from "@/components/form/form-layout";
import { InlineWarning } from "@/components/ui/inline-warning";
import { Switch } from "@/components/ui/switch";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { USER_LIMITS } from "@/lib/constants/user.constants";
import { useZodForm } from "@/lib/hooks/use-zod-form";
import { formatDateToLocalYmd, parseYmdToLocalEndOfDay } from "@/lib/utils/date-input";
import { getErrorMessage } from "@/lib/utils/error-messages";
import { setZodErrorMap } from "@/lib/utils/zod-i18n";
import { CreateUserSchema } from "@/lib/validation/schemas";
import { AccessRestrictionsSection } from "./access-restrictions-section";

// 前端表单使用的 schema（接受字符串日期）
const UserFormSchema = CreateUserSchema.extend({
  expiresAt: z.string().optional(),
});

interface UserFormProps {
  user?: {
    id: number;
    name: string;
    note?: string;
    rpm: number | null;
    dailyQuota: number | null;
    providerGroup?: string | null;
    tags?: string[];
    limit5hUsd?: number | null;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
    limitTotalUsd?: number | null;
    limitConcurrentSessions?: number | null;
    limitConcurrentUas?: number | null;
    isEnabled?: boolean;
    expiresAt?: Date | null;
    allowedClients?: string[];
    blockedClients?: string[];
    allowedModels?: string[];
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
  const tCommon = useTranslations("common");

  // Set Zod error map for client-side validation
  useEffect(() => {
    setZodErrorMap(tErrors);
  }, [tErrors]);

  // 加载供应商分组建议
  useEffect(() => {
    getAvailableProviderGroups()
      .then(setProviderGroupSuggestions)
      .catch((err) => {
        console.error("[UserForm] Failed to load provider groups:", err);
      });
  }, []);

  const form = useZodForm({
    schema: UserFormSchema, // 使用前端表单的 schema（接受字符串日期）
    defaultValues: {
      name: user?.name || "",
      note: user?.note || "",
      rpm: user?.rpm ?? null,
      dailyQuota: user?.dailyQuota ?? null,
      providerGroup: user?.providerGroup || PROVIDER_GROUP.DEFAULT,
      tags: user?.tags || [],
      limit5hUsd: user?.limit5hUsd ?? null,
      limitWeeklyUsd: user?.limitWeeklyUsd ?? null,
      limitMonthlyUsd: user?.limitMonthlyUsd ?? null,
      limitTotalUsd: user?.limitTotalUsd ?? null,
      limitConcurrentSessions: user?.limitConcurrentSessions ?? null,
      limitConcurrentUas: user?.limitConcurrentUas ?? null,
      isEnabled: user?.isEnabled ?? true,
      expiresAt: user?.expiresAt ? formatDateToLocalYmd(user.expiresAt) : "",
      allowedClients: user?.allowedClients || [],
      blockedClients: user?.blockedClients || [],
      allowedModels: user?.allowedModels || [],
    },
    onSubmit: async (data) => {
      startTransition(async () => {
        try {
          const expiresAt = data.expiresAt ? parseYmdToLocalEndOfDay(data.expiresAt) : null;
          if (data.expiresAt && !expiresAt) {
            toast.error(tErrors("INVALID_FORMAT", { field: tErrors("EXPIRES_AT_FIELD") }));
            return;
          }

          let res;
          if (isEdit && user?.id) {
            res = await editUser(user.id, {
              name: data.name,
              note: data.note,
              rpm: data.rpm,
              dailyQuota: data.dailyQuota,
              providerGroup: data.providerGroup || PROVIDER_GROUP.DEFAULT,
              tags: data.tags,
              limit5hUsd: data.limit5hUsd,
              limitWeeklyUsd: data.limitWeeklyUsd,
              limitMonthlyUsd: data.limitMonthlyUsd,
              limitTotalUsd: data.limitTotalUsd,
              limitConcurrentSessions: data.limitConcurrentSessions,
              limitConcurrentUas: data.limitConcurrentUas,
              isEnabled: data.isEnabled,
              expiresAt,
              allowedClients: data.allowedClients,
              blockedClients: data.blockedClients,
              allowedModels: data.allowedModels,
            });
          } else {
            res = await addUser({
              name: data.name,
              note: data.note,
              rpm: data.rpm,
              dailyQuota: data.dailyQuota,
              providerGroup: data.providerGroup || PROVIDER_GROUP.DEFAULT,
              tags: data.tags,
              limit5hUsd: data.limit5hUsd,
              limitWeeklyUsd: data.limitWeeklyUsd,
              limitMonthlyUsd: data.limitMonthlyUsd,
              limitTotalUsd: data.limitTotalUsd,
              limitConcurrentSessions: data.limitConcurrentSessions,
              limitConcurrentUas: data.limitConcurrentUas,
              isEnabled: data.isEnabled,
              expiresAt,
              allowedClients: data.allowedClients,
              blockedClients: data.blockedClients,
              allowedModels: data.allowedModels,
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
  const tUserEdit = useTranslations("dashboard.userManagement.userEditSection");

  const expiresAtPastWarning = useMemo(() => {
    const expiresAtYmd = form.values.expiresAt ?? "";
    if (!expiresAtYmd) return null;
    const date = parseYmdToLocalEndOfDay(expiresAtYmd);
    if (!date) return null;
    return date.getTime() <= Date.now() ? tForm("expiresAt.pastWarning") : null;
  }, [form.values.expiresAt, tForm]);

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
        maxTagLength={200}
        placeholder={tForm("providerGroup.placeholder")}
        description={tForm("providerGroup.description")}
        suggestions={providerGroupSuggestions}
        onInvalidTag={(_tag, reason) => {
          const messages: Record<string, string> = {
            empty: tUI("emptyTag"),
            duplicate: tUI("duplicateTag"),
            too_long: tUI("tooLong", { max: 200 }),
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
          min={USER_LIMITS.DAILY_QUOTA.MIN}
          max={USER_LIMITS.DAILY_QUOTA.MAX}
          step={0.01}
          placeholder={tForm("dailyQuota.placeholder")}
          helperText={tForm("dailyQuota.helperText")}
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

          <TextField
            label={tForm("limitConcurrentUas.label")}
            type="number"
            min={0}
            max={1000}
            step={1}
            placeholder={tForm("limitConcurrentUas.placeholder")}
            {...form.getFieldProps("limitConcurrentUas")}
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
            clearLabel={tCommon("clearDate")}
            value={String(form.values.expiresAt || "")}
            onChange={(val) => form.setValue("expiresAt", val)}
            error={form.getFieldProps("expiresAt").error}
            touched={form.getFieldProps("expiresAt").touched}
          />
          {expiresAtPastWarning && <InlineWarning>{expiresAtPastWarning}</InlineWarning>}

          <AccessRestrictionsSection
            allowedClients={form.values.allowedClients || []}
            blockedClients={form.values.blockedClients || []}
            allowedModels={form.values.allowedModels || []}
            modelSuggestions={[]}
            onChange={(field, value) => form.setValue(field, value)}
            translations={{
              sections: {
                accessRestrictions: tUserEdit("sections.accessRestrictions"),
              },
              fields: {
                allowedClients: {
                  label: tUserEdit("fields.allowedClients.label"),
                  description: tUserEdit("fields.allowedClients.description"),
                  customLabel: tUserEdit("fields.allowedClients.customLabel"),
                  customPlaceholder: tUserEdit("fields.allowedClients.customPlaceholder"),
                  customHelp: tUserEdit("fields.allowedClients.customHelp"),
                },
                blockedClients: {
                  label: tUserEdit("fields.blockedClients.label"),
                  description: tUserEdit("fields.blockedClients.description"),
                  customLabel: tUserEdit("fields.blockedClients.customLabel"),
                  customPlaceholder: tUserEdit("fields.blockedClients.customPlaceholder"),
                  customHelp: tUserEdit("fields.blockedClients.customHelp"),
                },
                allowedModels: {
                  label: tUserEdit("fields.allowedModels.label"),
                  placeholder: tUserEdit("fields.allowedModels.placeholder"),
                  description: tUserEdit("fields.allowedModels.description"),
                },
              },
              actions: {
                allow: tUserEdit("actions.allow"),
                block: tUserEdit("actions.block"),
              },
              presetClients: {
                "claude-code": tUserEdit("presetClients.claude-code"),
                "gemini-cli": tUserEdit("presetClients.gemini-cli"),
                "factory-cli": tUserEdit("presetClients.factory-cli"),
                "codex-cli": tUserEdit("presetClients.codex-cli"),
              },
            }}
          />
        </>
      )}
    </DialogFormLayout>
  );
}
