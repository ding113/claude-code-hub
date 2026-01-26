"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { cn, formatTokenAmount } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/utils/currency";
import { formatCurrency } from "@/lib/utils/currency";
import {
  calculateOutputRate,
  formatDuration,
  NON_BILLING_ENDPOINT,
} from "@/lib/utils/performance-formatter";
import type { ProviderChainItem } from "@/types/message";
import type { BillingModelSource } from "@/types/system-config";

export interface MobileLogCardProps {
  log: {
    id: number;
    createdAt: Date;
    statusCode: number | null;
    userName: string;
    keyName: string;
    providerName: string | null;
    providerChain: ProviderChainItem[] | null;
    model: string | null;
    originalModel: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    cacheCreationInputTokens: number | null;
    cacheReadInputTokens: number | null;
    costUsd: string | null;
    costMultiplier: string | null;
    durationMs: number | null;
    ttfbMs: number | null;
    endpoint: string | null;
    blockedBy: string | null;
    sessionId: string | null;
    requestSequence: number | null;
  };
  currencyCode: CurrencyCode;
  billingModelSource: BillingModelSource;
  onClick: () => void;
}

export function MobileLogCard({
  log,
  currencyCode,
  billingModelSource,
  onClick,
}: MobileLogCardProps) {
  const t = useTranslations("dashboard");

  const isNonBilling = log.endpoint === NON_BILLING_ENDPOINT;
  const isBlocked = !!log.blockedBy;
  const statusCode = log.statusCode;

  const getStatusBadgeClassName = () => {
    if (!statusCode) {
      return "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600";
    }
    if (statusCode >= 200 && statusCode < 300) {
      return "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700";
    }
    if (statusCode >= 400 && statusCode < 500) {
      return "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700";
    }
    if (statusCode >= 500) {
      return "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700";
    }
    return "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600";
  };

  const getStatusText = () => {
    if (isBlocked) return t("logs.table.blocked");
    if (!statusCode) return t("logs.details.inProgress");
    if (statusCode >= 200 && statusCode < 300) return `OK ${statusCode}`;
    return `${statusCode}`;
  };

  const hasModelRedirect = log.originalModel && log.model && log.originalModel !== log.model;

  const displayModel =
    billingModelSource === "original"
      ? log.originalModel || log.model
      : log.model || log.originalModel;

  const successfulProvider =
    log.providerChain && log.providerChain.length > 0
      ? [...log.providerChain]
          .reverse()
          .find((item) => item.reason === "request_success" || item.reason === "retry_success")
      : null;
  const actualCostMultiplier = successfulProvider?.costMultiplier ?? log.costMultiplier;
  const multiplier = Number(actualCostMultiplier);
  const hasCostMultiplier =
    actualCostMultiplier !== "" &&
    actualCostMultiplier != null &&
    Number.isFinite(multiplier) &&
    multiplier !== 1;

  const providerDisplay = isBlocked
    ? "-"
    : log.providerChain && log.providerChain.length > 0
      ? log.providerChain[log.providerChain.length - 1].name
      : log.providerName || "-";

  const rate = calculateOutputRate(log.outputTokens, log.durationMs, log.ttfbMs);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "rounded-lg border p-3 cursor-pointer transition-colors",
        "hover:bg-muted/50 active:bg-muted/70",
        isNonBilling && "bg-muted/60 dark:bg-muted/20"
      )}
    >
      {/* Header: Time + Status */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs text-muted-foreground">
          <RelativeTime date={log.createdAt} fallback="-" format="short" />
        </span>
        <Badge
          variant="outline"
          className={cn(
            "text-xs",
            isBlocked ? "border-orange-600 text-orange-600" : getStatusBadgeClassName()
          )}
        >
          {getStatusText()}
        </Badge>
      </div>

      {/* Identity: User + Provider + Model */}
      <div className="mb-2 space-y-0.5">
        <div className="text-sm truncate">
          <span className="font-medium">{log.userName}</span>
          <span className="text-muted-foreground"> - </span>
          <span className="text-muted-foreground">{providerDisplay}</span>
          {log.sessionId && log.requestSequence && (
            <Badge variant="outline" className="ml-1 text-[10px] px-1">
              #{log.requestSequence}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
          {hasModelRedirect ? (
            <>
              <span className="truncate max-w-[120px]">{log.originalModel}</span>
              <ArrowRight className="h-3 w-3 flex-shrink-0 text-blue-500" />
              <span className="truncate max-w-[120px]">{log.model}</span>
            </>
          ) : (
            <span className="truncate">{displayModel || "-"}</span>
          )}
          {hasCostMultiplier && (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] ml-1",
                multiplier > 1
                  ? "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-800"
                  : "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-800"
              )}
            >
              x{multiplier.toFixed(2)}
            </Badge>
          )}
        </div>
      </div>

      {/* Data: Tokens + Cache + Cost */}
      <div className="grid grid-cols-3 gap-2 mb-2 text-xs">
        {/* Tokens */}
        <div className="space-y-0.5">
          <div className="text-muted-foreground text-[10px]">{t("logs.columns.tokens")}</div>
          <div className="font-mono tabular-nums">
            <div>In: {formatTokenAmount(log.inputTokens)}</div>
            <div className="text-muted-foreground">Out: {formatTokenAmount(log.outputTokens)}</div>
          </div>
        </div>

        {/* Cache */}
        <div className="space-y-0.5">
          <div className="text-muted-foreground text-[10px]">{t("logs.columns.cache")}</div>
          <div className="font-mono tabular-nums">
            <div>W: {formatTokenAmount(log.cacheCreationInputTokens)}</div>
            <div className="text-muted-foreground">
              R: {formatTokenAmount(log.cacheReadInputTokens)}
            </div>
          </div>
        </div>

        {/* Cost */}
        <div className="space-y-0.5">
          <div className="text-muted-foreground text-[10px]">{t("logs.columns.cost")}</div>
          <div className="font-mono tabular-nums">
            {isNonBilling ? (
              <span className="text-muted-foreground">-</span>
            ) : log.costUsd ? (
              formatCurrency(log.costUsd, currencyCode, 4)
            ) : (
              "-"
            )}
          </div>
        </div>
      </div>

      {/* Performance: Duration + TTFB + Rate */}
      <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
        <span>{formatDuration(log.durationMs)}</span>
        {log.ttfbMs != null && log.ttfbMs > 0 && <span>TTFB {formatDuration(log.ttfbMs)}</span>}
        {rate !== null && <span>{rate.toFixed(0)} tok/s</span>}
      </div>
    </div>
  );
}
