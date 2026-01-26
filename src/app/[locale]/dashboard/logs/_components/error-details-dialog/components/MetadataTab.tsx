"use client";

import {
  Check,
  Clock,
  Copy,
  DollarSign,
  ExternalLink,
  Globe,
  Inbox,
  Monitor,
  Settings2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Link } from "@/i18n/routing";
import { cn, formatTokenAmount } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/currency";
import { formatProviderTimeline } from "@/lib/utils/provider-chain-formatter";
import type { MetadataTabProps } from "../types";

export function MetadataTab({
  sessionId,
  requestSequence,
  userAgent,
  endpoint,
  specialSettings,
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
  providerChain,
  hasMessages,
  checkingMessages,
}: MetadataTabProps) {
  const t = useTranslations("dashboard.logs.details");
  const tChain = useTranslations("provider-chain");
  const [timelineCopied, setTimelineCopied] = useState(false);

  const specialSettingsContent =
    specialSettings && specialSettings.length > 0 ? JSON.stringify(specialSettings, null, 2) : null;

  const handleCopyTimeline = () => {
    if (!providerChain) return;
    const { timeline } = formatProviderTimeline(providerChain, tChain);
    navigator.clipboard.writeText(timeline).then(() => {
      setTimelineCopied(true);
      setTimeout(() => setTimelineCopied(false), 2000);
    });
  };

  const hasAnyData =
    sessionId ||
    userAgent ||
    endpoint ||
    specialSettingsContent ||
    costUsd != null ||
    (providerChain && providerChain.length > 0);

  if (!hasAnyData) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">{t("metadata.noMetadata")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
      {costUsd != null && (
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

      {/* Technical Timeline */}
      {providerChain && providerChain.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-600" />
            {t("metadata.technicalTimeline")}
          </h4>
          <Collapsible defaultOpen>
            <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground">
              {tChain("technicalTimeline")}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              {(() => {
                const { timeline, totalDuration } = formatProviderTimeline(providerChain, tChain);
                return (
                  <>
                    <div className="rounded-lg border bg-muted/50 p-4 max-h-[400px] overflow-y-auto overflow-x-hidden relative group">
                      <button
                        type="button"
                        onClick={handleCopyTimeline}
                        className={cn(
                          "absolute top-2 right-2 p-1.5 rounded-md bg-background/80 border transition-opacity hover:bg-muted",
                          timelineCopied ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        )}
                        title={t("metadata.copyTimeline")}
                      >
                        {timelineCopied ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <pre className="text-xs whitespace-pre-wrap break-words font-mono leading-relaxed">
                        {timeline}
                      </pre>
                    </div>
                    {totalDuration > 0 && (
                      <div className="text-xs text-muted-foreground text-right mt-1">
                        {t("providerChain.totalDuration", { duration: totalDuration })}
                      </div>
                    )}
                  </>
                );
              })()}
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}
    </div>
  );
}
