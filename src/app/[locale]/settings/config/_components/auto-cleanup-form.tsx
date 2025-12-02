"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { SystemSettings } from "@/types/system-config";

/**
 * 自动清理配置表单 Schema
 */
const autoCleanupSchema = z.object({
  enableAutoCleanup: z.boolean(),
  cleanupRetentionDays: z.number().int().min(1).max(365),
  cleanupSchedule: z.string().min(1),
  cleanupBatchSize: z.number().int().min(1000).max(100000),
});

type AutoCleanupFormData = z.infer<typeof autoCleanupSchema>;

interface AutoCleanupFormProps {
  settings: SystemSettings;
  onSuccess?: () => void;
}

export function AutoCleanupForm({ settings, onSuccess }: AutoCleanupFormProps) {
  const t = useTranslations("settings.config.form");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<AutoCleanupFormData>({
    resolver: zodResolver(autoCleanupSchema),
    defaultValues: {
      enableAutoCleanup: settings.enableAutoCleanup ?? false,
      cleanupRetentionDays: settings.cleanupRetentionDays ?? 30,
      cleanupSchedule: settings.cleanupSchedule ?? "0 2 * * *",
      cleanupBatchSize: settings.cleanupBatchSize ?? 10000,
    },
  });

  const enableAutoCleanup = watch("enableAutoCleanup");

  const onSubmit = async (data: AutoCleanupFormData) => {
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/admin/system-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          siteTitle: settings.siteTitle,
          allowGlobalUsageView: settings.allowGlobalUsageView,
          ...data,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t("saveFailed"));
      }

      toast.success(t("autoCleanupSaved"));
      onSuccess?.();
    } catch (error) {
      console.error("Save error:", error);
      toast.error(error instanceof Error ? error.message : t("saveError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* 启用开关 */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="enableAutoCleanup">{t("enableAutoCleanup")}</Label>
          <p className="text-sm text-muted-foreground">{t("enableAutoCleanupDesc")}</p>
        </div>
        <Switch
          id="enableAutoCleanup"
          checked={enableAutoCleanup}
          onCheckedChange={(checked) => setValue("enableAutoCleanup", checked)}
        />
      </div>

      {/* 仅在启用时显示配置项 */}
      {enableAutoCleanup && (
        <>
          {/* 保留天数 */}
          <div className="space-y-2">
            <Label htmlFor="cleanupRetentionDays">{t("cleanupRetentionDaysRequired")}</Label>
            <Input
              id="cleanupRetentionDays"
              type="number"
              min={1}
              max={365}
              {...register("cleanupRetentionDays", { valueAsNumber: true })}
              placeholder={t("cleanupRetentionDaysPlaceholder")}
            />
            {errors.cleanupRetentionDays && (
              <p className="text-sm text-destructive">{errors.cleanupRetentionDays.message}</p>
            )}
            <p className="text-xs text-muted-foreground">{t("cleanupRetentionDaysDesc")}</p>
          </div>

          {/* Cron 表达式 */}
          <div className="space-y-2">
            <Label htmlFor="cleanupSchedule">{t("cleanupScheduleRequired")}</Label>
            <Input
              id="cleanupSchedule"
              type="text"
              {...register("cleanupSchedule")}
              placeholder={t("cleanupSchedulePlaceholder")}
            />
            {errors.cleanupSchedule && (
              <p className="text-sm text-destructive">{errors.cleanupSchedule.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {t("cleanupScheduleCronDesc")}
              <br />
              {t("cleanupScheduleCronExample")}
            </p>
          </div>

          {/* 批量大小 */}
          <div className="space-y-2">
            <Label htmlFor="cleanupBatchSize">{t("cleanupBatchSizeRequired")}</Label>
            <Input
              id="cleanupBatchSize"
              type="number"
              min={1000}
              max={100000}
              {...register("cleanupBatchSize", { valueAsNumber: true })}
              placeholder={t("cleanupBatchSizePlaceholder")}
            />
            {errors.cleanupBatchSize && (
              <p className="text-sm text-destructive">{errors.cleanupBatchSize.message}</p>
            )}
            <p className="text-xs text-muted-foreground">{t("cleanupBatchSizeDesc")}</p>
          </div>
        </>
      )}

      {/* 提交按钮 */}
      <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("common.saving")}
          </>
        ) : (
          t("saveConfig")
        )}
      </Button>
    </form>
  );
}
