"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowRight, CheckCircle, ExternalLink, Loader2, Monitor } from "lucide-react";
import type { ProviderChainItem } from "@/types/message";
import { hasSessionMessages } from "@/actions/active-sessions";
import { formatProviderTimeline } from "@/lib/utils/provider-chain-formatter";

interface ErrorDetailsDialogProps {
  statusCode: number | null;
  errorMessage: string | null;
  providerChain: ProviderChainItem[] | null;
  sessionId: string | null;
  blockedBy?: string | null; // 拦截类型
  blockedReason?: string | null; // 拦截原因（JSON 字符串）
  originalModel?: string | null; // 原始模型（重定向前）
  currentModel?: string | null; // 当前模型（重定向后）
  userAgent?: string | null; // User-Agent
  messagesCount?: number | null; // Messages 数量
}

const blockedByLabels: Record<string, string> = {
  sensitive_word: '敏感词拦截',
};

export function ErrorDetailsDialog({
  statusCode,
  errorMessage,
  providerChain,
  sessionId,
  blockedBy,
  blockedReason,
  originalModel,
  currentModel,
  userAgent,
  messagesCount,
}: ErrorDetailsDialogProps) {
  const t = useTranslations("dashboard");
  const tChain = useTranslations("provider-chain");
  const [open, setOpen] = useState(false);
  const [hasMessages, setHasMessages] = useState(false);
  const [checkingMessages, setCheckingMessages] = useState(false);

  const isSuccess = statusCode && statusCode >= 200 && statusCode < 300;
  const isError = statusCode && (statusCode >= 400 || statusCode < 200);
  const isInProgress = !statusCode; // 没有状态码表示请求进行中
  const isBlocked = !!blockedBy; // 是否被拦截

  // 解析 blockedReason JSON
  let parsedBlockedReason: { word?: string; matchType?: string; matchedText?: string } | null = null;
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
      hasSessionMessages(sessionId)
        .then((result) => {
          if (result.ok) {
            setHasMessages(result.data);
          }
        })
        .catch((err) => {
          console.error('Failed to check session messages:', err);
        })
        .finally(() => {
          setCheckingMessages(false);
        });
    } else {
      // 弹窗关闭时重置状态
      setHasMessages(false);
      setCheckingMessages(false);
    }
  }, [open, sessionId]);

  const getStatusBadgeVariant = () => {
    if (isInProgress) return "outline"; // 请求中使用 outline 样式
    if (isSuccess) return "default";
    if (isError) return "destructive";
    return "secondary";
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto p-0 font-normal hover:bg-transparent"
        >
          <Badge variant={getStatusBadgeVariant()} className="cursor-pointer">
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
              status: isInProgress ? t("logs.details.inProgress") : statusCode || t("logs.details.unknown")
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
                    {blockedBy === 'sensitive_word' ? t("logs.details.blocked.sensitiveWord") : blockedBy}
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
                          {parsedBlockedReason.matchType === 'contains' && t("logs.details.blocked.matchTypeContains")}
                          {parsedBlockedReason.matchType === 'exact' && t("logs.details.blocked.matchTypeExact")}
                          {parsedBlockedReason.matchType === 'regex' && t("logs.details.blocked.matchTypeRegex")}
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
                  <code className="text-xs font-mono break-all">
                    {sessionId}
                  </code>
                </div>
                {hasMessages && !checkingMessages && (
                  <Link href={`/dashboard/sessions/${sessionId}/messages`}>
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
                  <code className="text-base font-mono font-semibold">{messagesCount}</code> {t("logs.details.messagesUnit")}
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
                <code className="text-xs font-mono break-all">
                  {userAgent}
                </code>
              </div>
            </div>
          )}

          {/* 模型重定向信息 */}
          {originalModel && currentModel && originalModel !== currentModel && (
            <div className="space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-blue-600" />
                {t("logs.details.modelRedirect.title")}
              </h4>
              <div className="rounded-md border bg-blue-50 dark:bg-blue-950/20 p-4 space-y-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-blue-900 dark:text-blue-100">
                      {t("logs.details.modelRedirect.requestModel")}:
                    </span>
                    <div className="mt-1">
                      <code className="bg-blue-100 dark:bg-blue-900/50 px-2 py-1 rounded text-blue-900 dark:text-blue-100">
                        {originalModel}
                      </code>
                    </div>
                  </div>
                  <div>
                    <span className="font-medium text-blue-900 dark:text-blue-100">
                      {t("logs.details.modelRedirect.actualModel")}:
                    </span>
                    <div className="mt-1">
                      <code className="bg-blue-100 dark:bg-blue-900/50 px-2 py-1 rounded text-blue-900 dark:text-blue-100">
                        {currentModel}
                      </code>
                    </div>
                  </div>
                </div>
                <div className="text-xs text-blue-800 dark:text-blue-200 border-t border-blue-200 dark:border-blue-800 pt-2">
                  <span className="font-medium">{t("logs.details.modelRedirect.billing")}:</span>{" "}
                  {t("logs.details.modelRedirect.billingDescription", { original: originalModel, current: currentModel })}
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
              <div className="rounded-md border bg-destructive/10 p-4">
                <pre className="text-xs text-destructive whitespace-pre-wrap break-words font-mono">
                  {errorMessage}
                </pre>
              </div>
            </div>
          )}

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
