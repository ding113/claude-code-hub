"use client";

import {
  AlertTriangle,
  Eye,
  FileCode,
  Network,
  Pencil,
  Terminal,
  Thermometer,
  Wrench,
  Zap,
} from "lucide-react";
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
    | "interceptAnthropicWarmupRequests"
    | "enableThinkingSignatureRectifier"
    | "enableCodexSessionIdCompletion"
    | "enableResponseFixer"
    | "responseFixerConfig"
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
  const [interceptAnthropicWarmupRequests, setInterceptAnthropicWarmupRequests] = useState(
    initialSettings.interceptAnthropicWarmupRequests
  );
  const [enableThinkingSignatureRectifier, setEnableThinkingSignatureRectifier] = useState(
    initialSettings.enableThinkingSignatureRectifier
  );
  const [enableCodexSessionIdCompletion, setEnableCodexSessionIdCompletion] = useState(
    initialSettings.enableCodexSessionIdCompletion
  );
  const [enableResponseFixer, setEnableResponseFixer] = useState(
    initialSettings.enableResponseFixer
  );
  const [responseFixerConfig, setResponseFixerConfig] = useState(
    initialSettings.responseFixerConfig
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
        currencyDisplay,
        billingModelSource,
        verboseProviderError,
        enableHttp2,
        interceptAnthropicWarmupRequests,
        enableThinkingSignatureRectifier,
        enableCodexSessionIdCompletion,
        enableResponseFixer,
        responseFixerConfig,
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
        setInterceptAnthropicWarmupRequests(result.data.interceptAnthropicWarmupRequests);
        setEnableThinkingSignatureRectifier(result.data.enableThinkingSignatureRectifier);
        setEnableCodexSessionIdCompletion(result.data.enableCodexSessionIdCompletion);
        setEnableResponseFixer(result.data.enableResponseFixer);
        setResponseFixerConfig(result.data.responseFixerConfig);
      }

      toast.success(t("configUpdated"));
      router.refresh();
    });
  };

  const inputClassName =
    "bg-muted/50 border border-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary";
  const selectTriggerClassName =
    "bg-muted/50 border border-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Site Title Input */}
      <div className="space-y-2">
        <Label htmlFor="site-title" className="text-sm font-medium text-foreground">
          {t("siteTitle")}
        </Label>
        <Input
          id="site-title"
          value={siteTitle}
          onChange={(event) => setSiteTitle(event.target.value)}
          placeholder={t("siteTitlePlaceholder")}
          disabled={isPending}
          maxLength={128}
          required
          className={inputClassName}
        />
        <p className="text-xs text-muted-foreground">{t("siteTitleDesc")}</p>
      </div>

      {/* Currency Display Select */}
      <div className="space-y-2">
        <Label htmlFor="currency-display" className="text-sm font-medium text-foreground">
          {t("currencyDisplay")}
        </Label>
        <Select
          value={currencyDisplay}
          onValueChange={(value) => setCurrencyDisplay(value as CurrencyCode)}
          disabled={isPending}
        >
          <SelectTrigger id="currency-display" className={selectTriggerClassName}>
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

      {/* Billing Model Source Select */}
      <div className="space-y-2">
        <Label htmlFor="billing-model-source" className="text-sm font-medium text-foreground">
          {t("billingModelSource")}
        </Label>
        <Select
          value={billingModelSource}
          onValueChange={(value) => setBillingModelSource(value as BillingModelSource)}
          disabled={isPending}
        >
          <SelectTrigger id="billing-model-source" className={selectTriggerClassName}>
            <SelectValue placeholder={t("billingModelSourcePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="original">{t("billingModelSourceOptions.original")}</SelectItem>
            <SelectItem value="redirected">{t("billingModelSourceOptions.redirected")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("billingModelSourceDesc")}</p>
      </div>

      {/* Toggle Settings */}
      <div className="space-y-3">
        {/* Allow Global Usage View */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between hover:bg-white/[0.04] transition-colors">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
              <Eye className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{t("allowGlobalView")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("allowGlobalViewDesc")}</p>
            </div>
          </div>
          <Switch
            id="allow-global-usage"
            checked={allowGlobalUsageView}
            onCheckedChange={(checked) => setAllowGlobalUsageView(checked)}
            disabled={isPending}
          />
        </div>

        {/* Verbose Provider Error */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between hover:bg-white/[0.04] transition-colors">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-400 shrink-0">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{t("verboseProviderError")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("verboseProviderErrorDesc")}
              </p>
            </div>
          </div>
          <Switch
            id="verbose-provider-error"
            checked={verboseProviderError}
            onCheckedChange={(checked) => setVerboseProviderError(checked)}
            disabled={isPending}
          />
        </div>

        {/* Enable HTTP/2 */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between hover:bg-white/[0.04] transition-colors">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-green-500/10 text-green-400 shrink-0">
              <Zap className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{t("enableHttp2")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("enableHttp2Desc")}</p>
            </div>
          </div>
          <Switch
            id="enable-http2"
            checked={enableHttp2}
            onCheckedChange={(checked) => setEnableHttp2(checked)}
            disabled={isPending}
          />
        </div>

        {/* Intercept Anthropic Warmup Requests */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between hover:bg-white/[0.04] transition-colors">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-orange-500/10 text-orange-400 shrink-0">
              <Thermometer className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {t("interceptAnthropicWarmupRequests")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("interceptAnthropicWarmupRequestsDesc")}
              </p>
            </div>
          </div>
          <Switch
            id="intercept-anthropic-warmup"
            checked={interceptAnthropicWarmupRequests}
            onCheckedChange={(checked) => setInterceptAnthropicWarmupRequests(checked)}
            disabled={isPending}
          />
        </div>

        {/* Enable Thinking Signature Rectifier */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between hover:bg-white/[0.04] transition-colors">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-purple-500/10 text-purple-400 shrink-0">
              <Pencil className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {t("enableThinkingSignatureRectifier")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("enableThinkingSignatureRectifierDesc")}
              </p>
            </div>
          </div>
          <Switch
            id="enable-thinking-signature-rectifier"
            checked={enableThinkingSignatureRectifier}
            onCheckedChange={(checked) => setEnableThinkingSignatureRectifier(checked)}
            disabled={isPending}
          />
        </div>

        {/* Enable Codex Session ID Completion */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between hover:bg-white/[0.04] transition-colors">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400 shrink-0">
              <Terminal className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {t("enableCodexSessionIdCompletion")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("enableCodexSessionIdCompletionDesc")}
              </p>
            </div>
          </div>
          <Switch
            id="enable-codex-session-id-completion"
            checked={enableCodexSessionIdCompletion}
            onCheckedChange={(checked) => setEnableCodexSessionIdCompletion(checked)}
            disabled={isPending}
          />
        </div>

        {/* Response Fixer Section */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors">
          <div className="flex items-center justify-between">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                <Wrench className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{t("enableResponseFixer")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("enableResponseFixerDesc")}
                </p>
              </div>
            </div>
            <Switch
              id="enable-response-fixer"
              checked={enableResponseFixer}
              onCheckedChange={(checked) => setEnableResponseFixer(checked)}
              disabled={isPending}
            />
          </div>

          {enableResponseFixer && (
            <div className="mt-4 space-y-3 pl-11 border-l border-white/10 ml-4">
              {/* Fix Encoding */}
              <div className="flex items-center justify-between py-2">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 flex items-center justify-center rounded-md bg-indigo-500/10 text-indigo-400 shrink-0">
                    <FileCode className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t("responseFixerFixEncoding")}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("responseFixerFixEncodingDesc")}
                    </p>
                  </div>
                </div>
                <Switch
                  id="response-fixer-encoding"
                  checked={responseFixerConfig.fixEncoding}
                  onCheckedChange={(checked) =>
                    setResponseFixerConfig((prev) => ({ ...prev, fixEncoding: checked }))
                  }
                  disabled={isPending}
                />
              </div>

              {/* Fix SSE Format */}
              <div className="flex items-center justify-between py-2">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 flex items-center justify-center rounded-md bg-teal-500/10 text-teal-400 shrink-0">
                    <Network className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t("responseFixerFixSseFormat")}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("responseFixerFixSseFormatDesc")}
                    </p>
                  </div>
                </div>
                <Switch
                  id="response-fixer-sse"
                  checked={responseFixerConfig.fixSseFormat}
                  onCheckedChange={(checked) =>
                    setResponseFixerConfig((prev) => ({ ...prev, fixSseFormat: checked }))
                  }
                  disabled={isPending}
                />
              </div>

              {/* Fix Truncated JSON */}
              <div className="flex items-center justify-between py-2">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 flex items-center justify-center rounded-md bg-rose-500/10 text-rose-400 shrink-0">
                    <FileCode className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t("responseFixerFixTruncatedJson")}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("responseFixerFixTruncatedJsonDesc")}
                    </p>
                  </div>
                </div>
                <Switch
                  id="response-fixer-json"
                  checked={responseFixerConfig.fixTruncatedJson}
                  onCheckedChange={(checked) =>
                    setResponseFixerConfig((prev) => ({ ...prev, fixTruncatedJson: checked }))
                  }
                  disabled={isPending}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? tCommon("saving") : t("saveSettings")}
        </Button>
      </div>
    </form>
  );
}
