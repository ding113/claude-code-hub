"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { editKey } from "@/actions/keys";
import { DialogFormLayout } from "@/components/form/form-layout";
import { TextField, DateField, NumberField } from "@/components/form/form-field";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useZodForm } from "@/lib/hooks/use-zod-form";
import { KeyFormSchema } from "@/lib/validation/schemas";
import { toast } from "sonner";

interface EditKeyFormProps {
  keyData?: {
    id: number;
    name: string;
    expiresAt: string;
    canLoginWebUi?: boolean;
    limit5hUsd?: number | null;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
    limitConcurrentSessions?: number;
  };
  onSuccess?: () => void;
}

export function EditKeyForm({ keyData, onSuccess }: EditKeyFormProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const formatExpiresAt = (expiresAt: string) => {
    if (!expiresAt || expiresAt === "永不过期") return "";
    try {
      return new Date(expiresAt).toISOString().split("T")[0];
    } catch {
      return "";
    }
  };

  const form = useZodForm({
    schema: KeyFormSchema,
    defaultValues: {
      name: keyData?.name || "",
      expiresAt: formatExpiresAt(keyData?.expiresAt || ""),
      canLoginWebUi: keyData?.canLoginWebUi ?? true,
      limit5hUsd: keyData?.limit5hUsd ?? null,
      limitWeeklyUsd: keyData?.limitWeeklyUsd ?? null,
      limitMonthlyUsd: keyData?.limitMonthlyUsd ?? null,
      limitConcurrentSessions: keyData?.limitConcurrentSessions ?? 0,
    },
    onSubmit: async (data) => {
      if (!keyData) {
        throw new Error("密钥信息不存在");
      }

      startTransition(async () => {
        try {
          const res = await editKey(keyData.id, {
            name: data.name,
            expiresAt: data.expiresAt || undefined,
            canLoginWebUi: data.canLoginWebUi,
            limit5hUsd: data.limit5hUsd,
            limitWeeklyUsd: data.limitWeeklyUsd,
            limitMonthlyUsd: data.limitMonthlyUsd,
            limitConcurrentSessions: data.limitConcurrentSessions,
          });
          if (!res.ok) {
            toast.error(res.error || "保存失败");
            return;
          }
          onSuccess?.();
          router.refresh();
        } catch (err) {
          console.error("编辑Key失败:", err);
          toast.error("保存失败，请稍后重试");
        }
      });
    },
  });

  return (
    <DialogFormLayout
      config={{
        title: "编辑 Key",
        description: "修改密钥的名称、过期时间和限流配置。",
        submitText: "保存修改",
        loadingText: "保存中...",
      }}
      onSubmit={form.handleSubmit}
      isSubmitting={isPending}
      canSubmit={form.canSubmit}
      error={form.errors._form}
    >
      <TextField
        label="Key名称"
        required
        maxLength={64}
        autoFocus
        placeholder="请输入Key名称"
        {...form.getFieldProps("name")}
      />

      <DateField
        label="过期时间"
        placeholder="选择过期时间"
        description="留空表示永不过期"
        {...form.getFieldProps("expiresAt")}
      />

      <div className="flex items-start justify-between gap-4 rounded-lg border border-dashed border-border px-4 py-3">
        <div>
          <Label htmlFor="can-login-web-ui" className="text-sm font-medium">
            允许登录 Web UI
          </Label>
          <p className="text-xs text-muted-foreground mt-1">
            关闭后，此 Key 仅可用于 API 调用，无法登录管理后台
          </p>
        </div>
        <Switch
          id="can-login-web-ui"
          checked={form.values.canLoginWebUi}
          onCheckedChange={(checked) => form.setValue("canLoginWebUi", checked)}
        />
      </div>

      <NumberField
        label="5小时消费上限 (USD)"
        placeholder="留空表示无限制"
        description="5小时内最大消费金额"
        min={0}
        step={0.01}
        {...form.getFieldProps("limit5hUsd")}
      />

      <NumberField
        label="周消费上限 (USD)"
        placeholder="留空表示无限制"
        description="每周最大消费金额"
        min={0}
        step={0.01}
        {...form.getFieldProps("limitWeeklyUsd")}
      />

      <NumberField
        label="月消费上限 (USD)"
        placeholder="留空表示无限制"
        description="每月最大消费金额"
        min={0}
        step={0.01}
        {...form.getFieldProps("limitMonthlyUsd")}
      />

      <NumberField
        label="并发 Session 上限"
        placeholder="0 表示无限制"
        description="同时运行的对话数量"
        min={0}
        step={1}
        {...form.getFieldProps("limitConcurrentSessions")}
      />
    </DialogFormLayout>
  );
}
