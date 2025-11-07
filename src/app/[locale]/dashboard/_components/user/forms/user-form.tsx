"use client";
import { useTransition, useEffect } from "react";
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

interface UserFormProps {
  user?: {
    id: number;
    name: string;
    note?: string;
    rpm: number;
    dailyQuota: number;
    providerGroup?: string | null;
  };
  onSuccess?: () => void;
}

export function UserForm({ user, onSuccess }: UserFormProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const isEdit = Boolean(user?.id);

  // i18n translations
  const tErrors = useTranslations("errors");
  const tNotifications = useTranslations("notifications");

  // Set Zod error map for client-side validation
  useEffect(() => {
    setZodErrorMap(tErrors);
  }, [tErrors]);

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
            });
          } else {
            res = await addUser({
              name: data.name,
              note: data.note,
              rpm: data.rpm,
              dailyQuota: data.dailyQuota,
              providerGroup: data.providerGroup || null,
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

  return (
    <DialogFormLayout
      config={{
        title: isEdit ? "编辑用户" : "新增用户",
        description: isEdit ? "修改用户的基本信息。" : "创建新用户，系统将自动为其生成默认密钥。",
        submitText: isEdit ? "保存修改" : "确认创建",
        loadingText: isEdit ? "保存中..." : "创建中...",
      }}
      onSubmit={form.handleSubmit}
      isSubmitting={isPending}
      canSubmit={form.canSubmit}
      error={form.errors._form}
    >
      <TextField
        label="用户名"
        required
        maxLength={64}
        autoFocus
        placeholder="请输入用户名"
        {...form.getFieldProps("name")}
      />

      <TextField
        label="备注"
        maxLength={200}
        placeholder="请输入备注（可选）"
        description="用于描述用户的用途或备注信息"
        {...form.getFieldProps("note")}
      />

      <TextField
        label="供应商分组"
        maxLength={50}
        placeholder="例如: premium 或 premium,economy（可选）"
        description="指定用户专属的供应商分组（支持多个，逗号分隔）。系统将只从 groupTag 匹配的供应商中选择。留空=使用所有供应商"
        {...form.getFieldProps("providerGroup")}
      />

      <TextField
        label="RPM限制"
        type="number"
        required
        min={1}
        max={10000}
        placeholder="每分钟请求数限制"
        description={`默认值: ${USER_DEFAULTS.RPM}，范围: 1-10000`}
        {...form.getFieldProps("rpm")}
      />

      <TextField
        label="每日额度"
        type="number"
        required
        min={0.01}
        max={1000}
        step={0.01}
        placeholder="每日消费额度限制"
        description={`默认值: $${USER_DEFAULTS.DAILY_QUOTA}，范围: $0.01-$1000`}
        {...form.getFieldProps("dailyQuota")}
      />
    </DialogFormLayout>
  );
}
