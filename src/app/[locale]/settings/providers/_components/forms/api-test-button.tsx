"use client";

import { Activity, AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { normalizeAllowedModelRules } from "@/lib/allowed-model-rules";
import {
  callProviderGeminiTest,
  callProviderUnifiedTest,
} from "@/lib/api-client/v1/providers/hooks";
import { providersClient } from "@/lib/api-client/v1/providers/index";

/**
 * Local mirror of the provider api-test success details shape (used to read
 * the optional response payload). Kept inline to avoid a client import from
 * the server-only `@/actions/providers` module.
 */
type ProviderApiTestSuccessDetails = {
  responseTime?: number;
  model?: string;
  usage?: Record<string, unknown>;
  content?: string;
  rawResponse?: string;
  streamInfo?: {
    chunksReceived: number;
    format: "sse" | "ndjson";
  };
};

import {
  CUSTOM_HEADERS_PLACEHOLDER,
  type CustomHeadersValidationErrorCode,
  parseCustomHeadersJsonText,
  stringifyCustomHeadersForTextarea,
} from "@/lib/custom-headers";
import { isValidUrl } from "@/lib/utils/validation";
import type { AllowedModelRuleInput, ProviderType } from "@/types/provider";
import { TestResultCard, type UnifiedTestResultData } from "./test-result-card";

const API_TEST_UI_CONFIG = {
  TOAST_SUCCESS_DURATION: 3000,
  TOAST_ERROR_DURATION: 5000,
} as const;

const DEFAULT_MODELS: Record<ProviderType, string> = {
  claude: "claude-haiku-4-5-20251001",
  "claude-auth": "claude-haiku-4-5-20251001",
  codex: "gpt-5.3-codex",
  "openai-compatible": "gpt-4.1-mini",
  gemini: "gemini-2.5-flash",
  "gemini-cli": "gemini-2.5-flash",
};

function resolveProviderType(providerType?: ProviderType | null): ProviderType {
  return providerType ?? "claude";
}

function getDefaultModelForProvider(
  providerType?: ProviderType | null,
  whitelistDefault?: string
): string {
  return whitelistDefault ?? DEFAULT_MODELS[resolveProviderType(providerType)];
}

function getTimeoutMsForProvider(providerType: ProviderType): number {
  return providerType === "gemini" || providerType === "gemini-cli" ? 60_000 : 15_000;
}

function normalizeUsage(usage?: Record<string, unknown>) {
  if (!usage) {
    return undefined;
  }

  const readNumber = (...keys: string[]) => {
    for (const key of keys) {
      const value = usage[key];
      if (typeof value === "number") {
        return value;
      }
    }
    return undefined;
  };

  const inputTokens = readNumber("inputTokens", "promptTokenCount", "prompt_tokens") ?? 0;
  const outputTokens = readNumber("outputTokens", "candidatesTokenCount", "completion_tokens") ?? 0;

  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens: readNumber("cacheCreationInputTokens", "cache_creation_input_tokens"),
    cacheReadInputTokens: readNumber("cacheReadInputTokens", "cache_read_input_tokens"),
  };
}

interface ApiTestButtonProps {
  providerUrl: string;
  apiKey: string;
  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;
  disabled?: boolean;
  providerId?: number;
  providerType?: ProviderType | null;
  allowedModels?: AllowedModelRuleInput[];
  customHeaders?: Record<string, string> | null;
  enableMultiProviderTypes: boolean;
}

