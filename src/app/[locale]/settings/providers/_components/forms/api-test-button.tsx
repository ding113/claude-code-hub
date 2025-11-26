"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, Activity, AlertTriangle } from "lucide-react";
import {
  testProviderUnified,
  getUnmaskedProviderKey,
} from "@/actions/providers";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isValidUrl } from "@/lib/utils/validation";
import type { ProviderType } from "@/types/provider";
import { TestResultCard, type UnifiedTestResultData } from "./test-result-card";

type ApiFormat = "anthropic-messages" | "openai-chat" | "openai-responses" | "gemini";

// UI 配置常量
const API_TEST_UI_CONFIG = {
  MAX_PREVIEW_LENGTH: 500, // 响应内容预览最大长度
  BRIEF_PREVIEW_LENGTH: 200, // 简要预览最大长度
  TOAST_SUCCESS_DURATION: 3000, // 成功 toast 显示时长（毫秒）
  TOAST_ERROR_DURATION: 5000, // 错误 toast 显示时长（毫秒）
} as const;

const providerTypeToApiFormat: Partial<Record<ProviderType, ApiFormat>> = {
  claude: "anthropic-messages",
  "claude-auth": "anthropic-messages",
  codex: "openai-responses",
  "openai-compatible": "openai-chat",
  gemini: "gemini",
  "gemini-cli": "gemini",
};

const apiFormatDefaultModel: Record<ApiFormat, string> = {
  "anthropic-messages": "claude-sonnet-4-5-20250929",
  "openai-chat": "gpt-5.1-codex",
  "openai-responses": "gpt-5.1-codex",
  gemini: "gemini-3-pro-preview",
};

const resolveApiFormatFromProvider = (providerType?: ProviderType | null): ApiFormat =>
  (providerType ? providerTypeToApiFormat[providerType] : undefined) ?? "anthropic-messages";

const getDefaultModelForFormat = (format: ApiFormat) => apiFormatDefaultModel[format];

interface ApiTestButtonProps {
  providerUrl: string;
  apiKey: string;
  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;
  disabled?: boolean;
  providerId?: number;
  providerType?: ProviderType | null;
  allowedModels?: string[];
  enableMultiProviderTypes: boolean;
}

/**
 * API 连通性测试按钮组件
 *
 * 支持测试三种API格式:
 * - Anthropic Messages API (v1/messages)
 * - OpenAI Chat Completions API (v1/chat/completions)
 * - OpenAI Responses API (v1/responses)
 */
