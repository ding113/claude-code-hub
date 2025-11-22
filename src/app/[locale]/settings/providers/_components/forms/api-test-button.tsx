"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, Activity, Copy, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  testProviderAnthropicMessages,
  testProviderOpenAIChatCompletions,
  testProviderOpenAIResponses,
  testProviderGemini,
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

type ApiFormat = "anthropic-messages" | "openai-chat" | "openai-responses" | "gemini";

// UI 配置常量
const API_TEST_UI_CONFIG = {
  MAX_PREVIEW_LENGTH: 500, // 响应内容预览最大长度
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
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
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
    if (isModelManuallyEdited) {
      return;
    }

    const whitelistDefault = normalizedAllowedModels[0];
    const defaultModel = whitelistDefault ?? getDefaultModelForFormat(apiFormat);
    setTestModel(defaultModel);
  }, [apiFormat, isModelManuallyEdited, normalizedAllowedModels]);

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

        case "gemini":
          response = await testProviderGemini({
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
          duration: API_TEST_UI_CONFIG.TOAST_SUCCESS_DURATION,
        });
      } else {
        const errorMessage = response.data.details?.error || response.data.message;

        toast.error(t("testFailed"), {
          description: errorMessage,
          duration: API_TEST_UI_CONFIG.TOAST_ERROR_DURATION,
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

  // 复制测试结果到剪贴板
  const handleCopyResult = async () => {
    if (!testResult) return;

    const resultText = [
      `测试结果: ${testResult.success ? "成功" : "失败"}`,
      `消息: ${testResult.message}`,
      testResult.details?.model && `模型: ${testResult.details.model}`,
      testResult.details?.responseTime !== undefined &&
        `响应时间: ${testResult.details.responseTime}ms`,
      testResult.details?.usage &&
        `Token 用量: ${
          typeof testResult.details.usage === "object"
            ? JSON.stringify(testResult.details.usage, null, 2)
            : String(testResult.details.usage)
        }`,
      testResult.details?.content &&
        `响应内容: ${testResult.details.content.slice(0, API_TEST_UI_CONFIG.MAX_PREVIEW_LENGTH)}${
          testResult.details.content.length > API_TEST_UI_CONFIG.MAX_PREVIEW_LENGTH ? "..." : ""
        }`,
      testResult.details?.error && `错误详情: ${testResult.details.error}`,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await navigator.clipboard.writeText(resultText);
      toast.success(t("copySuccess"));
    } catch (error) {
      console.error("复制失败:", error);
      toast.error(t("copyFailed"));
    }
  };

  // 获取默认模型占位符
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

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={disabled || isTesting || !providerUrl.trim() || (!apiKey.trim() && !providerId)}
        >
          {getButtonContent()}
        </Button>

        {/* 查看详细结果按钮 */}
        {testResult && !isTesting && (
          <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="ghost" size="sm">
                <ExternalLink className="h-4 w-4 mr-2" />
                {t("viewDetails")}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {testResult.success ? (
                    <>
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                      {t("testSuccess")}
                    </>
                  ) : (
                    <>
                      <XCircle className="h-5 w-5 text-red-600" />
                      {t("testFailed")}
                    </>
                  )}
                </DialogTitle>
                <DialogDescription>{testResult.message}</DialogDescription>
              </DialogHeader>

              <div className="space-y-6 mt-4">
                {/* 状态徽章 */}
                <div className="flex gap-2">
                  <Badge variant={testResult.success ? "default" : "destructive"}>
                    {testResult.success ? t("success") : t("failed")}
                  </Badge>
                  {testResult.details?.model && (
                    <Badge variant="outline">{testResult.details.model}</Badge>
                  )}
                </div>

                {/* 详细信息 */}
                {testResult.details && (
                  <div className="space-y-4">
                    {/* 响应时间 */}
                    {testResult.details.responseTime !== undefined && (
                      <div className="space-y-2">
                        <h4 className="font-semibold text-sm">{t("responseTime")}</h4>
                        <div className="rounded-md border bg-muted/50 p-3">
                          <div className="text-sm">{testResult.details.responseTime}ms</div>
                        </div>
                      </div>
                    )}

                    {/* Token 用量 */}
                    {testResult.details.usage && (
                      <div className="space-y-2">
                        <h4 className="font-semibold text-sm">{t("usage")}</h4>
                        <div className="rounded-md border bg-muted/50 p-3 max-h-60 overflow-y-auto">
                          <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                            {typeof testResult.details.usage === "object"
                              ? JSON.stringify(testResult.details.usage, null, 2)
                              : String(testResult.details.usage)}
                          </pre>
                        </div>
                      </div>
                    )}

                    {/* 响应内容 */}
                    {testResult.details.content && (
                      <div className="space-y-2">
                        <h4 className="font-semibold text-sm">{t("response")}</h4>
                        <div className="rounded-md border bg-muted/50 p-3 max-h-80 overflow-y-auto">
                          <pre className="text-xs whitespace-pre-wrap break-words leading-relaxed">
                            {testResult.details.content.slice(
                              0,
                              API_TEST_UI_CONFIG.MAX_PREVIEW_LENGTH
                            )}
                            {testResult.details.content.length >
                              API_TEST_UI_CONFIG.MAX_PREVIEW_LENGTH && "..."}
                          </pre>
                          {testResult.details.content.length >
                            API_TEST_UI_CONFIG.MAX_PREVIEW_LENGTH && (
                            <div className="text-xs text-muted-foreground mt-2 italic">
                              显示前 {API_TEST_UI_CONFIG.MAX_PREVIEW_LENGTH}{" "}
                              字符，完整内容请复制查看
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 错误详情 */}
                    {testResult.details.error && (
                      <div className="space-y-2">
                        <h4 className="font-semibold text-sm flex items-center gap-2">
                          <XCircle className="h-4 w-4 text-destructive" />
                          {t("error")}
                        </h4>
                        <div className="rounded-md border bg-destructive/10 p-3 max-h-60 overflow-y-auto">
                          <pre className="text-xs text-destructive whitespace-pre-wrap break-words font-mono">
                            {testResult.details.error}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 复制按钮 */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopyResult}
                  className="w-full"
                >
                  <Copy className="h-4 w-4 mr-2" />
                  {t("copyResult")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* 显示简要测试结果 */}
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
                <div className="space-y-1 text-xs opacity-80">
                  <div>
                    <span className="font-medium">{t("usage")}:</span>
                  </div>
                  <div className="ml-2">
                    <pre className="whitespace-pre-wrap break-words">
                      {typeof testResult.details.usage === "object"
                        ? JSON.stringify(testResult.details.usage, null, 2)
                        : String(testResult.details.usage)}
                    </pre>
                  </div>
                </div>
              )}
              {testResult.details.content && (
                <div className="space-y-1 text-xs opacity-80">
                  <div>
                    <span className="font-medium">{t("response")}:</span>
                  </div>
                  <div className="ml-2">
                    <pre className="whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                      {testResult.details.content.slice(
                        0,
                        Math.min(200, testResult.details.content.length)
                      )}
                      {testResult.details.content.length > 200 && "..."}
                    </pre>
                    {testResult.details.content.length > 200 && (
                      <div className="text-muted-foreground italic">
                        显示前 200 字符，完整内容请点击&ldquo;查看详情&rdquo;
                      </div>
                    )}
                  </div>
                </div>
              )}
              {testResult.details.error && (
                <div className="space-y-1 text-xs opacity-80">
                  <div>
                    <span className="font-medium">{t("error")}:</span>
                  </div>
                  <div className="ml-2">
                    <pre className="whitespace-pre-wrap break-words text-red-600 max-h-32 overflow-y-auto">
                      {testResult.details.error}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
