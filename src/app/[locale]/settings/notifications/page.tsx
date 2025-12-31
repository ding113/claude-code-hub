"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Bell, Loader2, TestTube, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  getNotificationSettingsAction,
  testWebhookAction,
  updateNotificationSettingsAction,
} from "@/actions/notifications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { NotificationJobType } from "@/lib/constants/notification.constants";

/**
 * 通知设置表单 Schema
 */
const notificationSchema = z.object({
  enabled: z.boolean(),

  // 熔断器告警
  circuitBreakerEnabled: z.boolean(),
  circuitBreakerWebhook: z.string().optional(),

  // 每日排行榜
  dailyLeaderboardEnabled: z.boolean(),
  dailyLeaderboardWebhook: z.string().optional(),
  dailyLeaderboardTime: z.string().regex(/^\d{2}:\d{2}$/, "时间格式错误，应为 HH:mm"),
  dailyLeaderboardTopN: z.number().int().min(1).max(20),

  // 成本预警
  costAlertEnabled: z.boolean(),
  costAlertWebhook: z.string().optional(),
  costAlertThreshold: z.number().min(0.5).max(1.0),
  costAlertCheckInterval: z.number().int().min(10).max(1440),
});

type NotificationFormData = z.infer<typeof notificationSchema>;

export default function NotificationsPage() {
  const t = useTranslations("settings");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState<NotificationJobType | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<NotificationFormData>({
    resolver: zodResolver(notificationSchema),
  });

  const enabled = watch("enabled");
  const circuitBreakerEnabled = watch("circuitBreakerEnabled");
  const dailyLeaderboardEnabled = watch("dailyLeaderboardEnabled");
  const costAlertEnabled = watch("costAlertEnabled");
  const costAlertThreshold = watch("costAlertThreshold");
  const costAlertWebhook = watch("costAlertWebhook");
  const circuitBreakerWebhook = watch("circuitBreakerWebhook");
  const dailyLeaderboardWebhook = watch("dailyLeaderboardWebhook");

  // Detect webhook platform type from URL
  const detectWebhookType = useCallback((url: string | undefined): "wechat" | "feishu" | null => {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.hostname === "qyapi.weixin.qq.com") return "wechat";
      if (parsed.hostname === "open.feishu.cn") return "feishu";
      return null;
    } catch {
      return null;
    }
  }, []);

  const costAlertWebhookType = useMemo(
    () => detectWebhookType(costAlertWebhook),
    [costAlertWebhook, detectWebhookType]
  );
  const circuitBreakerWebhookType = useMemo(
    () => detectWebhookType(circuitBreakerWebhook),
    [circuitBreakerWebhook, detectWebhookType]
  );
  const dailyLeaderboardWebhookType = useMemo(
    () => detectWebhookType(dailyLeaderboardWebhook),
    [dailyLeaderboardWebhook, detectWebhookType]
  );

  const loadSettings = useCallback(async () => {
    try {
      const data = await getNotificationSettingsAction();

      // 设置表单默认值
      setValue("enabled", data.enabled);
      setValue("circuitBreakerEnabled", data.circuitBreakerEnabled);
      setValue("circuitBreakerWebhook", data.circuitBreakerWebhook || "");
      setValue("dailyLeaderboardEnabled", data.dailyLeaderboardEnabled);
      setValue("dailyLeaderboardWebhook", data.dailyLeaderboardWebhook || "");
      setValue("dailyLeaderboardTime", data.dailyLeaderboardTime || "09:00");
      setValue("dailyLeaderboardTopN", data.dailyLeaderboardTopN || 5);
      setValue("costAlertEnabled", data.costAlertEnabled);
      setValue("costAlertWebhook", data.costAlertWebhook || "");
      setValue("costAlertThreshold", parseFloat(data.costAlertThreshold || "0.80"));
      setValue("costAlertCheckInterval", data.costAlertCheckInterval || 60);
    } catch (error) {
      toast.error(t("notifications.form.loadError"));
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [setValue, t]);

  // 加载设置
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const onSubmit = async (data: NotificationFormData) => {
    setIsSubmitting(true);

    try {
      const result = await updateNotificationSettingsAction({
        enabled: data.enabled,
        circuitBreakerEnabled: data.circuitBreakerEnabled,
        circuitBreakerWebhook: data.circuitBreakerWebhook || null,
        dailyLeaderboardEnabled: data.dailyLeaderboardEnabled,
        dailyLeaderboardWebhook: data.dailyLeaderboardWebhook || null,
        dailyLeaderboardTime: data.dailyLeaderboardTime,
        dailyLeaderboardTopN: data.dailyLeaderboardTopN,
        costAlertEnabled: data.costAlertEnabled,
        costAlertWebhook: data.costAlertWebhook || null,
        costAlertThreshold: data.costAlertThreshold.toString(),
        costAlertCheckInterval: data.costAlertCheckInterval,
      });

      if (result.success) {
        toast.success(t("notifications.form.success"));
        loadSettings();
      } else {
        toast.error(result.error || t("notifications.form.saveFailed"));
      }
    } catch (error) {
      console.error("Save error:", error);
      toast.error(t("notifications.form.saveFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTestWebhook = async (webhookUrl: string, type: NotificationJobType) => {
    if (!webhookUrl || !webhookUrl.trim()) {
      toast.error(t("notifications.form.webhookRequired"));
      return;
    }

    setTestingWebhook(type);

    try {
      const result = await testWebhookAction(webhookUrl, type);

      if (result.success) {
        toast.success(t("notifications.form.testSuccess"));
      } else {
        toast.error(result.error || t("notifications.form.testFailed"));
      }
    } catch (error) {
      console.error("Test error:", error);
      toast.error(t("notifications.form.testError"));
    } finally {
      setTestingWebhook(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("notifications.title")}</h1>
        <p className="text-muted-foreground mt-2">{t("notifications.description")}</p>
      </div>

      {isLoading ? (
        <NotificationsSkeleton label={t("common.loading")} />
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* 全局开关 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5" />
                {t("notifications.global.title")}
              </CardTitle>
              <CardDescription>{t("notifications.global.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <Label htmlFor="enabled">{t("notifications.global.enable")}</Label>
                <Switch
                  id="enabled"
                  checked={enabled}
                  onCheckedChange={(checked) => setValue("enabled", checked)}
                />
              </div>
            </CardContent>
          </Card>

          {/* 熔断器告警配置 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                {t("notifications.circuitBreaker.title")}
              </CardTitle>
              <CardDescription>{t("notifications.circuitBreaker.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="circuitBreakerEnabled">
                  {t("notifications.circuitBreaker.enable")}
                </Label>
                <Switch
                  id="circuitBreakerEnabled"
                  checked={circuitBreakerEnabled}
                  disabled={!enabled}
                  onCheckedChange={(checked) => setValue("circuitBreakerEnabled", checked)}
                />
              </div>

              {circuitBreakerEnabled && (
                <div className="space-y-4 pt-4">
                  <Separator />
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="circuitBreakerWebhook">
                        {t("notifications.circuitBreaker.webhook")}
                      </Label>
                      {circuitBreakerWebhookType && (
                        <Badge variant="secondary">
                          {circuitBreakerWebhookType === "wechat"
                            ? t("notifications.costAlert.webhookTypeWeCom")
                            : t("notifications.costAlert.webhookTypeFeishu")}
                        </Badge>
                      )}
                    </div>
                    <Input
                      id="circuitBreakerWebhook"
                      {...register("circuitBreakerWebhook")}
                      placeholder={t("notifications.circuitBreaker.webhookPlaceholder")}
                      disabled={!enabled}
                    />
                    {errors.circuitBreakerWebhook && (
                      <p className="text-sm text-red-500">{errors.circuitBreakerWebhook.message}</p>
                    )}
                    {circuitBreakerWebhook && !circuitBreakerWebhookType && (
                      <p className="text-sm text-amber-500">
                        {t("notifications.costAlert.webhookTypeUnknown")}
                      </p>
                    )}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!enabled || testingWebhook === "circuit-breaker"}
                    onClick={() =>
                      handleTestWebhook(watch("circuitBreakerWebhook") || "", "circuit-breaker")
                    }
                  >
                    {testingWebhook === "circuit-breaker" ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {t("common.testing")}
                      </>
                    ) : (
                      <>
                        <TestTube className="w-4 h-4 mr-2" />
                        {t("notifications.circuitBreaker.test")}
                      </>
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 每日排行榜配置 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-600" />
                {t("notifications.dailyLeaderboard.title")}
              </CardTitle>
              <CardDescription>{t("notifications.dailyLeaderboard.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="dailyLeaderboardEnabled">
                  {t("notifications.dailyLeaderboard.enable")}
                </Label>
                <Switch
                  id="dailyLeaderboardEnabled"
                  checked={dailyLeaderboardEnabled}
                  disabled={!enabled}
                  onCheckedChange={(checked) => setValue("dailyLeaderboardEnabled", checked)}
                />
              </div>

              {dailyLeaderboardEnabled && (
                <div className="space-y-4 pt-4">
                  <Separator />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="dailyLeaderboardWebhook">
                          {t("notifications.dailyLeaderboard.webhook")}
                        </Label>
                        {dailyLeaderboardWebhookType && (
                          <Badge variant="secondary">
                            {dailyLeaderboardWebhookType === "wechat"
                              ? t("notifications.costAlert.webhookTypeWeCom")
                              : t("notifications.costAlert.webhookTypeFeishu")}
                          </Badge>
                        )}
                      </div>
                      <Input
                        id="dailyLeaderboardWebhook"
                        {...register("dailyLeaderboardWebhook")}
                        placeholder={t("notifications.dailyLeaderboard.webhookPlaceholder")}
                        disabled={!enabled}
                      />
                      {errors.dailyLeaderboardWebhook && (
                        <p className="text-sm text-red-500">
                          {errors.dailyLeaderboardWebhook.message}
                        </p>
                      )}
                      {dailyLeaderboardWebhook && !dailyLeaderboardWebhookType && (
                        <p className="text-sm text-amber-500">
                          {t("notifications.costAlert.webhookTypeUnknown")}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="dailyLeaderboardTime">
                        {t("notifications.dailyLeaderboard.time")}
                      </Label>
                      <Input
                        id="dailyLeaderboardTime"
                        type="time"
                        {...register("dailyLeaderboardTime")}
                        disabled={!enabled}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="dailyLeaderboardTopN">
                        {t("notifications.dailyLeaderboard.topN")}
                      </Label>
                      <Input
                        id="dailyLeaderboardTopN"
                        type="number"
                        min={1}
                        max={20}
                        {...register("dailyLeaderboardTopN", { valueAsNumber: true })}
                        disabled={!enabled}
                      />
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!enabled || testingWebhook === "daily-leaderboard"}
                    onClick={() =>
                      handleTestWebhook(watch("dailyLeaderboardWebhook") || "", "daily-leaderboard")
                    }
                  >
                    {testingWebhook === "daily-leaderboard" ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {t("common.testing")}
                      </>
                    ) : (
                      <>
                        <TestTube className="w-4 h-4 mr-2" />
                        {t("notifications.dailyLeaderboard.test")}
                      </>
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 成本预警配置 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-orange-500" />
                {t("notifications.costAlert.title")}
              </CardTitle>
              <CardDescription>{t("notifications.costAlert.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="costAlertEnabled">{t("notifications.costAlert.enable")}</Label>
                <Switch
                  id="costAlertEnabled"
                  checked={costAlertEnabled}
                  disabled={!enabled}
                  onCheckedChange={(checked) => setValue("costAlertEnabled", checked)}
                />
              </div>

              {costAlertEnabled && (
                <div className="space-y-4 pt-4">
                  <Separator />
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="costAlertWebhook">
                        {t("notifications.costAlert.webhook")}
                      </Label>
                      {costAlertWebhookType && (
                        <Badge variant="secondary">
                          {costAlertWebhookType === "wechat"
                            ? t("notifications.costAlert.webhookTypeWeCom")
                            : t("notifications.costAlert.webhookTypeFeishu")}
                        </Badge>
                      )}
                    </div>
                    <Input
                      id="costAlertWebhook"
                      {...register("costAlertWebhook")}
                      placeholder={t("notifications.costAlert.webhookPlaceholder")}
                      disabled={!enabled}
                    />
                    {errors.costAlertWebhook && (
                      <p className="text-sm text-red-500">{errors.costAlertWebhook.message}</p>
                    )}
                    {costAlertWebhook && !costAlertWebhookType && (
                      <p className="text-sm text-amber-500">
                        {t("notifications.costAlert.webhookTypeUnknown")}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>{t("notifications.costAlert.threshold")}</Label>
                    <div className="flex items-center gap-4">
                      <Slider
                        value={[costAlertThreshold]}
                        min={0.5}
                        max={1}
                        step={0.05}
                        onValueChange={([value]) => setValue("costAlertThreshold", value)}
                        disabled={!enabled}
                        className="flex-1"
                      />
                      <span className="w-12 text-right text-sm font-medium">
                        {(costAlertThreshold * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="costAlertCheckInterval">
                      {t("notifications.costAlert.interval")}
                    </Label>
                    <Input
                      id="costAlertCheckInterval"
                      type="number"
                      min={10}
                      max={1440}
                      {...register("costAlertCheckInterval", { valueAsNumber: true })}
                      disabled={!enabled}
                    />
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!enabled || testingWebhook === "cost-alert"}
                    onClick={() => handleTestWebhook(watch("costAlertWebhook") || "", "cost-alert")}
                  >
                    {testingWebhook === "cost-alert" ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {t("common.testing")}
                      </>
                    ) : (
                      <>
                        <TestTube className="w-4 h-4 mr-2" />
                        {t("notifications.costAlert.test")}
                      </>
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("notifications.form.saving") : t("notifications.form.save")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function NotificationsSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-6" aria-busy="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <Card key={index}>
          <CardHeader>
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-40" />
          </CardContent>
        </Card>
      ))}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>{label}</span>
      </div>
    </div>
  );
}
