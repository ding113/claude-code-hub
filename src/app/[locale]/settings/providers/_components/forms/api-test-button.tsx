"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, Activity } from "lucide-react";
import {
  testProviderAnthropicMessages,
  testProviderOpenAIChatCompletions,
  testProviderOpenAIResponses,
  getUnmaskedProviderKey,
} from "@/actions/providers";
import { getAvailableModelsByProviderType } from "@/actions/model-prices";
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

type ApiFormat = "anthropic-messages" | "openai-chat" | "openai-responses";

const providerTypeToApiFormat: Partial<Record<ProviderType, ApiFormat>> = {
  claude: "anthropic-messages",
  "claude-auth": "anthropic-messages",
  codex: "openai-responses",
  "openai-compatible": "openai-chat",
};

const apiFormatDefaultModel: Record<ApiFormat, string> = {
  "anthropic-messages": "claude-3-5-sonnet-20241022",
  "openai-chat": "gpt-4.1",
  "openai-responses": "gpt-4.1",
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

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const modelOptions =
    normalizedAllowedModels.length > 0 ? normalizedAllowedModels : availableModels;

  const initialApiFormat = resolveApiFormatFromProvider(providerType);
  const [isTesting, setIsTesting] = useState(false);
  const [apiFormat, setApiFormat] = useState<ApiFormat>(initialApiFormat);
  const [isApiFormatManuallySelected, setIsApiFormatManuallySelected] = useState(false);
  const [testModel, setTestModel] = useState(() => getDefaultModelForFormat(initialApiFormat));
  const [isModelManuallyEdited, setIsModelManuallyEdited] = useState(false);
  const [selectedAllowedModel, setSelectedAllowedModel] = useState<string | undefined>(() => {
    const defaultModel = getDefaultModelForFormat(initialApiFormat);
    return normalizedAllowedModels.includes(defaultModel) ? defaultModel : undefined;
  });
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    details?: {
      responseTime?: number;
      model?: string;
      usage?: Record<string, unknown> | string | number;
      content?: string;
      error?: string;
    };
  } | null>(null);

  useEffect(() => {
    if (isApiFormatManuallySelected) return;
    const resolvedFormat = resolveApiFormatFromProvider(providerType);
    if (resolvedFormat !== apiFormat) {
      setApiFormat(resolvedFormat);
    }
  }, [apiFormat, isApiFormatManuallySelected, providerType]);

  useEffect(() => {
    if (normalizedAllowedModels.length > 0) {
      setAvailableModels([]);
      return;
    }

    let canceled = false;
    async function loadModels() {
      setModelsLoading(true);
      const models = await getAvailableModelsByProviderType();
      if (!canceled) {
        setAvailableModels(models);
      }
      setModelsLoading(false);
    }
    loadModels();

    return () => {
      canceled = true;
    };
  }, [normalizedAllowedModels]);

  useEffect(() => {
    if (isModelManuallyEdited) {
      if (selectedAllowedModel && !modelOptions.includes(selectedAllowedModel)) {
        setSelectedAllowedModel(undefined);
      }
      return;
    }

    const defaultModel = getDefaultModelForFormat(apiFormat);
    const resolvedModel = modelOptions.includes(defaultModel)
      ? defaultModel
      : modelOptions[0] ?? defaultModel;

    setTestModel(resolvedModel);
    setSelectedAllowedModel(modelOptions.includes(resolvedModel) ? resolvedModel : undefined);
  }, [apiFormat, isModelManuallyEdited, modelOptions]);

  useEffect(() => {
    if (selectedAllowedModel && !modelOptions.includes(selectedAllowedModel)) {
      setSelectedAllowedModel(undefined);
    }
  }, [modelOptions, selectedAllowedModel]);

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

      let response;

      switch (apiFormat) {
        case "anthropic-messages":
          response = await testProviderAnthropicMessages({
            providerUrl: providerUrl.trim(),
            apiKey: resolvedKey,
            model: testModel.trim() || undefined,
            proxyUrl: proxyUrl?.trim() || null,
            proxyFallbackToDirect,
          });
          break;

        case "openai-chat":
          response = await testProviderOpenAIChatCompletions({
            providerUrl: providerUrl.trim(),
            apiKey: resolvedKey,
            model: testModel.trim() || undefined,
            proxyUrl: proxyUrl?.trim() || null,
            proxyFallbackToDirect,
          });
          break;

        case "openai-responses":
          response = await testProviderOpenAIResponses({
            providerUrl: providerUrl.trim(),
            apiKey: resolvedKey,
            model: testModel.trim() || undefined,
            proxyUrl: proxyUrl?.trim() || null,
            proxyFallbackToDirect,
          });
          break;
      }

      if (!response.ok) {
        toast.error(response.error || t("testFailed"));
        return;
      }

      if (!response.data) {
        toast.error(t("noResult"));
        return;
      }

      setTestResult(response.data);

      // 显示测试结果
      if (response.data.success) {
        const details = response.data.details;
        const responseTime = details?.responseTime ? `${details.responseTime}ms` : "N/A";
        const model = details?.model || t("unknown");

        toast.success(t("testSuccess"), {
          description: `${t("model")}: ${model} | ${t("responseTime")}: ${responseTime}`,
        });
      } else {
        const errorMessage = response.data.details?.error || response.data.message;

        toast.error(t("testFailed"), {
          description: errorMessage,
          duration: 5000,
        });
      }
    } catch (error) {
      console.error("测试 API 连通性失败:", error);
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
      if (testResult.success) {
        return (
          <>
            <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />
            {t("testSuccess")}
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

  // 获取默认模型占位符
  return (
    <div className="space-y-4">
      <div className="space-y-2 max-w-xl">
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
            <SelectItem value="anthropic-messages">
              {t("formatAnthropicMessages")}
            </SelectItem>
            <SelectItem value="openai-chat" disabled={!enableMultiProviderTypes}>
              <>
                {t("formatOpenAIChat")}
                {!enableMultiProviderTypes && providerTypeT("openaiCompatibleDisabled")}
              </>
            </SelectItem>
            <SelectItem value="openai-responses">{t("formatOpenAIResponses")}</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground">{t("apiFormatDesc")}</div>
      </div>

      {modelOptions.length > 0 && (
        <div className="space-y-2 max-w-xl">
          <Label htmlFor="test-model-select">{t("allowedModelSelectLabel")}</Label>
          <Select
            value={selectedAllowedModel}
            onValueChange={(value) => {
              setIsModelManuallyEdited(true);
              setSelectedAllowedModel(value);
              setTestModel(value);
            }}
          >
            <SelectTrigger id="test-model-select" disabled={modelsLoading}>
              <SelectValue placeholder={t("allowedModelSelectPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((model) => (
                <SelectItem key={model} value={model}>
                  {model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground">
            {modelsLoading ? t("loadingModels") : t("allowedModelSelectDesc")}
          </div>
        </div>
      )}

      <div className="space-y-2 max-w-xl">
        <Label htmlFor="test-model">{t("testModel")}</Label>
        <Input
          id="test-model"
          value={testModel}
          onChange={(e) => {
            const value = e.target.value;
            setIsModelManuallyEdited(true);
            setTestModel(value);
            if (normalizedAllowedModels.includes(value)) {
              setSelectedAllowedModel(value);
            } else {
              setSelectedAllowedModel(undefined);
            }
          }}
          placeholder={getDefaultModelForFormat(apiFormat)}
          disabled={isTesting}
        />
        <div className="text-xs text-muted-foreground">{t("testModelDesc")}</div>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleTest}
        disabled={
          disabled ||
          isTesting ||
          !providerUrl.trim() ||
          (!apiKey.trim() && !providerId)
        }
      >
        {getButtonContent()}
      </Button>

      {/* 显示详细测试结果 */}
      {testResult && !isTesting && (
        <div
          className={`text-xs p-3 rounded-md ${
            testResult.success
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          <div className="font-medium mb-2">{testResult.message}</div>
          {testResult.details && (
            <div className="space-y-1 text-xs opacity-80">
              {testResult.details.model && (
                <div>
                  <span className="font-medium">{t("model")}:</span> {testResult.details.model}
                </div>
              )}
              {testResult.details.responseTime !== undefined && (
                <div>
                  <span className="font-medium">{t("responseTime")}:</span>{" "}
                  {testResult.details.responseTime}ms
                </div>
              )}
              {testResult.details.usage && (
                <div>
                  <span className="font-medium">{t("usage")}:</span>{" "}
                  {typeof testResult.details.usage === "object"
                    ? JSON.stringify(testResult.details.usage)
                    : String(testResult.details.usage)}
                </div>
              )}
              {testResult.details.content && (
                <div>
                  <span className="font-medium">{t("response")}:</span>{" "}
                  {testResult.details.content}
                </div>
              )}
              {testResult.details.error && (
                <div>
                  <span className="font-medium">{t("error")}:</span> {testResult.details.error}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
