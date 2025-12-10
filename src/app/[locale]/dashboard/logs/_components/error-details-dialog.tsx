"use client";

import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  DollarSign,
  ExternalLink,
  Loader2,
  Monitor,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { hasSessionMessages } from "@/actions/active-sessions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Link } from "@/i18n/routing";
import { cn, formatTokenAmount } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/currency";
import { formatProviderTimeline } from "@/lib/utils/provider-chain-formatter";
import type { ProviderChainItem } from "@/types/message";
import type { BillingModelSource } from "@/types/system-config";

interface ErrorDetailsDialogProps {
  statusCode: number | null;
  errorMessage: string | null;
  providerChain: ProviderChainItem[] | null;
  sessionId: string | null;
  requestSequence?: number | null; // Request Sequence（Session 内请求序号）
  blockedBy?: string | null; // 拦截类型
  blockedReason?: string | null; // 拦截原因（JSON 字符串）
  originalModel?: string | null; // 原始模型（重定向前）
  currentModel?: string | null; // 当前模型（重定向后）
  userAgent?: string | null; // User-Agent
  messagesCount?: number | null; // Messages 数量
  endpoint?: string | null; // API 端点
  billingModelSource?: BillingModelSource; // 计费模型来源
  // 计费详情
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheCreation5mInputTokens?: number | null;
  cacheCreation1hInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  cacheTtlApplied?: string | null;
  costUsd?: string | null;
  costMultiplier?: string | null;
  externalOpen?: boolean; // 外部控制弹窗开关
  onExternalOpenChange?: (open: boolean) => void; // 外部控制回调
  scrollToRedirect?: boolean; // 是否滚动到重定向部分
}

