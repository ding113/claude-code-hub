"use client";

import { Activity, AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  getProviderTestPresets,
  getUnmaskedProviderKey,
  type PresetConfigResponse,
  testProviderGemini,
  testProviderUnified,
} from "@/actions/providers";
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
import { Textarea } from "@/components/ui/textarea";
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

  // Custom configuration state
  const [configMode, setConfigMode] = useState<"preset" | "custom">("preset");
  const [presets, setPresets] = useState<PresetConfigResponse[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>("");
  const [customPayload, setCustomPayload] = useState("");
  const [successContains, setSuccessContains] = useState("pong");
  const [timeoutSeconds, setTimeoutSeconds] = useState(() =>
    initialApiFormat === "gemini" ? 60 : 15
  );

  useEffect(() => {
    if (isApiFormatManuallySelected) return;
    const resolvedFormat = resolveApiFormatFromProvider(providerType);
    if (resolvedFormat !== apiFormat) {
      setApiFormat(resolvedFormat);
    }
  }, [apiFormat, isApiFormatManuallySelected, providerType]);

  // Map API format to provider type (defined before useEffect that depends on it)
  const apiFormatToProviderType: Record<ApiFormat, ProviderType> = useMemo(
    () => ({
      "anthropic-messages": providerType === "claude-auth" ? "claude-auth" : "claude",
      "openai-chat": "openai-compatible",
      "openai-responses": "codex",
      gemini: providerType === "gemini-cli" ? "gemini-cli" : "gemini",
    }),
    [providerType]
  );

  // Load presets when provider type changes
  useEffect(() => {
    const currentProviderType = apiFormatToProviderType[apiFormat];
    if (!currentProviderType) return;

    getProviderTestPresets(currentProviderType)
      .then((result) => {
        if (result.ok && result.data) {
          setPresets(result.data);
          // Auto-select first preset if available
          if (result.data.length > 0 && !selectedPreset) {
            setSelectedPreset(result.data[0].id);
            setSuccessContains(result.data[0].defaultSuccessContains);
          }
        } else {
          if (!result.ok) {
            console.error("[ApiTestButton] Failed to load presets:", result.error);
          }
          setPresets([]);
        }
      })
      .catch((err) => {
        console.error("[ApiTestButton] Failed to load presets:", err);
        setPresets([]);
      });
  }, [apiFormat, apiFormatToProviderType, selectedPreset]);

  useEffect(() => {
    if (isModelManuallyEdited) {
      return;
    }

    const whitelistDefault = normalizedAllowedModels[0];
    const defaultModel = whitelistDefault ?? getDefaultModelForFormat(apiFormat);
    setTestModel(defaultModel);
  }, [apiFormat, isModelManuallyEdited, normalizedAllowedModels]);

  // 根据 API 格式更新默认超时时间
  useEffect(() => {
    setTimeoutSeconds(apiFormat === "gemini" ? 60 : 15);
  }, [apiFormat]);

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

      const providerForTest = apiFormatToProviderType[apiFormat];
      let testResultData: UnifiedTestResultData | null = null;

      // Gemini 类型使用专门的测试函数
      if (providerForTest === "gemini" || providerForTest === "gemini-cli") {
        const response = await testProviderGemini({
          providerUrl: providerUrl.trim(),
          apiKey: resolvedKey,
          model: testModel.trim() || undefined,
          proxyUrl: proxyUrl?.trim() || null,
          proxyFallbackToDirect,
          timeoutMs: timeoutSeconds * 1000,
        });

        if (!response.ok) {
          toast.error(response.error || t("testFailed"));
          return;
        }

        if (!response.data) {
          toast.error(t("noResult"));
          return;
        }

        const isSuccess = response.data.success === true;
        const rawMessage = response.data.message || t("testFailed");
        const usedFallback = rawMessage.includes("[FALLBACK:URL_PARAM]");
        const cleanMessage = rawMessage.replace(" [FALLBACK:URL_PARAM]", "");

        // 根据错误消息推断 subStatus
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

        const latencyMs = response.data.details?.responseTime ?? 0;
        testResultData = {
          success: isSuccess,
          status: isSuccess ? (usedFallback ? "yellow" : "green") : "red",
          subStatus: inferSubStatus(),
          message: cleanMessage,
          latencyMs,
          testedAt: new Date().toISOString(),
          validationDetails: {
            httpPassed: isSuccess,
            latencyPassed: isSuccess && latencyMs < 5000, // 5秒内算通过
            contentPassed: isSuccess,
          },
        };

        // 如果使用了 fallback 认证方式，显示警告
        if (isSuccess && usedFallback) {
          toast.warning("Header 认证失败，使用了 URL 参数认证", {
            description: "实际代理转发仅使用 Header 认证，可能导致请求失败",
            duration: 6000,
          });
        }
      } else {
        // 其他类型使用统一测试服务
        const response = await testProviderUnified({
          providerUrl: providerUrl.trim(),
          apiKey: resolvedKey,
          providerType: providerForTest,
          model: testModel.trim() || undefined,
          proxyUrl: proxyUrl?.trim() || null,
          proxyFallbackToDirect,
          timeoutMs: timeoutSeconds * 1000,
          // Custom configuration
          preset: configMode === "preset" && selectedPreset ? selectedPreset : undefined,
          customPayload: configMode === "custom" && customPayload ? customPayload : undefined,
          successContains: successContains || undefined,
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

      // 显示测试结果 toast
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
            {t("resultCard.status.yellow")}
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
              {t("formatOpenAIChat")}
              {!enableMultiProviderTypes && providerTypeT("openaiCompatibleDisabled")}
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

      <div className="space-y-2">
        <Label htmlFor="test-timeout">超时时间（秒）</Label>
        <Input
          id="test-timeout"
          type="number"
          min={5}
          max={120}
          value={timeoutSeconds}
          onChange={(e) => {
            const value = parseInt(e.target.value, 10);
            if (!Number.isNaN(value) && value >= 5 && value <= 120) {
              setTimeoutSeconds(value);
            }
          }}
          disabled={isTesting}
          className="w-24"
        />
        <div className="text-xs text-muted-foreground">
          测试请求的最大等待时间（5-120 秒）
          {apiFormat === "gemini" && "，Gemini Thinking 模型建议 60 秒以上"}
        </div>
      </div>

      {/* Request Configuration - Preset/Custom */}
      {presets.length > 0 && (
        <div className="space-y-3">
          <Label>{t("requestConfig")}</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={configMode === "preset" ? "default" : "outline"}
              size="sm"
              onClick={() => setConfigMode("preset")}
              disabled={isTesting}
            >
              {t("presetConfig")}
            </Button>
            <Button
              type="button"
              variant={configMode === "custom" ? "default" : "outline"}
              size="sm"
              onClick={() => setConfigMode("custom")}
              disabled={isTesting}
            >
              {t("customConfig")}
            </Button>
          </div>

          {configMode === "preset" && (
            <div className="space-y-2">
              <Select
                value={selectedPreset}
                onValueChange={(value: string) => {
                  setSelectedPreset(value);
                  const preset = presets.find((p) => p.id === value);
                  if (preset) {
                    setSuccessContains(preset.defaultSuccessContains);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("selectPreset")} />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.id} - {preset.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">{t("presetDesc")}</div>
            </div>
          )}

          {configMode === "custom" && (
            <div className="space-y-2">
              <Textarea
                value={customPayload}
                onChange={(e) => setCustomPayload(e.target.value)}
                placeholder={t("customPayloadPlaceholder")}
                className="font-mono text-xs min-h-[120px]"
                disabled={isTesting}
              />
              <div className="text-xs text-muted-foreground">{t("customPayloadDesc")}</div>
            </div>
          )}
        </div>
      )}

      {/* Success Detection Keyword */}
      <div className="space-y-2">
        <Label htmlFor="success-contains">{t("successContains")}</Label>
        <Input
          id="success-contains"
          value={successContains}
          onChange={(e) => setSuccessContains(e.target.value)}
          placeholder={t("successContainsPlaceholder")}
          disabled={isTesting}
        />
        <div className="text-xs text-muted-foreground">{t("successContainsDesc")}</div>
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
      {testResult && !isTesting && <TestResultCard result={testResult} />}
    </div>
  );
}
