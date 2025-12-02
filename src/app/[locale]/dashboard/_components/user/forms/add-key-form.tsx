"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { addKey } from "@/actions/keys";
import { DateField, NumberField, TextField } from "@/components/form/form-field";
import { DialogFormLayout, FormGrid } from "@/components/form/form-layout";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useZodForm } from "@/lib/hooks/use-zod-form";
import { KeyFormSchema } from "@/lib/validation/schemas";
import type { User } from "@/types/user";

interface AddKeyFormProps {
  userId?: number;
  user?: User;
  onSuccess?: (result: { generatedKey: string; name: string }) => void;
}

export function AddKeyForm({ userId, user, onSuccess }: AddKeyFormProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const t = useTranslations("dashboard.addKeyForm");

  const form = useZodForm({
    schema: KeyFormSchema,
    defaultValues: {
      name: "",
      expiresAt: "",
      canLoginWebUi: true,
      limit5hUsd: null,
      limitDailyUsd: null,
      dailyResetMode: "fixed" as const,
      dailyResetTime: "00:00",
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
      limitConcurrentSessions: 0,
    },
    onSubmit: async (data) => {
      if (!userId) {
        throw new Error(t("errors.userIdMissing"));
      }

      try {
        const result = await addKey({
          userId: userId!,
          name: data.name,
          expiresAt: data.expiresAt || undefined,
          canLoginWebUi: data.canLoginWebUi,
          limit5hUsd: data.limit5hUsd,
          limitDailyUsd: data.limitDailyUsd,
          dailyResetMode: data.dailyResetMode,
          dailyResetTime: data.dailyResetTime,
          limitWeeklyUsd: data.limitWeeklyUsd,
          limitMonthlyUsd: data.limitMonthlyUsd,
          limitTotalUsd: data.limitTotalUsd,
          limitConcurrentSessions: data.limitConcurrentSessions,
        });

        if (!result.ok) {
          toast.error(result.error || t("errors.createFailed"));
          return;
        }

        const payload = result.data;
        if (!payload) {
          toast.error(t("errors.noKeyReturned"));
          return;
        }

        startTransition(() => {
          onSuccess?.({ generatedKey: payload.generatedKey, name: payload.name });
          router.refresh();
        });
      } catch (err) {
        console.error("添加Key失败:", err);
        // 使用toast显示具体的错误信息
        const errorMessage = err instanceof Error ? err.message : t("errors.createFailed");
        toast.error(errorMessage);
      }
    },
  });

  return (
    <DialogFormLayout
      config={{
        title: t("title"),
        description: t("description"),
        submitText: t("submitText"),
        loadingText: t("loadingText"),
      }}
      onSubmit={form.handleSubmit}
      isSubmitting={isPending}
      canSubmit={form.canSubmit && !!userId}
      error={form.errors._form}
    >
      <TextField
        label={t("keyName.label")}
        required
        maxLength={64}
        autoFocus
        placeholder={t("keyName.placeholder")}
        {...form.getFieldProps("name")}
      />

      <DateField
        label={t("expiresAt.label")}
        placeholder={t("expiresAt.placeholder")}
        description={t("expiresAt.description")}
        {...form.getFieldProps("expiresAt")}
      />

      <div className="flex items-start justify-between gap-4 rounded-lg border border-dashed border-border px-4 py-3">
        <div>
          <Label htmlFor="can-login-web-ui" className="text-sm font-medium">
            {t("canLoginWebUi.label")}
          </Label>
          <p className="text-xs text-muted-foreground mt-1">{t("canLoginWebUi.description")}</p>
        </div>
        <Switch
          id="can-login-web-ui"
          checked={form.values.canLoginWebUi}
          onCheckedChange={(checked) => form.setValue("canLoginWebUi", checked)}
        />
      </div>

      <FormGrid columns={2}>
        <NumberField
          label={t("limit5hUsd.label")}
          placeholder={t("limit5hUsd.placeholder")}
          description={
            user?.limit5hUsd
              ? t("limit5hUsd.descriptionWithUserLimit", { limit: user.limit5hUsd })
              : t("limit5hUsd.description")
          }
          min={0}
          step={0.01}
          {...form.getFieldProps("limit5hUsd")}
        />

        <NumberField
          label={t("limitDailyUsd.label")}
          placeholder={t("limitDailyUsd.placeholder")}
          description={t("limitDailyUsd.description")}
          min={0}
          step={0.01}
          {...form.getFieldProps("limitDailyUsd")}
        />
      </FormGrid>

      <FormGrid columns={2}>
        <div className="space-y-2">
          <Label htmlFor="daily-reset-mode">{t("dailyResetMode.label")}</Label>
          <Select
            value={form.values.dailyResetMode}
            onValueChange={(value: "fixed" | "rolling") => form.setValue("dailyResetMode", value)}
            disabled={isPending}
          >
            <SelectTrigger id="daily-reset-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">{t("dailyResetMode.options.fixed")}</SelectItem>
              <SelectItem value="rolling">{t("dailyResetMode.options.rolling")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {form.values.dailyResetMode === "fixed"
              ? t("dailyResetMode.desc.fixed")
              : t("dailyResetMode.desc.rolling")}
          </p>
        </div>

        {form.values.dailyResetMode === "fixed" && (
          <TextField
            label={t("dailyResetTime.label")}
            placeholder={t("dailyResetTime.placeholder")}
            description={t("dailyResetTime.description")}
            type="time"
            step={60}
            {...form.getFieldProps("dailyResetTime")}
          />
        )}
      </FormGrid>

      <FormGrid columns={2}>
        <NumberField
          label={t("limitWeeklyUsd.label")}
          placeholder={t("limitWeeklyUsd.placeholder")}
          description={
            user?.limitWeeklyUsd
              ? t("limitWeeklyUsd.descriptionWithUserLimit", { limit: user.limitWeeklyUsd })
              : t("limitWeeklyUsd.description")
          }
          min={0}
          step={0.01}
          {...form.getFieldProps("limitWeeklyUsd")}
        />

        <NumberField
          label={t("limitMonthlyUsd.label")}
          placeholder={t("limitMonthlyUsd.placeholder")}
          description={
            user?.limitMonthlyUsd
              ? t("limitMonthlyUsd.descriptionWithUserLimit", { limit: user.limitMonthlyUsd })
              : t("limitMonthlyUsd.description")
          }
          min={0}
          step={0.01}
          {...form.getFieldProps("limitMonthlyUsd")}
        />

        <NumberField
          label={t("limitTotalUsd.label")}
          placeholder={t("limitTotalUsd.placeholder")}
          description={
            user?.limitTotalUsd
              ? t("limitTotalUsd.descriptionWithUserLimit", { limit: user.limitTotalUsd })
              : t("limitTotalUsd.description")
          }
          min={0}
          max={10000000}
          step={0.01}
          {...form.getFieldProps("limitTotalUsd")}
        />

        <NumberField
          label={t("limitConcurrentSessions.label")}
          placeholder={t("limitConcurrentSessions.placeholder")}
          description={
            user?.limitConcurrentSessions
              ? t("limitConcurrentSessions.descriptionWithUserLimit", {
                  limit: user.limitConcurrentSessions,
                })
              : t("limitConcurrentSessions.description")
          }
          min={0}
          step={1}
          {...form.getFieldProps("limitConcurrentSessions")}
        />
      </FormGrid>
    </DialogFormLayout>
  );
}
