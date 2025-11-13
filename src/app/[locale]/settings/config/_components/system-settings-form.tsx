"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveSystemSettings } from "@/actions/system-config";
import { toast } from "sonner";
import { CURRENCY_CONFIG } from "@/lib/utils";
import type { SystemSettings } from "@/types/system-config";
import type { CurrencyCode } from "@/lib/utils";

type CrossGroupConfigSource = "database" | "environment" | "default";

interface SystemSettingsFormProps {
  initialSettings: Pick<
    SystemSettings,
    "siteTitle" | "allowGlobalUsageView" | "currencyDisplay" | "allowCrossGroupOnDegrade"
  > & {
    crossGroupConfigSource: CrossGroupConfigSource;
  };
}

export function SystemSettingsForm({ initialSettings }: SystemSettingsFormProps) {
  const t = useTranslations("settings.config.form");
  const [siteTitle, setSiteTitle] = useState(initialSettings.siteTitle);
  const [allowGlobalUsageView, setAllowGlobalUsageView] = useState(
    initialSettings.allowGlobalUsageView
  );
  const [currencyDisplay, setCurrencyDisplay] = useState<CurrencyCode>(
    initialSettings.currencyDisplay
  );
  const [allowCrossGroupOnDegrade, setAllowCrossGroupOnDegrade] = useState(
    initialSettings.allowCrossGroupOnDegrade
  );
  const [crossGroupConfigSource, setCrossGroupConfigSource] = useState<CrossGroupConfigSource>(
    initialSettings.crossGroupConfigSource
  );
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!siteTitle.trim()) {
      toast.error(t("siteTitleRequired"));
      return;
    }

    startTransition(async () => {
      const result = await saveSystemSettings({
        siteTitle,
        allowGlobalUsageView,
        allowCrossGroupOnDegrade,
        currencyDisplay,
      });

      if (!result.ok) {
        toast.error(result.error || t("saveFailed"));
        return;
      }

      if (result.data) {
        setSiteTitle(result.data.siteTitle);
        setAllowGlobalUsageView(result.data.allowGlobalUsageView);
        setCurrencyDisplay(result.data.currencyDisplay);
        setAllowCrossGroupOnDegrade(result.data.allowCrossGroupOnDegrade);
        setCrossGroupConfigSource("database");
      }

      toast.success(t("configUpdated"));
      // 刷新页面以应用货币显示变更
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="site-title">{t("siteTitle")}</Label>
        <Input
          id="site-title"
          value={siteTitle}
          onChange={(event) => setSiteTitle(event.target.value)}
          placeholder={t("siteTitlePlaceholder")}
          disabled={isPending}
          maxLength={128}
          required
        />
        <p className="text-xs text-muted-foreground">{t("siteTitleDesc")}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="currency-display">{t("currencyDisplay")}</Label>
        <Select
          value={currencyDisplay}
          onValueChange={(value) => setCurrencyDisplay(value as CurrencyCode)}
          disabled={isPending}
        >
          <SelectTrigger id="currency-display">
            <SelectValue placeholder={t("currencyDisplayPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CURRENCY_CONFIG) as CurrencyCode[]).map((code) => {
              return (
                <SelectItem key={code} value={code}>
                  {t(`currencies.${code}`)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("currencyDisplayDesc")}</p>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-dashed border-border px-4 py-3">
        <div>
          <Label htmlFor="allow-global-usage" className="text-sm font-medium">
            {t("allowGlobalView")}
          </Label>
          <p className="text-xs text-muted-foreground mt-1">{t("allowGlobalViewDesc")}</p>
        </div>
        <Switch
          id="allow-global-usage"
          checked={allowGlobalUsageView}
          onCheckedChange={(checked) => setAllowGlobalUsageView(checked)}
          disabled={isPending}
        />
      </div>

      <div className="space-y-3 rounded-lg border px-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="allow-cross-group" className="text-sm font-medium">
              跨组降级策略
            </Label>
            <p className="text-xs text-muted-foreground">
              当用户分组内没有可用供应商时，允许降级到全局供应商池，保持业务连续性；关闭则维持严格分组隔离。
            </p>
            <p className="text-xs text-muted-foreground">
              当前配置来源：
              {crossGroupConfigSource === "database"
                ? "数据库"
                : crossGroupConfigSource === "environment"
                  ? "环境变量（fallback）"
                  : "默认值"}
            </p>
          </div>
          <Switch
            id="allow-cross-group"
            checked={allowCrossGroupOnDegrade}
            onCheckedChange={(checked) => setAllowCrossGroupOnDegrade(checked)}
            disabled={isPending}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? t("common.saving") : t("saveSettings")}
        </Button>
      </div>
    </form>
  );
}