export function ErrorDetailsDialog({
  statusCode,
  errorMessage,
  providerChain,
  sessionId,
  requestSequence,
  blockedBy,
  blockedReason,
  originalModel,
  currentModel,
  userAgent,
  messagesCount,
  endpoint,
  billingModelSource = "original",
  inputTokens,
  outputTokens,
  cacheCreation5mInputTokens,
  cacheCreation1hInputTokens,
  cacheReadInputTokens,
  cacheTtlApplied,
  costUsd,
  costMultiplier,
  externalOpen,
  onExternalOpenChange,
  scrollToRedirect,
}: ErrorDetailsDialogProps) {
  const t = useTranslations("dashboard");
  const tChain = useTranslations("provider-chain");
  const [internalOpen, setInternalOpen] = useState(false);
  const [hasMessages, setHasMessages] = useState(false);
  const [checkingMessages, setCheckingMessages] = useState(false);

  // 支持外部控制和内部控制
  const isControlled = externalOpen !== undefined;
  const open = isControlled ? externalOpen : internalOpen;
  const setOpen = (value: boolean) => {
    if (isControlled) {
      onExternalOpenChange?.(value);
    } else {
      setInternalOpen(value);
    }
  };

  const isSuccess = statusCode && statusCode >= 200 && statusCode < 300;
  const isInProgress = !statusCode; // 没有状态码表示请求进行中
  const isBlocked = !!blockedBy; // 是否被拦截

  // 解析 blockedReason JSON
  let parsedBlockedReason: { word?: string; matchType?: string; matchedText?: string } | null =
    null;
  if (blockedReason) {
    try {
      parsedBlockedReason = JSON.parse(blockedReason);
    } catch {
      // 解析失败，忽略
    }
  }

  // 检查 session 是否有 messages 数据
  useEffect(() => {
    if (open && sessionId) {
      setCheckingMessages(true);
      hasSessionMessages(sessionId, requestSequence ?? undefined)
        .then((result) => {
          if (result.ok) {
            setHasMessages(result.data);
          }
        })
        .catch((err) => {
          console.error("Failed to check session messages:", err);
        })
        .finally(() => {
          setCheckingMessages(false);
        });
    } else {
      // 弹窗关闭时重置状态
      setHasMessages(false);
      setCheckingMessages(false);
    }
  }, [open, sessionId, requestSequence]);

  // 滚动到重定向部分
  useEffect(() => {
    if (open && scrollToRedirect) {
      // 等待 DOM 渲染完成后滚动
      const timer = setTimeout(() => {
        const element = document.getElementById("model-redirect-section");
        element?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [open, scrollToRedirect]);

  /**
   * 根据 HTTP 状态码返回对应的 Badge 样式类名
   * 参考：new-api 和 gpt-load 的颜色方案，使用更明显的颜色区分
   *
   * 颜色方案：
   * - 2xx (成功) - 绿色
   * - 3xx (重定向) - 蓝色
   * - 4xx (客户端错误) - 黄色
   * - 5xx (服务器错误) - 红色
   * - 进行中 - 灰色
   */
  const getStatusBadgeClassName = () => {
    if (isInProgress) {
      // 进行中 - 灰色
      return "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600";
    }

    if (!statusCode) {
      return "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600";
    }

    // 2xx - 成功 (绿色)
    if (statusCode >= 200 && statusCode < 300) {
      return "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700";
    }

    // 3xx - 重定向 (蓝色)
    if (statusCode >= 300 && statusCode < 400) {
      return "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700";
    }

    // 4xx - 客户端错误 (黄色)
    if (statusCode >= 400 && statusCode < 500) {
      return "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700";
    }

    // 5xx - 服务器错误 (红色)
    if (statusCode >= 500) {
      return "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700";
    }

    // 其他 - 灰色
    return "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600";
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="h-auto p-0 font-normal hover:bg-transparent">
          <Badge variant="outline" className={getStatusBadgeClassName()}>
            {isInProgress ? t("logs.details.inProgress") : statusCode}
          </Badge>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isInProgress ? (
              <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
            ) : isSuccess ? (
              <CheckCircle className="h-5 w-5 text-green-600" />
            ) : (
              <AlertCircle className="h-5 w-5 text-destructive" />
            )}
            {t("logs.details.statusTitle", {
              status: isInProgress
                ? t("logs.details.inProgress")
                : statusCode || t("logs.details.unknown"),
            })}
          </DialogTitle>
          <DialogDescription>
            {isInProgress
              ? t("logs.details.processing")
              : isSuccess
                ? t("logs.details.success")
                : t("logs.details.error")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* 拦截信息 */}
          {isBlocked && blockedBy && (
            <div className="space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                {t("logs.details.blocked.title")}
              </h4>
              <div className="rounded-md border bg-orange-50 dark:bg-orange-950/20 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-orange-900 dark:text-orange-100">
                    {t("logs.details.blocked.type")}:
                  </span>
                  <Badge variant="outline" className="border-orange-600 text-orange-600">
                    {blockedBy === "sensitive_word"
                      ? t("logs.details.blocked.sensitiveWord")
                      : blockedBy}
                  </Badge>
                </div>
                {parsedBlockedReason && (
                  <div className="space-y-1 text-xs">
                    {parsedBlockedReason.word && (
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium text-orange-900 dark:text-orange-100">
                          {t("logs.details.blocked.word")}:
                        </span>
                        <code className="bg-orange-100 dark:bg-orange-900/50 px-2 py-0.5 rounded text-orange-900 dark:text-orange-100">
                          {parsedBlockedReason.word}
                        </code>
                      </div>
                    )}
                    {parsedBlockedReason.matchType && (
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium text-orange-900 dark:text-orange-100">
                          {t("logs.details.blocked.matchType")}:
                        </span>
                        <span className="text-orange-800 dark:text-orange-200">
                          {parsedBlockedReason.matchType === "contains" &&
                            t("logs.details.blocked.matchTypeContains")}
                          {parsedBlockedReason.matchType === "exact" &&
                            t("logs.details.blocked.matchTypeExact")}
                          {parsedBlockedReason.matchType === "regex" &&
                            t("logs.details.blocked.matchTypeRegex")}
                        </span>
                      </div>
                    )}
                    {parsedBlockedReason.matchedText && (
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-orange-900 dark:text-orange-100">
                          {t("logs.details.blocked.matchedText")}:
                        </span>
                        <pre className="bg-orange-100 dark:bg-orange-900/50 px-2 py-1 rounded text-orange-900 dark:text-orange-100 whitespace-pre-wrap break-words">
                          {parsedBlockedReason.matchedText}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Session 信息 */}
          {sessionId && (
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">{t("logs.details.sessionId")}</h4>
              <div className="flex items-center gap-3">
                <div className="flex-1 rounded-md border bg-muted/50 p-3">
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono break-all">{sessionId}</code>
                    {requestSequence && (
                      <Badge variant="outline" className="text-xs shrink-0">
                        #{requestSequence}
                      </Badge>
                    )}
                  </div>
                </div>
                {hasMessages && !checkingMessages && (
                  <Link
                    href={
                      requestSequence
                        ? `/dashboard/sessions/${sessionId}/messages?seq=${requestSequence}`
                        : `/dashboard/sessions/${sessionId}/messages`
                    }
                  >
                    <Button variant="outline" size="sm">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      {t("logs.details.viewDetails")}
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Messages 数量 */}
          {messagesCount !== null && messagesCount !== undefined && (
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">{t("logs.details.messagesCount")}</h4>
              <div className="rounded-md border bg-muted/50 p-3">
                <div className="text-sm">
                  <span className="font-medium">{t("logs.details.messagesLabel")}:</span>{" "}
                  <code className="text-base font-mono font-semibold">{messagesCount}</code>{" "}
                  {t("logs.details.messagesUnit")}
                </div>
              </div>
            </div>
          )}

          {/* User-Agent 信息 */}
          {userAgent && (
            <div className="space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Monitor className="h-4 w-4 text-blue-600" />
                {t("logs.details.clientInfo")}
              </h4>
              <div className="rounded-md border bg-muted/50 p-3">
                <code className="text-xs font-mono break-all">{userAgent}</code>
              </div>
            </div>
          )}

          {/* Endpoint 信息 */}
          {endpoint && (
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">{t("logs.columns.endpoint")}</h4>
              <div className="rounded-md border bg-muted/50 p-3">
                <code className="text-xs font-mono break-all">{endpoint}</code>
              </div>
            </div>
          )}

          {/* 计费详情 */}
          {costUsd && (
            <div className="space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-green-600" />
                {t("logs.details.billingDetails.title")}
              </h4>
              <div className="rounded-md border bg-muted/50 p-4">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("logs.billingDetails.input")}:</span>
                    <span className="font-mono">{formatTokenAmount(inputTokens)} tokens</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("logs.billingDetails.output")}:
                    </span>
                    <span className="font-mono">{formatTokenAmount(outputTokens)} tokens</span>
                  </div>
                  {(cacheCreation5mInputTokens ?? 0) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("logs.billingDetails.cacheWrite5m")}:
                      </span>
                      <span className="font-mono">
                        {formatTokenAmount(cacheCreation5mInputTokens)} tokens{" "}
                        <span className="text-orange-600">(1.25x)</span>
                      </span>
                    </div>
                  )}
                  {(cacheCreation1hInputTokens ?? 0) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("logs.billingDetails.cacheWrite1h")}:
                      </span>
                      <span className="font-mono">
                        {formatTokenAmount(cacheCreation1hInputTokens)} tokens{" "}
                        <span className="text-orange-600">(2x)</span>
                      </span>
                    </div>
                  )}
                  {(cacheReadInputTokens ?? 0) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("logs.billingDetails.cacheRead")}:
                      </span>
                      <span className="font-mono">
                        {formatTokenAmount(cacheReadInputTokens)} tokens{" "}
                        <span className="text-green-600">(0.1x)</span>
                      </span>
                    </div>
                  )}
                  {cacheTtlApplied && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("logs.billingDetails.cacheTtl")}:
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {cacheTtlApplied}
                      </Badge>
                    </div>
                  )}
                  {costMultiplier && parseFloat(String(costMultiplier)) !== 1.0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("logs.billingDetails.multiplier")}:
                      </span>
                      <span className="font-mono">
                        {parseFloat(String(costMultiplier)).toFixed(2)}x
                      </span>
                    </div>
                  )}
                </div>
                <div className="mt-3 pt-3 border-t flex justify-between items-center">
                  <span className="font-medium">{t("logs.billingDetails.totalCost")}:</span>
                  <span className="font-mono text-lg font-semibold text-green-600">
                    {formatCurrency(costUsd, "USD", 6)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 模型重定向信息 */}
          {originalModel && currentModel && originalModel !== currentModel && (
            <div id="model-redirect-section" className="space-y-1.5">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-blue-600" />
                {t("logs.details.modelRedirect.title")}
              </h4>
              <div className="rounded-md border bg-blue-50 dark:bg-blue-950/20 px-3 py-2">
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <code
                    className={cn(
                      "px-1.5 py-0.5 rounded text-xs",
                      billingModelSource === "original"
                        ? "bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200 ring-1 ring-green-300 dark:ring-green-700"
                        : "bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200"
                    )}
                  >
                    {originalModel}
                  </code>
                  <ArrowRight className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                  <code
                    className={cn(
                      "px-1.5 py-0.5 rounded text-xs",
                      billingModelSource === "redirected"
                        ? "bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200 ring-1 ring-green-300 dark:ring-green-700"
                        : "bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200"
                    )}
                  >
                    {currentModel}
                  </code>
                  <span className="text-xs text-muted-foreground ml-1">
                    (
                    {billingModelSource === "original"
                      ? t("logs.details.modelRedirect.billingOriginal")
                      : t("logs.details.modelRedirect.billingRedirected")}
                    )
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 最终错误信息 */}
          {errorMessage && (
            <div className="space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {t("logs.details.errorMessage")}
              </h4>

              {/* 尝试解析 JSON 错误 */}
              {(() => {
                try {
                  const error = JSON.parse(errorMessage);

                  // 检查是否是限流错误
                  if (
                    error.code === "rate_limit_exceeded" ||
                    error.code === "circuit_breaker_open" ||
                    error.code === "mixed_unavailable"
                  ) {
                    return (
                      <div className="rounded-md border bg-orange-50 dark:bg-orange-950/20 p-4 space-y-3">
                        <div className="font-semibold text-orange-900 dark:text-orange-100 flex items-center gap-2">
                          <DollarSign className="h-4 w-4" />
                          {error.message}
                        </div>
                        {error.details?.filteredProviders &&
                          error.details.filteredProviders.length > 0 && (
                            <div className="space-y-2">
                              <div className="text-sm font-medium text-orange-900 dark:text-orange-100">
                                {t("logs.details.filteredProviders")}:
                              </div>
                              <ul className="text-sm space-y-1">
                                {error.details.filteredProviders
                                  .filter(
                                    (p: { reason: string }) =>
                                      p.reason === "rate_limited" || p.reason === "circuit_open"
                                  )
                                  .map((p: { id: number; name: string; details: string }) => (
                                    <li
                                      key={p.id}
                                      className="text-orange-800 dark:text-orange-200 flex items-center gap-2"
                                    >
                                      <span className="text-orange-600">•</span>
                                      <span className="font-medium">{p.name}</span>
                                      <span className="text-xs">({p.details})</span>
                                    </li>
                                  ))}
                              </ul>
                            </div>
                          )}
                      </div>
                    );
                  }

                  // 其他 JSON 错误，格式化显示
                  return (
                    <div className="rounded-md border bg-destructive/10 p-4">
                      <pre className="text-xs text-destructive whitespace-pre-wrap break-words font-mono">
                        {JSON.stringify(error, null, 2)}
                      </pre>
                    </div>
                  );
                } catch {
                  // 解析失败，显示原始消息
                  return (
                    <div className="rounded-md border bg-destructive/10 p-4">
                      <pre className="text-xs text-destructive whitespace-pre-wrap break-words font-mono">
                        {errorMessage}
                      </pre>
                    </div>
                  );
                }
              })()}
            </div>
          )}

          {/* 被过滤的供应商（仅在成功请求时显示） */}
          {isSuccess &&
            providerChain &&
            providerChain.length > 0 &&
            (() => {
              // 从决策链中提取被过滤的供应商
              const filteredProviders = providerChain
                .flatMap((item) => item.decisionContext?.filteredProviders || [])
                .filter((p) => p.reason === "rate_limited" || p.reason === "circuit_open");

              if (filteredProviders.length === 0) return null;

              return (
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-orange-600" />
                    {t("logs.details.filteredProviders")}
                  </h4>
                  <div className="rounded-md border bg-orange-50 dark:bg-orange-950/20 p-4">
                    <ul className="text-sm space-y-2">
                      {filteredProviders.map((p, index) => (
                        <li
                          key={`${p.id}-${index}`}
                          className="text-orange-800 dark:text-orange-200 flex items-start gap-2"
                        >
                          <DollarSign className="h-4 w-4 text-orange-600 mt-0.5 flex-shrink-0" />
                          <div className="flex-1">
                            <span className="font-medium">{p.name}</span>
                            <span className="text-xs ml-2">
                              (
                              {t(
                                `logs.details.reasons.${p.reason === "rate_limited" ? "rateLimited" : "circuitOpen"}`
                              )}
                              )
                            </span>
                            {p.details && (
                              <div className="text-xs text-orange-700 dark:text-orange-300 mt-0.5">
                                {p.details}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })()}

          {/* 供应商决策链时间线 */}
          {providerChain && providerChain.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">{t("logs.details.providerChain.title")}</h4>

              {(() => {
                const { timeline, totalDuration } = formatProviderTimeline(providerChain, tChain);
                return (
                  <>
                    <div className="rounded-md border bg-muted/50 p-4 max-h-[500px] overflow-y-auto overflow-x-hidden">
                      <pre className="text-xs whitespace-pre-wrap break-words font-mono leading-relaxed">
                        {timeline}
                      </pre>
                    </div>

                    {totalDuration > 0 && (
                      <div className="text-xs text-muted-foreground text-right">
                        {t("logs.details.providerChain.totalDuration", { duration: totalDuration })}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* 无错误信息的情况 */}
          {!errorMessage && (!providerChain || providerChain.length === 0) && (
            <div className="text-center py-8 text-muted-foreground">
              {isInProgress
                ? t("logs.details.noError.processing")
                : isSuccess
                  ? t("logs.details.noError.success")
                  : t("logs.details.noError.default")}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
