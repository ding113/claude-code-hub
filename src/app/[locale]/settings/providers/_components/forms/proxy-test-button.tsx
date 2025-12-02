"use client";

import { Activity, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { testProviderProxy } from "@/actions/providers";
import { Button } from "@/components/ui/button";

interface ProxyTestButtonProps {
  providerUrl: string;
  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;
  disabled?: boolean;
}

/**
 * 代理连接测试按钮组件
 *
 * 通过配置的代理访问供应商 URL，验证代理配置是否正确
 */
export function ProxyTestButton({
  providerUrl,
  proxyUrl,
  proxyFallbackToDirect = false,
  disabled = false,
}: ProxyTestButtonProps) {
  const t = useTranslations("settings.providers.form.proxyTest");
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    details?: {
      statusCode?: number;
      responseTime?: number;
      usedProxy?: boolean;
      proxyUrl?: string;
      error?: string;
      errorType?: string;
    };
  } | null>(null);

  const handleTest = async () => {
    // 验证必填字段
    if (!providerUrl.trim()) {
      toast.error(t("fillUrlFirst"));
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const response = await testProviderProxy({
        providerUrl: providerUrl.trim(),
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

      // 显示测试结果
      if (response.data.success) {
        const details = response.data.details;
        const proxyUsed = details?.usedProxy ? t("viaProxy") : t("viaDirect");
        const responseTime = details?.responseTime ? `${details.responseTime}ms` : "N/A";

        toast.success(`${t("connectionSuccess")} ${proxyUsed}`, {
          description: `${t("responseTime")} ${responseTime}${details?.statusCode ? ` | ${t("statusCode")} ${details.statusCode}` : ""}`,
        });
      } else {
        const errorType = response.data.details?.errorType;
        const errorMessage = response.data.details?.error || response.data.message;

        toast.error(t("connectionFailed"), {
          description:
            errorType === "Timeout"
              ? t("timeoutError")
              : errorType === "ProxyError"
                ? `${t("proxyError")} ${errorMessage}`
                : `${t("networkError")} ${errorMessage}`,
          duration: 5000, // 延长显示时间，让用户看清楚诊断提示
        });
      }
    } catch (error) {
      console.error("测试代理连接失败:", error);
      toast.error(t("testFailedRetry"));
    } finally {
      setIsTesting(false);
    }
  };

  // 确定按钮图标和样式
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
            {t("connectionSuccess")}
          </>
        );
      } else {
        return (
          <>
            <XCircle className="h-4 w-4 mr-2 text-red-600" />
            {t("connectionFailed")}
          </>
        );
      }
    }

    return (
      <>
        <Activity className="h-4 w-4 mr-2" />
        {t("testConnection")}
      </>
    );
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleTest}
        disabled={disabled || isTesting || !providerUrl.trim()}
      >
        {getButtonContent()}
      </Button>

      {/* 显示详细测试结果 */}
      {testResult && !isTesting && (
        <div
          className={`text-xs p-2 rounded-md ${
            testResult.success
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          <div className="font-medium mb-1">{testResult.message}</div>
          {testResult.details && (
            <div className="space-y-0.5 text-xs opacity-80">
              {testResult.details.statusCode && (
                <div>
                  {t("statusCode")} {testResult.details.statusCode}
                </div>
              )}
              {testResult.details.responseTime !== undefined && (
                <div>
                  {t("responseTime")} {testResult.details.responseTime}ms
                </div>
              )}
              {testResult.details.usedProxy !== undefined && (
                <div>
                  {t("connectionMethod")} {testResult.details.usedProxy ? t("proxy") : t("direct")}
                  {testResult.details.proxyUrl && ` (${testResult.details.proxyUrl})`}
                </div>
              )}
              {testResult.details.errorType && (
                <div>
                  {t("errorType")} {testResult.details.errorType}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
