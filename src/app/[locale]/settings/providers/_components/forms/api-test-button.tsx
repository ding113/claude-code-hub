"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, Activity } from "lucide-react";
import {
  testProviderAnthropicMessages,
  testProviderOpenAIChatCompletions,
  testProviderOpenAIResponses,
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

type ApiFormat = "anthropic-messages" | "openai-chat" | "openai-responses";

interface ApiTestButtonProps {
  providerUrl: string;
  apiKey: string;
  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;
  disabled?: boolean;
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
}: ApiTestButtonProps) {
  const t = useTranslations("settings.providers.form.apiTest");
  const [isTesting, setIsTesting] = useState(false);
  const [apiFormat, setApiFormat] = useState<ApiFormat>("anthropic-messages");
  const [testModel, setTestModel] = useState("");
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

  const handleTest = async () => {
    // 验证必填字段
    if (!providerUrl.trim()) {
      toast.error(t("fillUrlFirst"));
      return;
    }

    if (!apiKey.trim()) {
      toast.error(t("fillKeyFirst"));
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      let response;

      switch (apiFormat) {
        case "anthropic-messages":
          response = await testProviderAnthropicMessages({
            providerUrl: providerUrl.trim(),
            apiKey: apiKey.trim(),
            model: testModel.trim() || undefined,
            proxyUrl: proxyUrl?.trim() || null,
            proxyFallbackToDirect,
          });
          break;

        case "openai-chat":
          response = await testProviderOpenAIChatCompletions({
            providerUrl: providerUrl.trim(),
            apiKey: apiKey.trim(),
            model: testModel.trim() || undefined,
            proxyUrl: proxyUrl?.trim() || null,
            proxyFallbackToDirect,
          });
          break;

        case "openai-responses":
          response = await testProviderOpenAIResponses({
            providerUrl: providerUrl.trim(),
            apiKey: apiKey.trim(),
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
  const getModelPlaceholder = () => {
    switch (apiFormat) {
      case "anthropic-messages":
        return "claude-3-5-sonnet-20241022";
      case "openai-chat":
        return "gpt-4.1";
      case "openai-responses":
        return "gpt-4.1";
      default:
        return "";
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="api-format">{t("apiFormat")}</Label>
        <Select value={apiFormat} onValueChange={(value) => setApiFormat(value as ApiFormat)}>
          <SelectTrigger id="api-format">
            <SelectValue placeholder={t("selectApiFormat")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="anthropic-messages">{t("formatAnthropicMessages")}</SelectItem>
            <SelectItem value="openai-chat">{t("formatOpenAIChat")}</SelectItem>
            <SelectItem value="openai-responses">{t("formatOpenAIResponses")}</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground">{t("apiFormatDesc")}</div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="test-model">{t("testModel")}</Label>
        <Input
          id="test-model"
          value={testModel}
          onChange={(e) => setTestModel(e.target.value)}
          placeholder={getModelPlaceholder()}
          disabled={isTesting}
        />
        <div className="text-xs text-muted-foreground">{t("testModelDesc")}</div>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleTest}
        disabled={disabled || isTesting || !providerUrl.trim() || !apiKey.trim()}
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
