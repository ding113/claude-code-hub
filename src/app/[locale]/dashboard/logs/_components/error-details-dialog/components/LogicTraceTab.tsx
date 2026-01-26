"use client";

import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle,
  Clock,
  Copy,
  Database,
  Filter,
  GitBranch,
  Globe,
  Layers,
  Link2,
  RefreshCw,
  Server,
  XCircle,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { formatProbability, formatProviderTimeline } from "@/lib/utils/provider-chain-formatter";
import type { ProviderChainItem } from "@/types/message";
import { type LogicTraceTabProps, parseBlockedReason } from "../types";
import { StepCard, type StepStatus } from "./StepCard";

function getRequestStatus(item: ProviderChainItem): StepStatus {
  // Check for session reuse first
  if (item.reason === "session_reuse" || item.selectionMethod === "session_reuse") {
    return "session_reuse";
  }
  if (item.reason === "request_success" || item.reason === "retry_success") {
    return "success";
  }
  if (
    item.reason === "retry_failed" ||
    item.reason === "system_error" ||
    item.reason === "client_error_non_retryable" ||
    item.reason === "concurrent_limit_failed"
  ) {
    return "failure";
  }
  // http2_fallback and other retry-related reasons are treated as pending/in-progress
  return "pending";
}

export function LogicTraceTab({
  statusCode,
  providerChain,
  blockedBy,
  blockedReason,
  requestSequence,
}: LogicTraceTabProps) {
  const t = useTranslations("dashboard.logs.details");
  const tChain = useTranslations("provider-chain");
  const [timelineCopied, setTimelineCopied] = useState(false);

  const handleCopyTimeline = async () => {
    if (!providerChain) return;
    const { timeline } = formatProviderTimeline(providerChain, tChain);
    try {
      await navigator.clipboard.writeText(timeline);
      setTimelineCopied(true);
      setTimeout(() => setTimelineCopied(false), 2000);
    } catch {
      // Clipboard write failed - ignore silently
    }
  };

  const isWarmupSkipped = blockedBy === "warmup";
  const isBlocked = !!blockedBy && !isWarmupSkipped;
  const parsedBlockedReason = parseBlockedReason(blockedReason);

  // Check if this is a session reuse flow (provider reused from session cache)
  const isSessionReuseFlow =
    providerChain?.[0]?.reason === "session_reuse" ||
    providerChain?.[0]?.selectionMethod === "session_reuse";

  // Extract session reuse context from first chain item
  const sessionReuseContext = isSessionReuseFlow ? providerChain?.[0]?.decisionContext : undefined;
  const sessionReuseProvider = isSessionReuseFlow ? providerChain?.[0] : undefined;

  // Extract decision context from first chain item (not used for session reuse)
  const decisionContext = isSessionReuseFlow ? undefined : providerChain?.[0]?.decisionContext;

  // Extract filtered providers from all chain items (not applicable for session reuse)
  const filteredProviders = isSessionReuseFlow
    ? []
    : providerChain?.flatMap((item) => item.decisionContext?.filteredProviders || []) || [];

  // Get base timestamp for relative time calculations
  const baseTimestamp = providerChain?.[0]?.timestamp || 0;

  // Count providers at each stage
  const totalProviders = decisionContext?.totalProviders || 0;
  const afterHealthCheck = decisionContext?.afterHealthCheck || 0;

  // Calculate step offset for session reuse flow
  const sessionReuseStepOffset = isSessionReuseFlow ? 1 : 0;

  return (
    <div className="space-y-6">
      {/* Warmup Skip Info */}
      {isWarmupSkipped && (
        <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
              {t("skipped.title")}
            </span>
            <Badge variant="outline" className="border-blue-600 text-blue-700">
              {t("skipped.warmup")}
            </Badge>
          </div>
          <p className="text-xs text-blue-800 dark:text-blue-200">{t("skipped.desc")}</p>
        </div>
      )}

      {/* Block Info */}
      {isBlocked && blockedBy && (
        <div className="rounded-lg border bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-orange-600" />
            <span className="text-sm font-medium text-orange-900 dark:text-orange-100">
              {t("blocked.title")}
            </span>
            <Badge variant="outline" className="border-orange-600 text-orange-600">
              {blockedBy === "sensitive_word" ? t("blocked.sensitiveWord") : blockedBy}
            </Badge>
          </div>
          {parsedBlockedReason && (
            <div className="space-y-1 text-xs">
              {parsedBlockedReason.word && (
                <div className="flex items-center gap-2">
                  <span className="text-orange-900 dark:text-orange-100">{t("blocked.word")}:</span>
                  <code className="bg-orange-100 dark:bg-orange-900/50 px-2 py-0.5 rounded">
                    {parsedBlockedReason.word}
                  </code>
                </div>
              )}
              {parsedBlockedReason.matchedText && (
                <div className="mt-2">
                  <span className="text-orange-900 dark:text-orange-100">
                    {t("blocked.matchedText")}:
                  </span>
                  <pre className="bg-orange-100 dark:bg-orange-900/50 px-2 py-1 rounded mt-1 whitespace-pre-wrap break-words">
                    {parsedBlockedReason.matchedText}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Decision Chain Header */}
      {providerChain && providerChain.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              {isSessionReuseFlow ? (
                <Link2 className="h-4 w-4 text-violet-600" />
              ) : (
                <GitBranch className="h-4 w-4 text-blue-600" />
              )}
              {t("logicTrace.title")}
            </h4>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {isSessionReuseFlow ? (
                <Badge
                  variant="outline"
                  className="text-[10px] bg-violet-50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300"
                >
                  {t("logicTrace.sessionReuse")}
                </Badge>
              ) : (
                <>
                  <Badge variant="outline" className="text-[10px]">
                    {t("logicTrace.providersCount", { count: totalProviders })}
                  </Badge>
                  {afterHealthCheck > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-emerald-50 dark:bg-emerald-950/20"
                    >
                      {t("logicTrace.healthyCount", { count: afterHealthCheck })}
                    </Badge>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Decision Steps */}
      {providerChain && providerChain.length > 0 && (
        <div className="space-y-0">
          {/* Session Reuse Step (Step 1 for session reuse flow) */}
          {isSessionReuseFlow && sessionReuseProvider && (
            <StepCard
              step={1}
              icon={Link2}
              title={t("logicTrace.sessionReuseSelection")}
              subtitle={t("logicTrace.sessionReuseSelectionDesc")}
              status="session_reuse"
              details={
                <div className="space-y-3 text-xs">
                  {/* Session Information */}
                  <div>
                    <div className="flex items-center gap-1 text-violet-600 dark:text-violet-400 mb-2">
                      <Database className="h-3 w-3" />
                      <span className="font-medium">{t("logicTrace.sessionInfo")}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-4">
                      {sessionReuseContext?.sessionId && (
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            {t("logicTrace.sessionIdLabel")}:
                          </span>
                          <code className="text-[10px] px-1.5 py-0.5 bg-violet-100 dark:bg-violet-900/30 rounded font-mono truncate max-w-[120px]">
                            {sessionReuseContext.sessionId.slice(0, 8)}...
                          </code>
                        </div>
                      )}
                      {requestSequence !== undefined && requestSequence !== null && (
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            {t("logicTrace.requestSequence")}:
                          </span>
                          <span className="font-mono">#{requestSequence}</span>
                        </div>
                      )}
                      {sessionReuseContext?.sessionAge !== undefined && (
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            {t("logicTrace.sessionAge")}:
                          </span>
                          <span className="font-mono">{sessionReuseContext.sessionAge}s</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Reused Provider Information */}
                  <div className="pt-2 border-t border-muted/50">
                    <div className="flex items-center gap-1 text-violet-600 dark:text-violet-400 mb-2">
                      <Server className="h-3 w-3" />
                      <span className="font-medium">{t("logicTrace.reusedProvider")}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 pl-4">
                      <div>
                        <span className="text-muted-foreground">Provider:</span>{" "}
                        <span className="font-medium">{sessionReuseProvider.name}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">ID:</span>{" "}
                        <span className="font-mono">{sessionReuseProvider.id}</span>
                      </div>
                      {sessionReuseProvider.priority !== undefined && (
                        <div>
                          <span className="text-muted-foreground">
                            {tChain("details.priority")}:
                          </span>{" "}
                          <span className="font-mono">P{sessionReuseProvider.priority}</span>
                        </div>
                      )}
                      {sessionReuseProvider.costMultiplier !== undefined && (
                        <div>
                          <span className="text-muted-foreground">
                            {tChain("details.costMultiplier")}:
                          </span>{" "}
                          <span className="font-mono">x{sessionReuseProvider.costMultiplier}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Cache Optimization Hint */}
                  <div className="pt-2 border-t border-muted/50">
                    <div className="flex items-start gap-2 text-muted-foreground">
                      <Zap className="h-3 w-3 mt-0.5 shrink-0 text-violet-500" />
                      <span className="text-[10px]">{t("logicTrace.cacheOptimizationHint")}</span>
                    </div>
                  </div>
                </div>
              }
            />
          )}

          {/* Step 1: Initial Selection (only for non-session-reuse flow) */}
          {decisionContext && (
            <StepCard
              step={1}
              icon={Database}
              title={t("logicTrace.initialSelection")}
              subtitle={`${decisionContext.totalProviders} -> ${decisionContext.afterModelFilter || decisionContext.afterHealthCheck}`}
              status="success"
              details={
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Total:</span>{" "}
                    <span className="font-mono">{decisionContext.totalProviders}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Enabled:</span>{" "}
                    <span className="font-mono">{decisionContext.enabledProviders}</span>
                  </div>
                  {decisionContext.afterGroupFilter !== undefined && (
                    <div>
                      <span className="text-muted-foreground">After Group:</span>{" "}
                      <span className="font-mono">{decisionContext.afterGroupFilter}</span>
                    </div>
                  )}
                  {decisionContext.afterModelFilter !== undefined && (
                    <div>
                      <span className="text-muted-foreground">After Model:</span>{" "}
                      <span className="font-mono">{decisionContext.afterModelFilter}</span>
                    </div>
                  )}
                </div>
              }
            />
          )}

          {/* Step 2: Health Check (if there are filtered providers) */}
          {filteredProviders.length > 0 && (
            <StepCard
              step={2}
              icon={Filter}
              title={t("logicTrace.healthCheck")}
              subtitle={`${filteredProviders.length} providers filtered`}
              status="warning"
              details={
                <div className="space-y-1">
                  {filteredProviders.map((p, idx) => (
                    <div key={`${p.id}-${idx}`} className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className="text-[10px]">
                        {p.name}
                      </Badge>
                      <span className="text-rose-600">{tChain(`filterReasons.${p.reason}`)}</span>
                      {p.details && <span className="text-muted-foreground">({p.details})</span>}
                    </div>
                  ))}
                </div>
              }
            />
          )}

          {/* Step 3: Priority Selection */}
          {decisionContext?.priorityLevels && decisionContext.priorityLevels.length > 0 && (
            <StepCard
              step={filteredProviders.length > 0 ? 3 : 2}
              icon={Layers}
              title={t("logicTrace.prioritySelection")}
              subtitle={`Priority ${decisionContext.selectedPriority}`}
              status="success"
              details={
                <div className="space-y-2">
                  <div className="flex gap-1 flex-wrap">
                    {decisionContext.priorityLevels.map((p) => (
                      <Badge
                        key={p}
                        variant={p === decisionContext?.selectedPriority ? "default" : "outline"}
                        className="text-[10px]"
                      >
                        P{p}
                      </Badge>
                    ))}
                  </div>
                  {decisionContext.candidatesAtPriority &&
                    decisionContext.candidatesAtPriority.length > 0 && (
                      <div className="space-y-1 mt-2">
                        {decisionContext.candidatesAtPriority.map((c, idx) => {
                          const formattedProbability = formatProbability(c.probability);
                          return (
                            <div
                              key={`${c.id}-${idx}`}
                              className="flex items-center justify-between text-xs"
                            >
                              <span className="font-medium">{c.name}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">W:{c.weight}</span>
                                <span className="text-muted-foreground">x{c.costMultiplier}</span>
                                {formattedProbability && (
                                  <Badge variant="secondary" className="text-[10px]">
                                    {formattedProbability}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                </div>
              }
            />
          )}

          {/* Request Execution Steps */}
          {providerChain.map((item, index) => {
            // For session reuse flow, step numbering starts from 2 (session reuse is step 1)
            // For normal flow, calculate based on decision steps
            const stepNum = isSessionReuseFlow
              ? sessionReuseStepOffset + index + 1
              : (decisionContext ? 1 : 0) +
                (filteredProviders.length > 0 ? 1 : 0) +
                (decisionContext?.priorityLevels?.length ? 1 : 0) +
                index +
                1;

            const status = getRequestStatus(item);
            const isRetry = item.attemptNumber && item.attemptNumber > 1;
            const isSessionReuse =
              item.reason === "session_reuse" || item.selectionMethod === "session_reuse";

            // Determine icon based on type
            const stepIcon = isSessionReuse
              ? Link2
              : isRetry
                ? RefreshCw
                : status === "success"
                  ? CheckCircle
                  : status === "failure"
                    ? XCircle
                    : Server;

            // Determine title based on type
            // For session reuse flow, show simplified "Execute Request" title for the first item
            const stepTitle = isSessionReuse
              ? t("logicTrace.executeRequest")
              : isRetry
                ? t("logicTrace.retryAttempt", { number: item.attemptNumber ?? 1 })
                : t("logicTrace.attemptProvider", { provider: item.name });

            return (
              <StepCard
                key={`${item.id}-${index}`}
                step={stepNum}
                icon={stepIcon}
                title={stepTitle}
                subtitle={
                  isSessionReuse
                    ? item.statusCode
                      ? `HTTP ${item.statusCode}`
                      : item.name
                    : item.statusCode
                      ? `HTTP ${item.statusCode}`
                      : item.reason
                        ? tChain(`reasons.${item.reason}`)
                        : undefined
                }
                status={status}
                timestamp={item.timestamp}
                baseTimestamp={baseTimestamp}
                isLast={index === providerChain.length - 1}
                details={
                  <div className="space-y-2 text-xs">
                    {/* Session Reuse Info */}
                    {isSessionReuse && item.decisionContext && (
                      <div className="pb-2 border-b border-muted/50">
                        <div className="flex items-center gap-1 text-violet-600 dark:text-violet-400 mb-2">
                          <Link2 className="h-3 w-3" />
                          <span className="font-medium">{t("logicTrace.sessionReuseTitle")}</span>
                        </div>
                        <div className="grid grid-cols-1 gap-1.5">
                          {item.decisionContext.sessionId && (
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">
                                {tChain("timeline.sessionId", { id: "" }).replace(": ", ":")}
                              </span>
                              <code className="text-[10px] px-1.5 py-0.5 bg-violet-100 dark:bg-violet-900/30 rounded font-mono">
                                {item.decisionContext.sessionId}
                              </code>
                            </div>
                          )}
                          <div className="text-muted-foreground text-[10px] mt-1">
                            {tChain("timeline.basedOnCache")}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Basic Info */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-muted-foreground">Provider ID:</span>{" "}
                        <span className="font-mono">{item.id}</span>
                      </div>
                      {item.selectionMethod && !isSessionReuse && (
                        <div>
                          <span className="text-muted-foreground">
                            {tChain("details.selectionMethod")}:
                          </span>{" "}
                          <span className="font-mono">{item.selectionMethod}</span>
                        </div>
                      )}
                      {isSessionReuse && (
                        <div>
                          <span className="text-muted-foreground">Provider:</span>{" "}
                          <span className="font-mono">{item.name}</span>
                        </div>
                      )}
                    </div>

                    {/* Endpoint */}
                    {(item.endpointId || item.endpointUrl) && (
                      <div className="pt-2 border-t border-muted/50">
                        <div className="flex items-center gap-1 text-muted-foreground mb-1">
                          <Globe className="h-3 w-3" />
                          <span>{tChain("details.endpoint")}</span>
                        </div>
                        {item.endpointUrl && (
                          <code className="text-[10px] break-all">{item.endpointUrl}</code>
                        )}
                      </div>
                    )}

                    {/* Circuit Breaker */}
                    {(item.circuitState || item.circuitFailureCount !== undefined) && (
                      <div className="pt-2 border-t border-muted/50">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Zap className="h-3 w-3" />
                            <span>{tChain("details.circuitBreaker")}:</span>
                          </div>
                          {item.circuitState && (
                            <Badge
                              variant={
                                item.circuitState === "closed"
                                  ? "default"
                                  : item.circuitState === "open"
                                    ? "destructive"
                                    : "secondary"
                              }
                              className="text-[10px]"
                            >
                              {item.circuitState}
                            </Badge>
                          )}
                          {item.circuitFailureCount !== undefined &&
                            item.circuitFailureThreshold !== undefined && (
                              <span className="font-mono text-muted-foreground">
                                {item.circuitFailureThreshold === 0
                                  ? tChain("details.circuitDisabled")
                                  : `${item.circuitFailureCount}/${item.circuitFailureThreshold} ${tChain("details.failures")}`}
                              </span>
                            )}
                        </div>
                      </div>
                    )}

                    {/* Model Redirect */}
                    {item.modelRedirect && (
                      <div className="pt-2 border-t border-muted/50">
                        <div className="flex items-center gap-1 text-muted-foreground mb-1">
                          <ArrowRight className="h-3 w-3" />
                          <span>{tChain("details.modelRedirect")}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <code className="text-[10px] px-1 py-0.5 bg-muted rounded">
                            {item.modelRedirect.originalModel}
                          </code>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <code className="text-[10px] px-1 py-0.5 bg-muted rounded">
                            {item.modelRedirect.redirectedModel}
                          </code>
                        </div>
                      </div>
                    )}

                    {/* Error Message */}
                    {item.errorMessage && (
                      <div className="pt-2 border-t border-muted/50">
                        <div className="flex items-center gap-1 text-rose-600 mb-1">
                          <AlertCircle className="h-3 w-3" />
                          <span>{tChain("details.error")}</span>
                        </div>
                        <pre className="text-[10px] bg-rose-50 dark:bg-rose-950/20 p-2 rounded whitespace-pre-wrap break-words">
                          {item.errorMessage}
                        </pre>
                      </div>
                    )}

                    {/* Error Details */}
                    {/* 后端 buildRequestDetails 已根据 STORE_SESSION_MESSAGES 配置进行脱敏 */}
                    {item.errorDetails && (
                      <Collapsible>
                        <CollapsibleTrigger className="flex items-center gap-1 text-muted-foreground hover:text-foreground text-[10px]">
                          <span>{tChain("details.errorDetails")}</span>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-1">
                          <pre className="text-[10px] bg-rose-50 dark:bg-rose-950/20 p-2 rounded whitespace-pre-wrap break-words font-mono">
                            {JSON.stringify(item.errorDetails, null, 2)}
                          </pre>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>
                }
              />
            );
          })}
        </div>
      )}

      {/* No Data */}
      {(!providerChain || providerChain.length === 0) && !isWarmupSkipped && !isBlocked && (
        <div className="text-center py-8 text-muted-foreground">
          <GitBranch className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">{t("logicTrace.noDecisionData")}</p>
        </div>
      )}

      {/* Technical Timeline */}
      {providerChain && providerChain.length > 0 && (
        <div className="space-y-2 mt-6 pt-6 border-t">
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