export function ApiTestButton({
  providerUrl,
  apiKey,
  proxyUrl,
  proxyFallbackToDirect = false,
  disabled = false,
  providerId,
  providerType,
  allowedModels = [],
  customHeaders,
  enableMultiProviderTypes: _enableMultiProviderTypes,
}: ApiTestButtonProps) {
  const t = useTranslations("settings.providers.form.apiTest");
  const normalizedAllowedModels = useMemo(() => {
    const unique = new Set<string>();
    (normalizeAllowedModelRules(allowedModels) ?? []).forEach((rule) => {
      if (rule.matchType === "exact") {
        unique.add(rule.pattern);
      }
    });
    return Array.from(unique);
  }, [allowedModels]);

  const resolvedProviderType = resolveProviderType(providerType);
  const [isTesting, setIsTesting] = useState(false);
  const [isModelManuallyEdited, setIsModelManuallyEdited] = useState(false);
  const [testModel, setTestModel] = useState(() =>
    getDefaultModelForProvider(providerType, normalizedAllowedModels[0])
  );
  const initialCustomHeadersText = useMemo(
    () => stringifyCustomHeadersForTextarea(customHeaders ?? null),
    // 仅根据 providerId + 序列化值计算初始值，避免引用相等触发不必要的更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [providerId, JSON.stringify(customHeaders ?? null)]
  );
  const [customHeadersText, setCustomHeadersText] = useState(initialCustomHeadersText);
  const [isCustomHeadersManuallyEdited, setIsCustomHeadersManuallyEdited] = useState(false);
  const [testResult, setTestResult] = useState<UnifiedTestResultData | null>(null);

  useEffect(() => {
    if (isModelManuallyEdited) {
      return;
    }

    setTestModel(getDefaultModelForProvider(providerType, normalizedAllowedModels[0]));
  }, [isModelManuallyEdited, normalizedAllowedModels, providerType]);

  // 仅在用户未手动编辑时随 prop 变更同步；切换 provider 身份时重置编辑标志
  useEffect(() => {
    setIsCustomHeadersManuallyEdited(false);
  }, [providerId]);

  useEffect(() => {
    if (isCustomHeadersManuallyEdited) return;
    setCustomHeadersText(initialCustomHeadersText);
  }, [initialCustomHeadersText, isCustomHeadersManuallyEdited]);

  const CUSTOM_HEADER_ERROR_KEYS: Record<CustomHeadersValidationErrorCode, string> = {
    invalid_json: "customHeaders.errors.invalidJson",
    not_object: "customHeaders.errors.notObject",
    invalid_name: "customHeaders.errors.invalidName",
    duplicate_name: "customHeaders.errors.duplicateName",
    protected_name: "customHeaders.errors.protectedName",
    invalid_value: "customHeaders.errors.invalidValue",
    empty_name: "customHeaders.errors.emptyName",
    crlf: "customHeaders.errors.crlf",
  };

  const handleTest = async () => {
    if (!providerUrl.trim()) {
      toast.error(t("fillUrlFirst"));
      return;
    }

    if (!isValidUrl(providerUrl.trim()) || !/^https?:\/\//.test(providerUrl.trim())) {
      toast.error(t("invalidUrl"));
      return;
    }

    const parsedCustomHeaders = parseCustomHeadersJsonText(customHeadersText);
    if (!parsedCustomHeaders.ok) {
      toast.error(t(CUSTOM_HEADER_ERROR_KEYS[parsedCustomHeaders.code]));
      return;
    }
    const customHeadersValue = parsedCustomHeaders.value;

    if (
      customHeadersValue &&
      (resolvedProviderType === "gemini" || resolvedProviderType === "gemini-cli")
    ) {
      toast.warning(t("customHeaders.geminiNotSupported"));
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      let resolvedKey = apiKey.trim();

      if (!resolvedKey && providerId) {
        try {
          const result = await providersClient.revealKey(providerId);
          if (!result?.key) {
            toast.error(t("fillKeyFirst"));
            return;
          }
          resolvedKey = result.key;
        } catch (revealError) {
          const message = revealError instanceof Error ? revealError.message : t("fillKeyFirst");
          toast.error(message || t("fillKeyFirst"));
          return;
        }
      }

      if (!resolvedKey) {
        toast.error(t("fillKeyFirst"));
        return;
      }

      let testResultData: UnifiedTestResultData | null = null;

      if (resolvedProviderType === "gemini" || resolvedProviderType === "gemini-cli") {
        const response = await callProviderGeminiTest<
          {
            providerUrl: string;
            apiKey: string;
            model?: string;
            proxyUrl: string | null;
            proxyFallbackToDirect: boolean;
            timeoutMs: number;
          },
          {
            success: boolean;
            message: string;
            details?: ProviderApiTestSuccessDetails;
          }
        >({
          providerUrl: providerUrl.trim(),
          apiKey: resolvedKey,
          model: testModel.trim() || undefined,
          proxyUrl: proxyUrl?.trim() || null,
          proxyFallbackToDirect,
          timeoutMs: getTimeoutMsForProvider(resolvedProviderType),
        });

        if (!response.ok) {
          toast.error(response.error || t("testFailed"));
          return;
        }

        if (!response.data) {
          toast.error(t("noResult"));
          return;
        }

        const rawMessage = response.data.message || t("testFailed");
        const usedFallback = rawMessage.includes("[FALLBACK:URL_PARAM]");
        const cleanMessage = rawMessage.replace(" [FALLBACK:URL_PARAM]", "");
        const isSuccess = response.data.success === true;
        const details = (isSuccess ? response.data.details : undefined) as
          | ProviderApiTestSuccessDetails
          | undefined;
        const latencyMs = response.data.details?.responseTime ?? 0;

        const inferSubStatus = ():
          | "success"
          | "auth_error"
          | "server_error"
          | "network_error"
          | "client_error"
          | "rate_limit" => {
          if (isSuccess) return "success";
          const msg = cleanMessage.toLowerCase();
          if (
            msg.includes("429") ||
            msg.includes("rate") ||
            msg.includes("限流") ||
            msg.includes("quota")
          ) {
            return "rate_limit";
          }
          if (
            msg.includes("401") ||
            msg.includes("403") ||
            msg.includes("认证") ||
            msg.includes("auth")
          ) {
            return "auth_error";
          }
          if (
            msg.includes("timeout") ||
            msg.includes("超时") ||
            msg.includes("econnrefused") ||
            msg.includes("dns")
          ) {
            return "network_error";
          }
          if (
            msg.includes("500") ||
            msg.includes("502") ||
            msg.includes("503") ||
            msg.includes("504")
          ) {
            return "server_error";
          }
          return "client_error";
        };

        testResultData = {
          success: isSuccess,
          status: isSuccess ? (usedFallback ? "yellow" : "green") : "red",
          subStatus: inferSubStatus(),
          message: cleanMessage,
          latencyMs,
          model: details?.model,
          content: details?.content,
          rawResponse: details?.rawResponse,
          usage: normalizeUsage(details?.usage),
          streamInfo: details?.streamInfo
            ? {
                isStreaming: true,
                chunksReceived: details.streamInfo.chunksReceived,
              }
            : undefined,
          testedAt: new Date().toISOString(),
          validationDetails: {
            httpPassed: isSuccess,
            latencyPassed: isSuccess && latencyMs < 5000,
            latencyMs,
            contentPassed: isSuccess,
            contentTarget: "pong",
          },
        };

        if (isSuccess && usedFallback) {
          toast.warning(t("geminiAuthFallback.warning"), {
            description: t("geminiAuthFallback.desc"),
            duration: 6000,
          });
        }
      } else {
        const response = await callProviderUnifiedTest<
          {
            providerUrl: string;
            apiKey: string;
            providerType: ProviderType;
            model?: string;
            proxyUrl: string | null;
            proxyFallbackToDirect: boolean;
            timeoutMs: number;
            customHeaders?: Record<string, string>;
          },
          UnifiedTestResultData
        >({
          providerUrl: providerUrl.trim(),
          apiKey: resolvedKey,
          providerType: resolvedProviderType,
          model: testModel.trim() || undefined,
          proxyUrl: proxyUrl?.trim() || null,
          proxyFallbackToDirect,
          timeoutMs: getTimeoutMsForProvider(resolvedProviderType),
          customHeaders: customHeadersValue ?? undefined,
        });

        if (!response.ok) {
          toast.error(response.error || t("testFailed"));
          return;
        }

        if (!response.data) {
          toast.error(t("noResult"));
          return;
        }

        testResultData = response.data;
      }

      if (!testResultData) {
        toast.error(t("noResult"));
        return;
      }

      setTestResult(testResultData);

      const statusLabels = {
        green: t("testSuccess"),
        yellow: t("resultCard.status.yellow"),
        red: t("testFailed"),
      };

      if (testResultData.status === "green") {
        toast.success(statusLabels.green, {
          description: `${t("responseModel")}: ${testResultData.model || t("unknown")} | ${t("responseTime")}: ${testResultData.latencyMs}ms`,
          duration: API_TEST_UI_CONFIG.TOAST_SUCCESS_DURATION,
        });
      } else if (testResultData.status === "yellow") {
        toast.warning(statusLabels.yellow, {
          description: testResultData.message,
          duration: API_TEST_UI_CONFIG.TOAST_SUCCESS_DURATION,
        });
      } else {
        toast.error(statusLabels.red, {
          description: testResultData.errorMessage || testResultData.message,
          duration: API_TEST_UI_CONFIG.TOAST_ERROR_DURATION,
        });
      }
    } catch (error) {
      console.error("API test failed:", error);
      toast.error(t("testFailedRetry"));
    } finally {
      setIsTesting(false);
    }
  };

  const getButtonContent = () => {
    if (isTesting) {
      return (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          {t("testing")}
        </>
      );
    }

    if (testResult) {
      if (testResult.status === "green") {
        return (
          <>
            <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />
            {t("testSuccess")}
          </>
        );
      }
      if (testResult.status === "yellow") {
        return (
          <>
            <AlertTriangle className="h-4 w-4 mr-2 text-yellow-600" />
            {t("resultCard.status.yellow")}
          </>
        );
      }
      return (
        <>
          <XCircle className="h-4 w-4 mr-2 text-red-600" />
          {t("testFailed")}
        </>
      );
    }

    return (
      <>
        <Activity className="h-4 w-4 mr-2" />
        {t("testApi")}
      </>
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="test-model">{t("model")}</Label>
        <Input
          id="test-model"
          value={testModel}
          onChange={(event) => {
            setIsModelManuallyEdited(true);
            setTestModel(event.target.value);
          }}
          placeholder={DEFAULT_MODELS[resolvedProviderType]}
          disabled={isTesting}
        />
        <div className="text-xs text-muted-foreground">{t("testModelDesc")}</div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="test-custom-headers">{t("customHeaders.label")}</Label>
        <Textarea
          id="test-custom-headers"
          value={customHeadersText}
          onChange={(event) => {
            setIsCustomHeadersManuallyEdited(true);
            setCustomHeadersText(event.target.value);
          }}
          placeholder={CUSTOM_HEADERS_PLACEHOLDER}
          disabled={isTesting}
          rows={3}
          spellCheck={false}
        />
        <div className="text-xs text-muted-foreground">{t("customHeaders.desc")}</div>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        <div className="font-medium mb-1 flex items-center gap-1">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {t("disclaimer.title")}
        </div>
        <div className="space-y-1 text-amber-700 dark:text-amber-300">
          <div>• {t("disclaimer.resultReference")}</div>
          <div>• {t("disclaimer.realRequest")}</div>
          <div>• {t("disclaimer.confirmConfig")}</div>
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleTest}
        disabled={disabled || isTesting || !providerUrl.trim() || (!apiKey.trim() && !providerId)}
      >
        {getButtonContent()}
      </Button>

      {testResult && !isTesting && <TestResultCard result={testResult} />}
    </div>
  );
}
