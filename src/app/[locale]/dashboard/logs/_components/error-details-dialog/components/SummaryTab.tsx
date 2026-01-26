"use client";

import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  Clock,
  DollarSign,
  ExternalLink,
  Globe,
  Loader2,
  Monitor,
  Settings2,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/routing";
import { cn, formatTokenAmount } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/currency";
import {
  calculateOutputRate,
  isInProgressStatus,
  isSuccessStatus,
  type SummaryTabProps,
  shouldHideOutputRate,
} from "../types";

export function SummaryTab({
  statusCode,
  errorMessage,
  originalModel,
  currentModel,
  billingModelSource = "original",
  inputTokens,
  outputTokens,
  cacheCreationInputTokens,
  cacheCreation5mInputTokens,
  cacheCreation1hInputTokens,
  cacheReadInputTokens,
  cacheTtlApplied,
  costUsd,
  costMultiplier,
  context1mApplied,
  durationMs,
  ttfbMs,
  sessionId,
  requestSequence,
  userAgent,
  endpoint,
  specialSettings,
  hasMessages,
  checkingMessages,
  onViewLogicTrace,
}: SummaryTabProps) {
  const t = useTranslations("dashboard.logs.details");

  const isSuccess = isSuccessStatus(statusCode);
  const isInProgress = isInProgressStatus(statusCode);
  const outputRate = calculateOutputRate(outputTokens, durationMs, ttfbMs);
  const hideRate = shouldHideOutputRate(outputRate, durationMs, ttfbMs);
  const totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);
  const hasRedirect = originalModel && currentModel && originalModel !== currentModel;
  const specialSettingsContent =
    specialSettings && specialSettings.length > 0 ? JSON.stringify(specialSettings, null, 2) : null;

  return (
    <div className="space-y-6">
      {/* Status Hero */}
      <div
        className={cn(
          "flex items-center gap-4 p-4 rounded-lg border",
          isInProgress && "bg-muted/50 border-muted",
          isSuccess &&
            "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800",
          !isInProgress &&
            !isSuccess &&
            "bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800"
        )}
      >
        <div
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-full",
            isInProgress && "bg-muted",
            isSuccess && "bg-emerald-100 dark:bg-emerald-900/30",
            !isInProgress && !isSuccess && "bg-rose-100 dark:bg-rose-900/30"
          )}
        >
          {isInProgress ? (
            <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
          ) : isSuccess ? (
            <CheckCircle className="h-6 w-6 text-emerald-600" />
          ) : (
            <AlertCircle className="h-6 w-6 text-rose-600" />
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">
              {isInProgress ? t("inProgress") : statusCode || t("unknown")}
            </span>
            {statusCode && (
              <Badge variant={isSuccess ? "default" : "destructive"} className="text-xs">
                {isSuccess ? "OK" : "Error"}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {isInProgress ? t("processing") : isSuccess ? t("success") : t("error")}
          </p>
        </div>
      </div>

      {/* Key Metrics Grid */}
      {(costUsd || totalTokens > 0 || durationMs || (outputRate && !hideRate)) && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-muted-foreground">{t("summary.keyMetrics")}</h4>
          <div className="grid grid-cols-2 gap-3">
            {/* Total Cost */}
            {costUsd && (
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                  <DollarSign className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("summary.totalCost")}</p>
                  <p className="text-sm font-semibold font-mono">
                    {formatCurrency(costUsd, "USD", 6)}
                  </p>
                </div>
              </div>
            )}

            {/* Total Tokens */}
            {totalTokens > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                  <Zap className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("summary.totalTokens")}</p>
                  <p className="text-sm font-semibold font-mono">
                    {formatTokenAmount(totalTokens)}
                  </p>
                </div>
              </div>
            )}

            {/* Duration */}
            {durationMs !== null && durationMs !== undefined && (
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                  <Clock className="h-4 w-4 text-purple-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("summary.duration")}</p>
                  <p className="text-sm font-semibold font-mono">
                    {durationMs >= 1000
                      ? `${(durationMs / 1000).toFixed(2)}s`
                      : `${Math.round(durationMs)}ms`}
                  </p>
                </div>
              </div>
            )}

            {/* Output Rate */}
            {outputRate !== null && !hideRate && (
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <Zap className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("summary.outputRate")}</p>
                  <p className="text-sm font-semibold font-mono">{outputRate.toFixed(1)} tok/s</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Session Info */}
      {sessionId && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">{t("metadata.sessionInfo")}</h4>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
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
                    {t("viewDetails")}
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Client Info */}
      {(userAgent || endpoint) && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Monitor className="h-4 w-4 text-blue-600" />
            {t("metadata.clientInfo")}
          </h4>
          <div className="rounded-lg border bg-card divide-y">
            {userAgent && (
              <div className="p-3">
                <p className="text-xs text-muted-foreground mb-1">User-Agent</p>
                <code className="text-xs font-mono break-all">{userAgent}</code>
              </div>
            )}
            {endpoint && (
              <div className="p-3">
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  Endpoint
                </p>
                <code className="text-xs font-mono break-all">{endpoint}</code>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Billing Details */}
      {costUsd && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-600" />
            {t("metadata.billingInfo")}
          </h4>
          <div className="rounded-lg border bg-card p-4 space-y-3">
            {/* Token breakdown */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("billingDetails.input")}:</span>
                <span className="font-mono">{formatTokenAmount(inputTokens)} tokens</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("billingDetails.output")}:</span>
                <span className="font-mono">{formatTokenAmount(outputTokens)} tokens</span>
              </div>

              {/* Cache Write 5m */}
              {((cacheCreation5mInputTokens ?? 0) > 0 ||
                ((cacheCreationInputTokens ?? 0) > 0 && cacheTtlApplied !== "1h")) && (
                <div className="flex justify-between col-span-2">
                  <span className="text-muted-foreground">{t("billingDetails.cacheWrite5m")}:</span>
                  <span className="font-mono">
                    {formatTokenAmount(
                      (cacheCreation5mInputTokens ?? 0) > 0
                        ? cacheCreation5mInputTokens
                        : cacheCreationInputTokens
                    )}{" "}
                    tokens <span className="text-orange-600">(1.25x)</span>
                  </span>
                </div>
              )}

              {/* Cache Write 1h */}
              {((cacheCreation1hInputTokens ?? 0) > 0 ||
                ((cacheCreationInputTokens ?? 0) > 0 && cacheTtlApplied === "1h")) && (
                <div className="flex justify-between col-span-2">
                  <span className="text-muted-foreground">{t("billingDetails.cacheWrite1h")}:</span>
                  <span className="font-mono">
                    {formatTokenAmount(
                      (cacheCreation1hInputTokens ?? 0) > 0
                        ? cacheCreation1hInputTokens
                        : cacheCreationInputTokens
                    )}{" "}
                    tokens <span className="text-orange-600">(2x)</span>
                  </span>
                </div>
              )}

              {/* Cache Read */}
              {(cacheReadInputTokens ?? 0) > 0 && (
                <div className="flex justify-between col-span-2">
                  <span className="text-muted-foreground">{t("billingDetails.cacheRead")}:</span>
                  <span className="font-mono">
                    {formatTokenAmount(cacheReadInputTokens)} tokens{" "}
                    <span className="text-emerald-600">(0.1x)</span>
                  </span>
                </div>
              )}

              {/* Cache TTL */}
              {cacheTtlApplied && (
                <div className="flex justify-between items-center col-span-2">
                  <span className="text-muted-foreground">{t("billingDetails.cacheTtl")}:</span>
                  <Badge variant="outline" className="text-xs">
                    {cacheTtlApplied}
                  </Badge>
                </div>
              )}

              {/* 1M Context */}
              {context1mApplied && (
                <div className="flex justify-between items-center col-span-2">
                  <span className="text-muted-foreground">{t("billingDetails.context1m")}:</span>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="text-xs bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-800"
                    >
                      1M Context
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      ({t("billingDetails.context1mPricing")})
                    </span>
                  </div>
                </div>
              )}

              {/* Cost Multiplier */}
              {(() => {
                if (costMultiplier === "" || costMultiplier == null) return null;
                const multiplier = Number(costMultiplier);
                if (!Number.isFinite(multiplier) || multiplier === 1) return null;
                return (
                  <div className="flex justify-between col-span-2">
                    <span className="text-muted-foreground">{t("billingDetails.multiplier")}:</span>
                    <span className="font-mono">{multiplier.toFixed(2)}x</span>
                  </div>
                );
              })()}
            </div>

            {/* Total Cost */}
            <div className="pt-3 border-t flex justify-between items-center">
              <span className="font-medium">{t("billingDetails.totalCost")}:</span>
              <span className="font-mono text-lg font-semibold text-emerald-600">
                {formatCurrency(costUsd, "USD", 6)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Special Settings */}
      {specialSettingsContent && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-purple-600" />
            {t("specialSettings.title")}
          </h4>
          <div className="rounded-lg border bg-card p-4">
            <pre className="text-xs whitespace-pre-wrap break-words font-mono">
              {specialSettingsContent}
            </pre>
          </div>
        </div>
      )}

      {/* Model Redirect */}
      {hasRedirect && (
        <div id="model-redirect-section" className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-blue-600" />
            {t("modelRedirect.title")}
          </h4>
          <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/20 p-3">
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <code
                className={cn(
                  "px-1.5 py-0.5 rounded text-xs",
                  billingModelSource === "original"
                    ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 ring-1 ring-emerald-300 dark:ring-emerald-700"
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
                    ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 ring-1 ring-emerald-300 dark:ring-emerald-700"
                    : "bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200"
                )}
              >
                {currentModel}
              </code>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {billingModelSource === "original"
                ? t("modelRedirect.billingOriginal")
                : t("modelRedirect.billingRedirected")}
            </p>
          </div>
        </div>
      )}

      {/* Error Summary */}
      {errorMessage && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-600" />
            {t("errorMessage")}
          </h4>
          <div className="rounded-lg border bg-rose-50 dark:bg-rose-950/20 p-3">
            <p className="text-xs text-rose-800 dark:text-rose-200 line-clamp-3 font-mono">
              {errorMessage.length > 200 ? `${errorMessage.slice(0, 200)}...` : errorMessage}
            </p>
            {errorMessage.length > 200 && onViewLogicTrace && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 mt-2 text-xs"
                onClick={onViewLogicTrace}
              >
                {t("summary.viewFullError")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
