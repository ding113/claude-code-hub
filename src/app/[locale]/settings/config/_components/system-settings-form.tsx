"use client";

import {
  AlertTriangle,
  ChevronDown,
  CircleHelp,
  Clock,
  Eye,
  FileCode,
  Globe,
  MapPin,
  Network,
  Pencil,
  Radio,
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { InlineWarning } from "@/components/ui/inline-warning";
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
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CurrencyCode } from "@/lib/utils";
import { CURRENCY_CONFIG } from "@/lib/utils";
import { COMMON_TIMEZONES, getTimezoneLabel } from "@/lib/utils/timezone";
import {
  shouldWarnQuotaDbRefreshIntervalTooHigh,
  shouldWarnQuotaDbRefreshIntervalTooLow,
  shouldWarnQuotaLeaseCapZero,
  shouldWarnQuotaLeasePercentZero,
} from "@/lib/utils/validation/quota-lease-warnings";
import { DEFAULT_IP_EXTRACTION_CONFIG, type IpExtractionConfig } from "@/types/ip-extraction";
import type {
  BillingModelSource,
  CodexPriorityBillingSource,
  SystemSettings,
} from "@/types/system-config";

interface SystemSettingsFormProps {
  initialSettings: Pick<
    SystemSettings,
    | "siteTitle"
    | "allowGlobalUsageView"
    | "currencyDisplay"
    | "billingModelSource"
    | "codexPriorityBillingSource"
    | "timezone"
    | "verboseProviderError"
    | "passThroughUpstreamErrorMessage"
    | "enableHttp2"
    | "enableOpenaiResponsesWebsocket"
    | "enableHighConcurrencyMode"
    | "interceptAnthropicWarmupRequests"
    | "enableThinkingSignatureRectifier"
    | "enableBillingHeaderRectifier"
    | "enableResponseInputRectifier"
    | "enableThinkingBudgetRectifier"
    | "allowNonConversationEndpointProviderFallback"
    | "enableCodexSessionIdCompletion"
    | "enableClaudeMetadataUserIdInjection"
    | "enableResponseFixer"
    | "responseFixerConfig"
    | "quotaDbRefreshIntervalSeconds"
    | "quotaLeasePercent5h"
    | "quotaLeasePercentDaily"
    | "quotaLeasePercentWeekly"
    | "quotaLeasePercentMonthly"
    | "quotaLeaseCapUsd"
    | "ipGeoLookupEnabled"
    | "ipExtractionConfig"
  >;
}

function clampQuotaDbRefreshIntervalSeconds(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 1;
  const rounded = Math.round(parsed);
  return Math.min(300, Math.max(1, rounded));
}

function formatIpExtractionConfig(config: IpExtractionConfig): string {
  return JSON.stringify(config, null, 2);
}

const DEFAULT_IP_EXTRACTION_CONFIG_TEXT = formatIpExtractionConfig(DEFAULT_IP_EXTRACTION_CONFIG);