export function ApiTestButton({
  providerUrl,
  apiKey,
  proxyUrl,
  proxyFallbackToDirect = false,
  disabled = false,
  providerId,
  providerType,
  allowedModels = [],
  enableMultiProviderTypes,
}: ApiTestButtonProps) {
  const t = useTranslations("settings.providers.form.apiTest");
  const providerTypeT = useTranslations("settings.providers.form.providerTypes");
  const normalizedAllowedModels = useMemo(() => {
    const unique = new Set<string>();
    allowedModels.forEach((model) => {
      const trimmed = model.trim();
      if (trimmed) {
        unique.add(trimmed);
      }
    });
    return Array.from(unique);
  }, [allowedModels]);

  const initialApiFormat = resolveApiFormatFromProvider(providerType);
  const [isTesting, setIsTesting] = useState(false);
  const [apiFormat, setApiFormat] = useState<ApiFormat>(initialApiFormat);
  const [isApiFormatManuallySelected, setIsApiFormatManuallySelected] = useState(false);
  const [testModel, setTestModel] = useState(() => {
    const whitelistDefault = normalizedAllowedModels[0];
    return whitelistDefault ?? getDefaultModelForFormat(initialApiFormat);
  });
  const [isModelManuallyEdited, setIsModelManuallyEdited] = useState(false);
  const [testResult, setTestResult] = useState<UnifiedTestResultData | null>(null);

  useEffect(() => {
    if (isApiFormatManuallySelected) return;
    const resolvedFormat = resolveApiFormatFromProvider(providerType);
    if (resolvedFormat !== apiFormat) {
      setApiFormat(resolvedFormat);
    }
  }, [apiFormat, isApiFormatManuallySelected, providerType]);

  useEffect(() => {
    if (isModelManuallyEdited) {
      return;
    }

    const whitelistDefault = normalizedAllowedModels[0];
    const defaultModel = whitelistDefault ?? getDefaultModelForFormat(apiFormat);
    setTestModel(defaultModel);
  }, [apiFormat, isModelManuallyEdited, normalizedAllowedModels]);

  // Map API format to provider type
  const apiFormatToProviderType: Record<ApiFormat, ProviderType> = {
    "anthropic-messages": providerType === "claude-auth" ? "claude-auth" : "claude",
    "openai-chat": "openai-compatible",
    "openai-responses": "codex",
    gemini: providerType === "gemini-cli" ? "gemini-cli" : "gemini",
  };

  const handleTest = async () => {
    // 验证必填字段
    if (!providerUrl.trim()) {
      toast.error(t("fillUrlFirst"));
      return;
    }

    if (!isValidUrl(providerUrl.trim()) || !/^https?:\/\//.test(providerUrl.trim())) {
      toast.error(t("invalidUrl"));
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      // 优先使用表单中的密钥，仅在为空且提供了 providerId 时才查询数据库
      let resolvedKey = apiKey.trim();

      if (!resolvedKey && providerId) {
        const result = await getUnmaskedProviderKey(providerId);
        if (!result.ok) {
          toast.error(result.error || t("fillKeyFirst"));
          return;
        }

        if (!result.data?.key) {
          toast.error(t("fillKeyFirst"));
          return;
        }

        resolvedKey = result.data.key;
      }

      if (!resolvedKey) {
        toast.error(t("fillKeyFirst"));
        return;
      }

      // Use unified testing service
      const response = await testProviderUnified({
        providerUrl: providerUrl.trim(),
        apiKey: resolvedKey,
        providerType: apiFormatToProviderType[apiFormat],
        model: testModel.trim() || undefined,
        proxyUrl: proxyUrl?.trim() || null,
        proxyFallbackToDirect,
      });

      if (!response.ok) {
        toast.error(response.error || t("testFailed"));
        return;
      }

      if (!response.data) {
        toast.error(t("noResult"));
        return;
      }

      setTestResult(response.data);

      // 显示测试结果 toast
      const statusLabels = {
        green: t("testSuccess"),
        yellow: "波动",
        red: t("testFailed"),
      };

      if (response.data.status === "green") {
        toast.success(statusLabels.green, {
          description: `${t("responseModel")}: ${response.data.model || t("unknown")} | ${t("responseTime")}: ${response.data.latencyMs}ms`,
          duration: API_TEST_UI_CONFIG.TOAST_SUCCESS_DURATION,
        });
      } else if (response.data.status === "yellow") {
        toast.warning(statusLabels.yellow, {
          description: response.data.message,
          duration: API_TEST_UI_CONFIG.TOAST_SUCCESS_DURATION,
        });
      } else {
        toast.error(statusLabels.red, {
          description: response.data.errorMessage || response.data.message,
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

  // 获取按钮内容
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
      } else if (testResult.status === "yellow") {
        return (
          <>
            <AlertTriangle className="h-4 w-4 mr-2 text-yellow-600" />
            波动
          </>
        );
      } else {
        return (
          <>
            <XCircle className="h-4 w-4 mr-2 text-red-600" />
            {t("testFailed")}
          </>
        );
      }
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
        <Label htmlFor="api-format">{t("apiFormat")}</Label>
        <Select
          value={apiFormat}
          onValueChange={(value) => {
            setIsApiFormatManuallySelected(true);
            setApiFormat(value as ApiFormat);
          }}
        >
          <SelectTrigger id="api-format">
            <SelectValue placeholder={t("selectApiFormat")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="anthropic-messages">{t("formatAnthropicMessages")}</SelectItem>
            <SelectItem value="openai-chat" disabled={!enableMultiProviderTypes}>
              <>
                {t("formatOpenAIChat")}
                {!enableMultiProviderTypes && providerTypeT("openaiCompatibleDisabled")}
              </>
            </SelectItem>
            <SelectItem value="openai-responses">{t("formatOpenAIResponses")}</SelectItem>
            <SelectItem value="gemini">Gemini API</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground">{t("apiFormatDesc")}</div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="test-model">{t("testModel")}</Label>
        <Input
          id="test-model"
          value={testModel}
          onChange={(e) => {
            const value = e.target.value;
            setIsModelManuallyEdited(true);
            setTestModel(value);
          }}
          placeholder={getDefaultModelForFormat(apiFormat)}
          disabled={isTesting}
        />
        <div className="text-xs text-muted-foreground">{t("testModelDesc")}</div>
      </div>

      {/* 免责声明 */}
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        <div className="font-medium mb-1">⚠️ {t("disclaimer.title")}</div>
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

      {/* 显示测试结果卡片 */}
      {testResult && !isTesting && (
        <TestResultCard result={testResult} />
      )}
    </div>
  );
}
