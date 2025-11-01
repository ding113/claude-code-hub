"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, Activity } from "lucide-react";
import { testProviderProxy } from "@/actions/providers";
import { toast } from "sonner";

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
      toast.error("请先填写供应商 URL");
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
        toast.error(response.error || "测试失败");
        return;
      }

      if (!response.data) {
        toast.error("测试成功但未返回结果");
        return;
      }

      setTestResult(response.data);

      // 显示测试结果
      if (response.data.success) {
        const details = response.data.details;
        const proxyUsed = details?.usedProxy ? "（通过代理）" : "（直连）";
        const responseTime = details?.responseTime ? `${details.responseTime}ms` : "N/A";

        toast.success(`连接成功 ${proxyUsed}`, {
          description: `响应时间: ${responseTime}${details?.statusCode ? ` | 状态码: ${details.statusCode}` : ""}`,
        });
      } else {
        const errorType = response.data.details?.errorType;
        const errorMessage = response.data.details?.error || response.data.message;

        toast.error("连接失败", {
          description:
            errorType === "Timeout"
              ? "连接超时（5秒）。请检查：\n1. 代理服务器是否可访问\n2. 代理地址和端口是否正确\n3. 代理认证信息是否正确"
              : errorType === "ProxyError"
                ? `代理错误: ${errorMessage}`
                : `网络错误: ${errorMessage}`,
          duration: 5000, // 延长显示时间，让用户看清楚诊断提示
        });
      }
    } catch (error) {
      console.error("测试代理连接失败:", error);
      toast.error("测试失败，请重试");
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
          测试中...
        </>
      );
    }

    if (testResult) {
      if (testResult.success) {
        return (
          <>
            <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />
            连接成功
          </>
        );
      } else {
        return (
          <>
            <XCircle className="h-4 w-4 mr-2 text-red-600" />
            连接失败
          </>
        );
      }
    }

    return (
      <>
        <Activity className="h-4 w-4 mr-2" />
        测试连接
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
              {testResult.details.statusCode && <div>状态码: {testResult.details.statusCode}</div>}
              {testResult.details.responseTime !== undefined && (
                <div>响应时间: {testResult.details.responseTime}ms</div>
              )}
              {testResult.details.usedProxy !== undefined && (
                <div>
                  连接方式: {testResult.details.usedProxy ? "代理" : "直连"}
                  {testResult.details.proxyUrl && ` (${testResult.details.proxyUrl})`}
                </div>
              )}
              {testResult.details.errorType && <div>错误类型: {testResult.details.errorType}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