export function SystemSettingsForm({ initialSettings }: SystemSettingsFormProps) {
  const router = useRouter();
  const t = useTranslations("settings.config.form");
  const tSettings = useTranslations("settings");
  const tCommon = useTranslations("settings.common");
  const tIpLogging = useTranslations("settings.config.ipLogging");
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
  const [codexPriorityBillingSource, setCodexPriorityBillingSource] =
    useState<CodexPriorityBillingSource>(initialSettings.codexPriorityBillingSource);
  const [timezone, setTimezone] = useState<string | null>(initialSettings.timezone);
  const [verboseProviderError, setVerboseProviderError] = useState(
    initialSettings.verboseProviderError
  );
  const [passThroughUpstreamErrorMessage, setPassThroughUpstreamErrorMessage] = useState(
    initialSettings.passThroughUpstreamErrorMessage
  );
  const [enableHttp2, setEnableHttp2] = useState(initialSettings.enableHttp2);
  const [enableOpenaiResponsesWebsocket, setEnableOpenaiResponsesWebsocket] = useState(
    initialSettings.enableOpenaiResponsesWebsocket
  );
  const [enableHighConcurrencyMode, setEnableHighConcurrencyMode] = useState(
    initialSettings.enableHighConcurrencyMode
  );
  const [interceptAnthropicWarmupRequests, setInterceptAnthropicWarmupRequests] = useState(
    initialSettings.interceptAnthropicWarmupRequests
  );
  const [enableThinkingSignatureRectifier, setEnableThinkingSignatureRectifier] = useState(
    initialSettings.enableThinkingSignatureRectifier
  );
  const [enableBillingHeaderRectifier, setEnableBillingHeaderRectifier] = useState(
    initialSettings.enableBillingHeaderRectifier
  );
  const [enableResponseInputRectifier, setEnableResponseInputRectifier] = useState(
    initialSettings.enableResponseInputRectifier
  );
  const [
    allowNonConversationEndpointProviderFallback,
    setAllowNonConversationEndpointProviderFallback,
  ] = useState(initialSettings.allowNonConversationEndpointProviderFallback);
  const [enableThinkingBudgetRectifier, setEnableThinkingBudgetRectifier] = useState(
    initialSettings.enableThinkingBudgetRectifier
  );
  const [enableCodexSessionIdCompletion, setEnableCodexSessionIdCompletion] = useState(
    initialSettings.enableCodexSessionIdCompletion
  );
  const [enableClaudeMetadataUserIdInjection, setEnableClaudeMetadataUserIdInjection] = useState(
    initialSettings.enableClaudeMetadataUserIdInjection
  );
  const [enableResponseFixer, setEnableResponseFixer] = useState(
    initialSettings.enableResponseFixer
  );
  const [responseFixerConfig, setResponseFixerConfig] = useState(
    initialSettings.responseFixerConfig
  );
  const [quotaDbRefreshIntervalSecondsStr, setQuotaDbRefreshIntervalSecondsStr] = useState(
    String(initialSettings.quotaDbRefreshIntervalSeconds ?? 10)
  );
  const quotaDbRefreshIntervalSeconds = (() => {
    const trimmed = quotaDbRefreshIntervalSecondsStr.trim();
    if (!trimmed) return Number.NaN;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  })();
  const [quotaLeasePercent5h, setQuotaLeasePercent5h] = useState(
    initialSettings.quotaLeasePercent5h ?? 0.05
  );
  const [quotaLeasePercentDaily, setQuotaLeasePercentDaily] = useState(
    initialSettings.quotaLeasePercentDaily ?? 0.05
  );
  const [quotaLeasePercentWeekly, setQuotaLeasePercentWeekly] = useState(
    initialSettings.quotaLeasePercentWeekly ?? 0.05
  );
  const [quotaLeasePercentMonthly, setQuotaLeasePercentMonthly] = useState(
    initialSettings.quotaLeasePercentMonthly ?? 0.05
  );
  const [quotaLeaseCapUsd, setQuotaLeaseCapUsd] = useState<string>(
    initialSettings.quotaLeaseCapUsd != null ? String(initialSettings.quotaLeaseCapUsd) : ""
  );
  const [ipGeoLookupEnabled, setIpGeoLookupEnabled] = useState(
    initialSettings.ipGeoLookupEnabled ?? true
  );
  const [ipExtractionConfigText, setIpExtractionConfigText] = useState<string>(
    formatIpExtractionConfig(initialSettings.ipExtractionConfig ?? DEFAULT_IP_EXTRACTION_CONFIG)
  );
  const [isPending, startTransition] = useTransition();
  const [responseFixerOpen, setResponseFixerOpen] = useState(false);
  const [quotaLeaseOpen, setQuotaLeaseOpen] = useState(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!siteTitle.trim()) {
      toast.error(t("siteTitleRequired"));
      return;
    }

    const quotaDbRefreshIntervalSecondsToSave = clampQuotaDbRefreshIntervalSeconds(
      quotaDbRefreshIntervalSecondsStr
    );

    // Parse the IP extraction config textarea. Empty -> null (server uses default).
    // Invalid JSON or wrong shape: surface the error and abort the save so the
    // user doesn't unintentionally revert to defaults.
    let ipExtractionConfigToSave: IpExtractionConfig | null = null;
    const trimmedIpExtractionConfig = ipExtractionConfigText.trim();
    if (trimmedIpExtractionConfig) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmedIpExtractionConfig);
      } catch (error) {
        toast.error(
          t("ipLoggingInvalidJson", {
            message: error instanceof Error ? error.message : String(error),
          })
        );
        return;
      }
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !Array.isArray((parsed as { headers?: unknown }).headers)
      ) {
        toast.error(t("ipLoggingInvalidShape"));
        return;
      }
      ipExtractionConfigToSave = parsed as IpExtractionConfig;
    }

    startTransition(async () => {
      const result = await saveSystemSettings({
        siteTitle,
        allowGlobalUsageView,
        currencyDisplay,
        billingModelSource,
        codexPriorityBillingSource,
        timezone,
        verboseProviderError,
        passThroughUpstreamErrorMessage,
        enableHttp2,
        enableOpenaiResponsesWebsocket,
        enableHighConcurrencyMode,
        interceptAnthropicWarmupRequests,
        enableThinkingSignatureRectifier,
        enableBillingHeaderRectifier,
        enableResponseInputRectifier,
        allowNonConversationEndpointProviderFallback,
        enableThinkingBudgetRectifier,
        enableCodexSessionIdCompletion,
        enableClaudeMetadataUserIdInjection,
        enableResponseFixer,
        responseFixerConfig,
        quotaDbRefreshIntervalSeconds: quotaDbRefreshIntervalSecondsToSave,
        quotaLeasePercent5h,
        quotaLeasePercentDaily,
        quotaLeasePercentWeekly,
        quotaLeasePercentMonthly,
        quotaLeaseCapUsd: quotaLeaseCapUsd.trim() === "" ? null : parseFloat(quotaLeaseCapUsd),
        ipGeoLookupEnabled,
        ipExtractionConfig: ipExtractionConfigToSave,
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
        setCodexPriorityBillingSource(result.data.codexPriorityBillingSource);
        setTimezone(result.data.timezone);
        setVerboseProviderError(result.data.verboseProviderError);
        setPassThroughUpstreamErrorMessage(result.data.passThroughUpstreamErrorMessage);
        setEnableHttp2(result.data.enableHttp2);
        setEnableOpenaiResponsesWebsocket(result.data.enableOpenaiResponsesWebsocket);
        setEnableHighConcurrencyMode(result.data.enableHighConcurrencyMode);
        setInterceptAnthropicWarmupRequests(result.data.interceptAnthropicWarmupRequests);
        setEnableThinkingSignatureRectifier(result.data.enableThinkingSignatureRectifier);
        setEnableBillingHeaderRectifier(result.data.enableBillingHeaderRectifier);
        setEnableResponseInputRectifier(result.data.enableResponseInputRectifier);
        setAllowNonConversationEndpointProviderFallback(
          result.data.allowNonConversationEndpointProviderFallback
        );
        setEnableThinkingBudgetRectifier(result.data.enableThinkingBudgetRectifier);
        setEnableCodexSessionIdCompletion(result.data.enableCodexSessionIdCompletion);
        setEnableClaudeMetadataUserIdInjection(result.data.enableClaudeMetadataUserIdInjection);
        setEnableResponseFixer(result.data.enableResponseFixer);
        setResponseFixerConfig(result.data.responseFixerConfig);
        setQuotaDbRefreshIntervalSecondsStr(
          String(result.data.quotaDbRefreshIntervalSeconds ?? 10)
        );
        setQuotaLeasePercent5h(result.data.quotaLeasePercent5h ?? 0.05);
        setQuotaLeasePercentDaily(result.data.quotaLeasePercentDaily ?? 0.05);
        setQuotaLeasePercentWeekly(result.data.quotaLeasePercentWeekly ?? 0.05);
        setQuotaLeasePercentMonthly(result.data.quotaLeasePercentMonthly ?? 0.05);
        setQuotaLeaseCapUsd(
          result.data.quotaLeaseCapUsd != null ? String(result.data.quotaLeaseCapUsd) : ""
        );
        setIpGeoLookupEnabled(result.data.ipGeoLookupEnabled ?? true);
        setIpExtractionConfigText(
          formatIpExtractionConfig(result.data.ipExtractionConfig ?? DEFAULT_IP_EXTRACTION_CONFIG)
        );
      }

      toast.success(t("configUpdated"));
      if (
        result.data?.publicStatusProjectionWarningCode === "PUBLIC_STATUS_PROJECTION_PUBLISH_FAILED"
      ) {
        toast.warning(tSettings("config.form.publicStatusProjectionWarning"));
      } else if (
        result.data?.publicStatusProjectionWarningCode ===
        "PUBLIC_STATUS_BACKGROUND_REFRESH_PENDING"
      ) {
        toast.warning(tSettings("config.form.publicStatusBackgroundRefreshPending"));
      }
      router.refresh();
    });
  };

  const inputClassName =
    "bg-muted/50 border border-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary";
  const selectTriggerClassName =
    "bg-muted/50 border border-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary";
  const tooltipButtonClassName =
    "inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

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

      <div className="space-y-2">
        <Label
          htmlFor="codex-priority-billing-source"
          className="text-sm font-medium text-foreground"
        >
          {t("codexPriorityBillingSource")}
        </Label>
        <Select
          value={codexPriorityBillingSource}
          onValueChange={(value) =>
            setCodexPriorityBillingSource(value as CodexPriorityBillingSource)
          }
          disabled={isPending}
        >
          <SelectTrigger id="codex-priority-billing-source" className={selectTriggerClassName}>
            <SelectValue placeholder={t("codexPriorityBillingSourcePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="requested">
              {t("codexPriorityBillingSourceOptions.requested")}
            </SelectItem>
            <SelectItem value="actual">{t("codexPriorityBillingSourceOptions.actual")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("codexPriorityBillingSourceDesc")}</p>
      </div>

      {/* Timezone Select */}
      <div className="space-y-2">
        <Label htmlFor="timezone" className="text-sm font-medium text-foreground">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            {t("timezoneLabel")}
          </div>
        </Label>
        <Select
          value={timezone ?? "__auto__"}
          onValueChange={(value) => setTimezone(value === "__auto__" ? null : value)}
          disabled={isPending}
        >
          <SelectTrigger id="timezone" className={selectTriggerClassName}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__auto__">{t("timezoneAuto")}</SelectItem>
            {COMMON_TIMEZONES.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {getTimezoneLabel(tz)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("timezoneDescription")}</p>
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
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium text-foreground">{t("verboseProviderError")}</p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("verboseProviderErrorTooltip")}
                      className={tooltipButtonClassName}
                    >
                      <CircleHelp className="size-3.5" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={6} className="max-w-sm leading-relaxed">
                    {t("verboseProviderErrorTooltip")}
                  </TooltipContent>
                </Tooltip>
              </div>
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

        {/* Pass Through Upstream Error Message */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between hover:bg-white/[0.04] transition-colors">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {t("passThroughUpstreamErrorMessage")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("passThroughUpstreamErrorMessageDesc")}
              </p>
            </div>
          </div>
          <Switch
            id="pass-through-upstream-error-message"
            aria-label={t("passThroughUpstreamErrorMessage")}
            checked={passThroughUpstreamErrorMessage}
            onCheckedChange={(checked) => setPassThroughUpstreamErrorMessage(checked)}
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

        {/* Enable OpenAI Responses WebSocket (Codex only) */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between hover:bg-white/[0.04] transition-colors">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400 shrink-0">
              <Radio className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {t("enableOpenaiResponsesWebsocket")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("enableOpenaiResponsesWebsocketDesc")}
              </p>
            </div>
          </div>
          <Switch
            id="enable-openai-responses-websocket"
            aria-label={t("enableOpenaiResponsesWebsocket")}
            checked={enableOpenaiResponsesWebsocket}
            onCheckedChange={(checked) => setEnableOpenaiResponsesWebsocket(checked)}
            disabled={isPending}
          />
        </div>

        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between hover:bg-white/[0.04] transition-colors">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-500/10 text-red-400 shrink-0">
              <Network className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {t("enableHighConcurrencyMode")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("enableHighConcurrencyModeDesc")}
              </p>
            </div>
          </div>
          <Switch
            id="enable-high-concurrency-mode"
            checked={enableHighConcurrencyMode}
            onCheckedChange={(checked) => setEnableHighConcurrencyMode(checked)}
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

        {/* Enable Thinking Budget Rectifier */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between hover:bg-white/[0.04] transition-colors">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-violet-500/10 text-violet-400 shrink-0">
              <Pencil className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {t("enableThinkingBudgetRectifier")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("enableThinkingBudgetRectifierDesc")}
              </p>
            </div>
          </div>
          <Switch
            id="enable-thinking-budget-rectifier"
            checked={enableThinkingBudgetRectifier}
            onCheckedChange={(checked) => setEnableThinkingBudgetRectifier(checked)}
            disabled={isPending}
          />
        </div>

        {/* Enable Billing Header Rectifier */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between hover:bg-white/[0.04] transition-colors">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
              <FileCode className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {t("enableBillingHeaderRectifier")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("enableBillingHeaderRectifierDesc")}
              </p>
            </div>
          </div>
          <Switch
            id="enable-billing-header-rectifier"
            checked={enableBillingHeaderRectifier}
            onCheckedChange={(checked) => setEnableBillingHeaderRectifier(checked)}
            disabled={isPending}
          />
        </div>

        {/* Enable Response Input Rectifier */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between hover:bg-white/[0.04] transition-colors">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-sky-500/10 text-sky-400 shrink-0">
              <FileCode className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {t("enableResponseInputRectifier")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("enableResponseInputRectifierDesc")}
              </p>
            </div>
          </div>
          <Switch
            id="enable-response-input-rectifier"
            checked={enableResponseInputRectifier}
            onCheckedChange={(checked) => setEnableResponseInputRectifier(checked)}
            disabled={isPending}
          />
        </div>

        {/* Allow Non-Conversation Endpoint Provider Fallback */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between hover:bg-white/[0.04] transition-colors">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 shrink-0">
              <Terminal className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {t("allowNonConversationEndpointProviderFallback")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("allowNonConversationEndpointProviderFallbackDesc")}
              </p>
            </div>
          </div>
          <Switch
            id="allow-non-conversation-endpoint-provider-fallback"
            checked={allowNonConversationEndpointProviderFallback}
            onCheckedChange={(checked) => setAllowNonConversationEndpointProviderFallback(checked)}
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

        {/* Enable Claude metadata.user_id Injection */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between hover:bg-white/[0.04] transition-colors">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-teal-500/10 text-teal-400 shrink-0">
              <Terminal className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {t("enableClaudeMetadataUserIdInjection")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t.raw("enableClaudeMetadataUserIdInjectionDesc")}
              </p>
            </div>
          </div>
          <Switch
            id="enable-claude-metadata-user-id-injection"
            checked={enableClaudeMetadataUserIdInjection}
            onCheckedChange={(checked) => setEnableClaudeMetadataUserIdInjection(checked)}
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
            <Collapsible open={responseFixerOpen} onOpenChange={setResponseFixerOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 mt-3 ml-11 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${responseFixerOpen ? "" : "-rotate-90"}`}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 space-y-3 pl-11 border-l border-white/10 ml-4">
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
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
        <Collapsible open={quotaLeaseOpen} onOpenChange={setQuotaLeaseOpen}>
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-3 w-full cursor-pointer"
                disabled={isPending}
              >
                <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
                  <Clock className="h-4 w-4" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium text-foreground">{t("quotaLease.title")}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("quotaLease.description")}
                  </p>
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${quotaLeaseOpen ? "" : "-rotate-90"}`}
                />
              </button>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="space-y-4 pl-11 mt-4">
                {/* DB Refresh Interval */}
                <div className="space-y-2">
                  <Label
                    htmlFor="quota-db-refresh-interval"
                    className="text-sm font-medium text-foreground"
                  >
                    {t("quotaLease.dbRefreshInterval")}
                  </Label>
                  <Input
                    id="quota-db-refresh-interval"
                    type="number"
                    min={1}
                    max={300}
                    step={1}
                    value={quotaDbRefreshIntervalSecondsStr}
                    onChange={(e) => setQuotaDbRefreshIntervalSecondsStr(e.target.value)}
                    onBlur={() => {
                      setQuotaDbRefreshIntervalSecondsStr(
                        String(clampQuotaDbRefreshIntervalSeconds(quotaDbRefreshIntervalSecondsStr))
                      );
                    }}
                    disabled={isPending}
                    className={inputClassName}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("quotaLease.dbRefreshIntervalDesc")}
                  </p>
                  {shouldWarnQuotaDbRefreshIntervalTooLow(quotaDbRefreshIntervalSeconds) && (
                    <InlineWarning>
                      {t("quotaLease.warnings.dbRefreshIntervalTooLow", {
                        value: quotaDbRefreshIntervalSeconds,
                      })}
                    </InlineWarning>
                  )}
                  {shouldWarnQuotaDbRefreshIntervalTooHigh(quotaDbRefreshIntervalSeconds) && (
                    <InlineWarning>
                      {t("quotaLease.warnings.dbRefreshIntervalTooHigh", {
                        value: quotaDbRefreshIntervalSeconds,
                      })}
                    </InlineWarning>
                  )}
                </div>

                {/* Lease Percent 5h */}
                <div className="space-y-2">
                  <Label
                    htmlFor="quota-lease-percent-5h"
                    className="text-sm font-medium text-foreground"
                  >
                    {t("quotaLease.leasePercent5h")}
                  </Label>
                  <Input
                    id="quota-lease-percent-5h"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={quotaLeasePercent5h}
                    onChange={(e) => setQuotaLeasePercent5h(Number(e.target.value))}
                    disabled={isPending}
                    className={inputClassName}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("quotaLease.leasePercent5hDesc")}
                  </p>
                  {shouldWarnQuotaLeasePercentZero(quotaLeasePercent5h) && (
                    <InlineWarning>{t("quotaLease.warnings.leasePercentZero")}</InlineWarning>
                  )}
                </div>

                {/* Lease Percent Daily */}
                <div className="space-y-2">
                  <Label
                    htmlFor="quota-lease-percent-daily"
                    className="text-sm font-medium text-foreground"
                  >
                    {t("quotaLease.leasePercentDaily")}
                  </Label>
                  <Input
                    id="quota-lease-percent-daily"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={quotaLeasePercentDaily}
                    onChange={(e) => setQuotaLeasePercentDaily(Number(e.target.value))}
                    disabled={isPending}
                    className={inputClassName}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("quotaLease.leasePercentDailyDesc")}
                  </p>
                  {shouldWarnQuotaLeasePercentZero(quotaLeasePercentDaily) && (
                    <InlineWarning>{t("quotaLease.warnings.leasePercentZero")}</InlineWarning>
                  )}
                </div>

                {/* Lease Percent Weekly */}
                <div className="space-y-2">
                  <Label
                    htmlFor="quota-lease-percent-weekly"
                    className="text-sm font-medium text-foreground"
                  >
                    {t("quotaLease.leasePercentWeekly")}
                  </Label>
                  <Input
                    id="quota-lease-percent-weekly"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={quotaLeasePercentWeekly}
                    onChange={(e) => setQuotaLeasePercentWeekly(Number(e.target.value))}
                    disabled={isPending}
                    className={inputClassName}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("quotaLease.leasePercentWeeklyDesc")}
                  </p>
                  {shouldWarnQuotaLeasePercentZero(quotaLeasePercentWeekly) && (
                    <InlineWarning>{t("quotaLease.warnings.leasePercentZero")}</InlineWarning>
                  )}
                </div>

                {/* Lease Percent Monthly */}
                <div className="space-y-2">
                  <Label
                    htmlFor="quota-lease-percent-monthly"
                    className="text-sm font-medium text-foreground"
                  >
                    {t("quotaLease.leasePercentMonthly")}
                  </Label>
                  <Input
                    id="quota-lease-percent-monthly"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={quotaLeasePercentMonthly}
                    onChange={(e) => setQuotaLeasePercentMonthly(Number(e.target.value))}
                    disabled={isPending}
                    className={inputClassName}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("quotaLease.leasePercentMonthlyDesc")}
                  </p>
                  {shouldWarnQuotaLeasePercentZero(quotaLeasePercentMonthly) && (
                    <InlineWarning>{t("quotaLease.warnings.leasePercentZero")}</InlineWarning>
                  )}
                </div>

                {/* Lease Cap USD */}
                <div className="space-y-2">
                  <Label
                    htmlFor="quota-lease-cap-usd"
                    className="text-sm font-medium text-foreground"
                  >
                    {t("quotaLease.leaseCapUsd")}
                  </Label>
                  <Input
                    id="quota-lease-cap-usd"
                    type="number"
                    min={0}
                    step={0.01}
                    value={quotaLeaseCapUsd}
                    onChange={(e) => setQuotaLeaseCapUsd(e.target.value)}
                    placeholder=""
                    disabled={isPending}
                    className={inputClassName}
                  />
                  <p className="text-xs text-muted-foreground">{t("quotaLease.leaseCapUsdDesc")}</p>
                  {shouldWarnQuotaLeaseCapZero(quotaLeaseCapUsd) && (
                    <InlineWarning>{t("quotaLease.warnings.leaseCapZero")}</InlineWarning>
                  )}
                </div>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>

        {/* IP Logging & Extraction Section */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
              <MapPin className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{tIpLogging("title")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{tIpLogging("description")}</p>
            </div>
          </div>

          {/* Geo lookup toggle */}
          <div className="flex items-center justify-between pl-11">
            <div>
              <p className="text-sm font-medium text-foreground">{tIpLogging("geoLookup")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{tIpLogging("geoLookupHint")}</p>
            </div>
            <Switch
              id="ip-geo-lookup-enabled"
              checked={ipGeoLookupEnabled}
              onCheckedChange={(checked) => setIpGeoLookupEnabled(checked)}
              disabled={isPending}
            />
          </div>

          {/* Extraction config JSON */}
          <div className="space-y-2 pl-11">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="ip-extraction-config" className="text-sm font-medium text-foreground">
                {tIpLogging("extractionConfigLabel")}
              </Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={tIpLogging("extractionConfigHelpLabel")}
                    className={tooltipButtonClassName}
                  >
                    <CircleHelp className="size-3.5" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6} className="max-w-sm leading-relaxed">
                  {tIpLogging.raw("extractionConfigHint")}
                </TooltipContent>
              </Tooltip>
            </div>
            <Textarea
              id="ip-extraction-config"
              value={ipExtractionConfigText}
              onChange={(event) => setIpExtractionConfigText(event.target.value)}
              placeholder={DEFAULT_IP_EXTRACTION_CONFIG_TEXT}
              disabled={isPending}
              rows={5}
              spellCheck={false}
              className={`${inputClassName} font-mono text-xs`}
            />
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIpExtractionConfigText(DEFAULT_IP_EXTRACTION_CONFIG_TEXT)}
                disabled={isPending}
              >
                {tIpLogging("resetToDefault")}
              </Button>
            </div>
          </div>
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
