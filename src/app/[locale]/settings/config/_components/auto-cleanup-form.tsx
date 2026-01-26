"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Calendar, Clock, Database, Loader2, Power } from "lucide-react";
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

  const inputClassName =
    "bg-muted/50 border border-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary";

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* Enable Auto Cleanup Toggle */}
      <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between hover:bg-white/[0.04] transition-colors">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-500/10 text-red-400 shrink-0">
            <Power className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{t("enableAutoCleanup")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t("enableAutoCleanupDesc")}</p>
          </div>
        </div>
        <Switch
          id="enableAutoCleanup"
          checked={enableAutoCleanup}
          onCheckedChange={(checked) => setValue("enableAutoCleanup", checked)}
        />
      </div>

      {/* Conditional Settings */}
      {enableAutoCleanup && (
        <div className="space-y-4 pl-4 border-l border-white/10">
          {/* Retention Days */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 flex items-center justify-center rounded-md bg-blue-500/10 text-blue-400 shrink-0">
                <Calendar className="h-3.5 w-3.5" />
              </div>
              <Label htmlFor="cleanupRetentionDays" className="text-sm font-medium text-foreground">
                {t("cleanupRetentionDaysRequired")}
              </Label>
            </div>
            <Input
              id="cleanupRetentionDays"
              type="number"
              min={1}
              max={365}
              {...register("cleanupRetentionDays", { valueAsNumber: true })}
              placeholder={t("cleanupRetentionDaysPlaceholder")}
              className={inputClassName}
            />
            {errors.cleanupRetentionDays && (
              <p className="text-sm text-destructive">{errors.cleanupRetentionDays.message}</p>
            )}
            <p className="text-xs text-muted-foreground">{t("cleanupRetentionDaysDesc")}</p>
          </div>

          {/* Cron Schedule */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 flex items-center justify-center rounded-md bg-purple-500/10 text-purple-400 shrink-0">
                <Clock className="h-3.5 w-3.5" />
              </div>
              <Label htmlFor="cleanupSchedule" className="text-sm font-medium text-foreground">
                {t("cleanupScheduleRequired")}
              </Label>
            </div>
            <Input
              id="cleanupSchedule"
              type="text"
              {...register("cleanupSchedule")}
              placeholder={t("cleanupSchedulePlaceholder")}
              className={inputClassName}
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

          {/* Batch Size */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 flex items-center justify-center rounded-md bg-green-500/10 text-green-400 shrink-0">
                <Database className="h-3.5 w-3.5" />
              </div>
              <Label htmlFor="cleanupBatchSize" className="text-sm font-medium text-foreground">
                {t("cleanupBatchSizeRequired")}
              </Label>
            </div>
            <Input
              id="cleanupBatchSize"
              type="number"
              min={1000}
              max={100000}
              {...register("cleanupBatchSize", { valueAsNumber: true })}
              placeholder={t("cleanupBatchSizePlaceholder")}
              className={inputClassName}
            />
            {errors.cleanupBatchSize && (
              <p className="text-sm text-destructive">{errors.cleanupBatchSize.message}</p>
            )}
            <p className="text-xs text-muted-foreground">{t("cleanupBatchSizeDesc")}</p>
          </div>
        </div>
      )}

      {/* Submit Button */}
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("common.saving")}
            </>
          ) : (
            t("saveConfig")
          )}
        </Button>
      </div>
    </form>
  );
}
