"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveSystemSettings } from "@/actions/system-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { CurrencyCode } from "@/lib/utils";
import { CURRENCY_CONFIG } from "@/lib/utils";
import type { BillingModelSource, SystemSettings } from "@/types/system-config";

interface SystemSettingsFormProps {
  initialSettings: Pick<
    SystemSettings,
    | "siteTitle"
    | "allowGlobalUsageView"
    | "currencyDisplay"
    | "billingModelSource"
    | "verboseProviderError"
    | "enableHttp2"
  >;
}

export function SystemSettingsForm({ initialSettings }: SystemSettingsFormProps) {
  const router = useRouter();
  const t = useTranslations("settings.config.form");
  const tCommon = useTranslations("settings.common");
  const [siteTitle, setSiteTitle] = useState(initialSettings.siteTitle);
  const [allowGlobalUsageView, setAllowGlobalUsageView] = useState(
    initialSettings.allowGlobalUsageView
  );
  const [currencyDisplay, setCurrencyDisplay] = useState<CurrencyCode>(
    initialSettings.currencyDisplay
  );
  const [billingModelSource, setBillingModelSource] = useState<BillingModelSource>(
    initialSettings.billingModelSource
  );
  const [verboseProviderError, setVerboseProviderError] = useState(
    initialSettings.verboseProviderError
  );
  const [enableHttp2, setEnableHttp2] = useState(initialSettings.enableHttp2);
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
        currencyDisplay,
        billingModelSource,
        verboseProviderError,
        enableHttp2,
      });

      if (!result.ok) {
        toast.error(result.error || t("saveFailed"));
        return;
      }

      if (result.data) {
        setSiteTitle(result.data.siteTitle);
        setAllowGlobalUsageView(result.data.allowGlobalUsageView);
        setCurrencyDisplay(result.data.currencyDisplay);
        setBillingModelSource(result.data.billingModelSource);
        setVerboseProviderError(result.data.verboseProviderError);
        setEnableHttp2(result.data.enableHttp2);
      }

      toast.success(t("configUpdated"));
      // Refresh Server Components to apply changes (currency display, etc.)
      router.refresh();
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

      <div className="space-y-2">
        <Label htmlFor="billing-model-source">{t("billingModelSource")}</Label>
        <Select
          value={billingModelSource}
          onValueChange={(value) => setBillingModelSource(value as BillingModelSource)}
          disabled={isPending}
        >
          <SelectTrigger id="billing-model-source">
            <SelectValue placeholder={t("billingModelSourcePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="original">{t("billingModelSourceOptions.original")}</SelectItem>
            <SelectItem value="redirected">{t("billingModelSourceOptions.redirected")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("billingModelSourceDesc")}</p>
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

      <div className="flex items-start justify-between gap-4 rounded-lg border border-dashed border-border px-4 py-3">
        <div>
          <Label htmlFor="verbose-provider-error" className="text-sm font-medium">
            {t("verboseProviderError")}
          </Label>
          <p className="text-xs text-muted-foreground mt-1">{t("verboseProviderErrorDesc")}</p>
        </div>
        <Switch
          id="verbose-provider-error"
          checked={verboseProviderError}
          onCheckedChange={(checked) => setVerboseProviderError(checked)}
          disabled={isPending}
        />
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-dashed border-border px-4 py-3">
        <div>
          <Label htmlFor="enable-http2" className="text-sm font-medium">
            {t("enableHttp2")}
          </Label>
          <p className="text-xs text-muted-foreground mt-1">{t("enableHttp2Desc")}</p>
        </div>
        <Switch
          id="enable-http2"
          checked={enableHttp2}
          onCheckedChange={(checked) => setEnableHttp2(checked)}
          disabled={isPending}
        />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? tCommon("saving") : t("saveSettings")}
        </Button>
      </div>
    </form>
  );
}
