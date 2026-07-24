"use client";

import {
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  Clock3,
  DatabaseZap,
  GitBranch,
  InfoIcon,
  Link2,
  MinusCircle,
  RefreshCw,
  Server,
  ShieldCheck,
  XCircle,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  formatProbabilityCompact,
  getRetryCount,
  isActualRequest,
  isHedgeRace,
} from "@/lib/utils/provider-chain-formatter";
import { parseProviderGroups } from "@/lib/utils/provider-group";
import type { ProviderChainItem } from "@/types/message";
import {
  normalizeRoutingTrace,
  type RoutingTraceV1,
  type RoutingTraceWinnerOrigin,
} from "@/types/routing-trace";
import { getFake200ReasonKey } from "./fake200-reason";
import { Fake200RetryTooltip } from "./fake200-retry-tooltip";

interface ProviderChainPopoverProps {
  chain: ProviderChainItem[];
  routingTrace?: RoutingTraceV1 | null;
  finalProvider: string;
  /** Whether a cost badge is displayed, affects name max width */
  hasCostBadge?: boolean;
  /** Callback when a chain item is clicked in the popover */
  onChainItemClick?: (chainIndex: number) => void;
}

function parseGroupTags(groupTag?: string | null): string[] {
  return Array.from(new Set(parseProviderGroups(groupTag)));
}

function deriveDiscoveryStats(trace: RoutingTraceV1): {
  rounds: number;
  attempts: number;
} {
  const startedAttempts = new Set<string>();
  let anonymousAttempts = 0;
  let maxRound = 0;

  for (const event of trace.events) {
    if (typeof event.round === "number" && Number.isFinite(event.round)) {
      maxRound = Math.max(maxRound, event.round);
    }
    if (event.type !== "attempt_started") continue;
    if (event.attemptId) startedAttempts.add(event.attemptId);
    else anonymousAttempts += 1;
  }

  return {
    rounds: trace.summary?.rounds ?? maxRound,
    attempts: trace.summary?.attemptsPerRequest ?? startedAttempts.size + anonymousAttempts,
  };
}

type DiscoveryTerminalOutcome = "success" | "failed" | "client_abort" | "deadline" | "pending";

function getDiscoveryTerminal(trace: RoutingTraceV1): {
  outcome: DiscoveryTerminalOutcome;
  statusCode: number | null;
} {
  const terminalEvent = trace.events.findLast((event) => event.type === "request_finished");
  const rawOutcome = terminalEvent?.outcome ?? trace.summary?.outcome;
  const outcome: DiscoveryTerminalOutcome =
    rawOutcome === "success" ||
    rawOutcome === "failed" ||
    rawOutcome === "client_abort" ||
    rawOutcome === "deadline"
      ? rawOutcome
      : "pending";

  return {
    outcome,
    statusCode: terminalEvent?.statusCode ?? trace.summary?.statusCode ?? null,
  };
}

type DiscoveryRouteMode = "sticky" | "cold_start" | "rediscovery";

function getStickyEvidenceIndex(trace: RoutingTraceV1): number {
  return trace.events.findIndex(
    (event) =>
      event.type === "sticky_probe_started" ||
      event.type === "sticky_timeout" ||
      event.attemptKind === "sticky"
  );
}

function deriveDiscoveryRouteMode(
  trace: RoutingTraceV1,
  chain: ProviderChainItem[]
): DiscoveryRouteMode {
  const stickyEvidenceIndex = getStickyEvidenceIndex(trace);
  if (stickyEvidenceIndex < 0) {
    if (trace.summary?.winnerOrigin === "sticky") return "sticky";

    const truncatedStickyFallback =
      trace.truncated === true &&
      chain.some(
        (item) => item.reason === "session_reuse" || item.selectionMethod === "session_reuse"
      ) &&
      ((trace.summary?.rounds ?? 0) >= 1 || (trace.summary?.winnerRound ?? 0) >= 1);
    return truncatedStickyFallback ? "rediscovery" : "cold_start";
  }

  const transitionEvents = trace.events.slice(stickyEvidenceIndex);
  const enteredRediscovery =
    transitionEvents.some(
      (event) =>
        event.type === "sticky_timeout" ||
        (typeof event.round === "number" &&
          event.round >= 1 &&
          (event.type === "round_started" ||
            (event.attemptKind !== undefined && event.attemptKind !== "sticky")))
    ) ||
    (trace.summary?.rounds ?? 0) >= 1 ||
    (trace.summary?.winnerRound ?? 0) >= 1;
  return enteredRediscovery ? "rediscovery" : "sticky";
}

function getDiscoveryWinnerOrigin(trace: RoutingTraceV1): RoutingTraceWinnerOrigin {
  const summaryOrigin = trace.summary?.winnerOrigin;
  if (summaryOrigin === "sticky" || summaryOrigin === "normal" || summaryOrigin === "fallback") {
    return summaryOrigin;
  }

  const winnerKind = trace.events.findLast(
    (event) => event.type === "winner_committed"
  )?.attemptKind;
  return winnerKind === "sticky" || winnerKind === "normal" || winnerKind === "fallback"
    ? winnerKind
    : "none";
}

function getCompactDiscoveryRouteBadgeClass(
  routeMode: DiscoveryRouteMode,
  winnerOrigin: RoutingTraceWinnerOrigin
): string {
  if (winnerOrigin === "none") {
    return "";
  }

  if (routeMode === "sticky" && winnerOrigin === "sticky") {
    return "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/20 dark:text-violet-300";
  }

  if (routeMode === "cold_start" && winnerOrigin === "normal") {
    return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-300";
  }

  if (routeMode === "cold_start" && winnerOrigin === "fallback") {
    return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300";
  }

  if (routeMode === "rediscovery" && winnerOrigin === "normal") {
    return "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/20 dark:text-teal-300";
  }

  if (routeMode === "rediscovery" && winnerOrigin === "fallback") {
    return "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-200";
  }

  return "";
}

function getDiscoveryFinalProviderName(
  trace: RoutingTraceV1,
  chain: ProviderChainItem[],
  fallbackName: string,
  winnerOrigin: RoutingTraceWinnerOrigin
): string | null {
  const winnerProviderId = trace.summary?.winnerProviderId;
  const winnerEvent = [...trace.events]
    .reverse()
    .find(
      (event) =>
        (event.type === "winner_committed" ||
          (event.type === "attempt_finished" && event.outcome === "winner")) &&
        (winnerProviderId == null || event.provider?.id === winnerProviderId) &&
        event.provider?.name
    );
  if (winnerEvent?.provider?.name) return winnerEvent.provider.name;
  const hasSuccessfulChainItem = chain.some(
    (item) =>
      (item.reason === "request_success" ||
        item.reason === "retry_success" ||
        item.reason === "hedge_winner") &&
      item.statusCode != null
  );
  return winnerOrigin !== "none" || hasSuccessfulChainItem ? fallbackName || null : null;
}

/**
 * Get status icon and color for a provider chain item
 */
function getItemStatus(item: ProviderChainItem): {
  icon: React.ElementType;
  color: string;
  bgColor: string;
} {
  if (
    (item.reason === "request_success" ||
      item.reason === "retry_success" ||
      item.reason === "hedge_winner") &&
    item.statusCode
  ) {
    return {
      icon: CheckCircle,
      color: "text-emerald-600",
      bgColor: "bg-emerald-50 dark:bg-emerald-950/30",
    };
  }
  if (
    item.reason === "retry_failed" ||
    item.reason === "system_error" ||
    item.reason === "resource_not_found" ||
    item.reason === "endpoint_pool_exhausted" ||
    item.reason === "vendor_type_all_timeout"
  ) {
    return {
      icon: XCircle,
      color: "text-rose-600",
      bgColor: "bg-rose-50 dark:bg-rose-950/30",
    };
  }
  if (item.reason === "concurrent_limit_failed") {
    return {
      icon: Zap,
      color: "text-amber-600",
      bgColor: "bg-amber-50 dark:bg-amber-950/30",
    };
  }
  if (item.reason === "client_error_non_retryable") {
    return {
      icon: AlertTriangle,
      color: "text-orange-600",
      bgColor: "bg-orange-50 dark:bg-orange-950/30",
    };
  }
  if (item.reason === "client_restriction_filtered") {
    return {
      icon: MinusCircle,
      color: "text-muted-foreground",
      bgColor: "bg-muted/30",
    };
  }
  if (item.reason === "hedge_triggered") {
    return {
      icon: GitBranch,
      color: "text-indigo-600",
      bgColor: "bg-indigo-50 dark:bg-indigo-950/30",
    };
  }
  if (item.reason === "hedge_loser_cancelled" || item.reason === "hedge_loser_billed") {
    return {
      icon: XCircle,
      color: "text-slate-500",
      bgColor: "bg-slate-50 dark:bg-slate-800/50",
    };
  }
  if (item.reason === "client_abort") {
    return {
      icon: MinusCircle,
      color: "text-amber-600",
      bgColor: "bg-amber-50 dark:bg-amber-950/30",
    };
  }
  if (item.reason === "affinity_hit") {
    return {
      icon: DatabaseZap,
      color: "text-teal-600",
      bgColor: "bg-teal-50 dark:bg-teal-950/30",
    };
  }
  return {
    icon: RefreshCw,
    color: "text-slate-500",
    bgColor: "bg-slate-50 dark:bg-slate-800/50",
  };
}

export function ProviderChainPopover({
  chain,
  routingTrace,
  finalProvider,
  hasCostBadge = false,
  onChainItemClick,
}: ProviderChainPopoverProps) {
  const t = useTranslations("dashboard");
  const tChain = useTranslations("provider-chain");
  const tRouting = useTranslations("dashboard.logs.details.routingTrace");
  const normalizedRoutingTrace = normalizeRoutingTrace(routingTrace);

  // “假 200”识别发生在 SSE 流式结束后：此时响应内容可能已透传给客户端，但内部会按失败统计/熔断。
  const hasFake200PostStreamFailure = chain.some(
    (item) => typeof item.errorMessage === "string" && item.errorMessage.startsWith("FAKE_200_")
  );
  const fake200CodeForDisplay = chain
    .find(
      (item) => typeof item.errorMessage === "string" && item.errorMessage.startsWith("FAKE_200_")
    )
    ?.errorMessage?.split(": ")[0];

  // Calculate actual request count (excluding intermediate states)
  const requestCount = chain.filter(isActualRequest).length;
  const retryCount = getRetryCount(chain);
  const isHedge = isHedgeRace(chain);

  // Fallback for empty string
  const displayName = finalProvider || "-";

  if (normalizedRoutingTrace?.mode === "discovery") {
    const { rounds, attempts } = deriveDiscoveryStats(normalizedRoutingTrace);
    const routeMode = deriveDiscoveryRouteMode(normalizedRoutingTrace, chain);
    const winnerOrigin = getDiscoveryWinnerOrigin(normalizedRoutingTrace);
    const discoveryFinalProvider = getDiscoveryFinalProviderName(
      normalizedRoutingTrace,
      chain,
      displayName,
      winnerOrigin
    );
    const triggerProviderName = discoveryFinalProvider ?? displayName;
    const terminal = getDiscoveryTerminal(normalizedRoutingTrace);
    const terminalPresentation =
      terminal.outcome === "success"
        ? { icon: CheckCircle, className: "text-emerald-600" }
        : terminal.outcome === "failed"
          ? { icon: XCircle, className: "text-rose-600" }
          : terminal.outcome === "deadline"
            ? { icon: Clock3, className: "text-amber-600" }
            : terminal.outcome === "client_abort"
              ? { icon: MinusCircle, className: "text-amber-600" }
              : { icon: RefreshCw, className: "text-muted-foreground" };
    const TerminalIcon = terminalPresentation.icon;
    const routeLabel = tRouting(`routeModes.${routeMode}`);
    const winnerSourceLabel =
      winnerOrigin === "none" ? null : tRouting(`winnerSources.${winnerOrigin}`);
    const compactRouteDescription =
      winnerSourceLabel && winnerSourceLabel !== routeLabel
        ? `${routeLabel} · ${winnerSourceLabel}`
        : routeLabel;
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="h-auto p-0 font-normal hover:bg-transparent w-full min-w-0"
            aria-label={`${triggerProviderName} - ${compactRouteDescription} - ${tRouting("discoveryCompact", { rounds, attempts })}`}
          >
            <span className="flex w-full min-w-0 items-center gap-1 overflow-hidden">
              <Zap className="h-3 w-3 shrink-0 text-blue-500" />
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {triggerProviderName}
              </span>
              <Badge
                variant="secondary"
                className={cn(
                  "min-w-0 max-w-[45%] shrink px-1.5 py-0 text-[10px]",
                  getCompactDiscoveryRouteBadgeClass(routeMode, winnerOrigin)
                )}
                data-testid="discovery-route-badge"
                data-route-mode={routeMode}
                data-winner-origin={winnerOrigin}
                title={compactRouteDescription}
              >
                <span className="truncate">{routeLabel}</span>
              </Badge>
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[360px] max-w-[calc(100vw-2rem)] p-0" align="start">
          <div className="p-3 border-b flex items-center justify-between gap-3">
            <h4 className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
              <Zap className="h-4 w-4 shrink-0 text-blue-500" />
              <span className="truncate">{tRouting("discoveryTitle")}</span>
            </h4>
            <Badge
              variant="outline"
              className="min-w-0 max-w-[45%] shrink text-[10px]"
              title={tRouting("modes.discovery")}
            >
              <span className="truncate">{tRouting("modes.discovery")}</span>
            </Badge>
          </div>
          <div className="p-3 space-y-3">
            <div className="flex items-start gap-2 text-xs min-w-0">
              <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground shrink-0">{tRouting("finalProvider")}:</span>
              <span className="font-medium min-w-0 break-words" dir="auto">
                {discoveryFinalProvider ?? "-"}
              </span>
            </div>
            <div className="flex min-w-0 items-start gap-2 text-xs">
              <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-muted-foreground">{tRouting("routeMode")}:</span>
                <Badge
                  variant="outline"
                  className="min-w-0 max-w-full whitespace-normal break-words text-[10px] leading-snug"
                  title={routeLabel}
                >
                  {routeLabel}
                </Badge>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-[10px] text-muted-foreground">{tRouting("roundsLabel")}</div>
                <div className="font-mono">{rounds}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">{tRouting("attemptsLabel")}</div>
                <div className="font-mono">{attempts}</div>
              </div>
            </div>
            <div
              className="flex min-w-0 items-start gap-2 text-xs"
              data-testid="discovery-compact-terminal"
            >
              <TerminalIcon className={cn("h-4 w-4 shrink-0", terminalPresentation.className)} />
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-muted-foreground">{tRouting("terminalOutcome")}:</span>
                <Badge variant="outline" className="text-[10px]">
                  {tRouting(`outcomes.${terminal.outcome}`)}
                </Badge>
                {terminal.statusCode != null && (
                  <span className="font-mono text-[10px]">HTTP {terminal.statusCode}</span>
                )}
              </div>
            </div>
            {winnerOrigin !== "none" && (
              <div className="flex min-w-0 items-start gap-2 text-xs">
                <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-muted-foreground">{tRouting("winnerOrigin")}:</span>
                  <Badge
                    variant="outline"
                    className="min-w-0 max-w-full whitespace-normal break-words text-[10px] leading-snug"
                    title={winnerSourceLabel ?? undefined}
                  >
                    {winnerSourceLabel}
                  </Badge>
                </div>
              </div>
            )}
          </div>
          {(hasFake200PostStreamFailure || onChainItemClick) && (
            <div className="border-t bg-muted/30">
              {hasFake200PostStreamFailure && (
                <div className="flex items-start justify-center gap-1.5 px-3 py-2 text-[10px] text-amber-700 dark:text-amber-300">
                  <InfoIcon className="h-3 w-3 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="flex flex-col items-center gap-1 text-center">
                    {typeof fake200CodeForDisplay === "string" && (
                      <span>
                        {t("logs.details.fake200DetectedReason", {
                          reason: t(
                            getFake200ReasonKey(
                              fake200CodeForDisplay,
                              "logs.details.fake200Reasons"
                            )
                          ),
                        })}
                      </span>
                    )}
                    <span>{t("logs.details.fake200ForwardedNotice")}</span>
                    <Fake200RetryTooltip
                      className="justify-center text-amber-700 dark:text-amber-300"
                      side="top"
                      align="center"
                    />
                  </div>
                </div>
              )}
              {onChainItemClick && (
                <button
                  type="button"
                  className="w-full border-t p-2 text-[10px] text-muted-foreground hover:text-foreground first:border-t-0"
                  onClick={() => onChainItemClick(0)}
                >
                  {tRouting("viewDetails")}
                </button>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
    );
  }

  // Determine max width based on whether cost badge is present
  const maxWidthClass = hasCostBadge ? "max-w-[140px]" : "max-w-[180px]";
  const isLeaseConflictProtection =
    normalizedRoutingTrace?.mode === "single_upstream" &&
    normalizedRoutingTrace.bypassReason === "lease_conflict";

  // Check if this is a session reuse
  const isSessionReuse =
    chain[0]?.reason === "session_reuse" || chain[0]?.selectionMethod === "session_reuse";

  // F3a: prefix affinity hit (cache reuse nomination); chain[0]-based like
  // session reuse so mid-chain retries are not misread as cache reuse
  const affinityHitItem =
    chain[0]?.reason === "affinity_hit" || chain[0]?.selectionMethod === "prefix_affinity"
      ? chain[0]
      : undefined;
  const isAffinityHit = Boolean(affinityHitItem);

  // Get initial selection context for tooltip
  const initialSelection = chain.find((item) => item.reason === "initial_selection");
  const selectionContext = initialSelection?.decisionContext;

  // Single request (no retry and no hedge): show name with icon and compact tooltip
  if (retryCount === 0 && !isHedge) {
    // Get session reuse context for detailed tooltip
    const sessionReuseItem = chain.find(
      (item) => item.reason === "session_reuse" || item.selectionMethod === "session_reuse"
    );
    const sessionReuseContext = sessionReuseItem?.decisionContext;
    const singleRequestItem = chain.find(isActualRequest);

    return (
      <div className={`${maxWidthClass} min-w-0 w-full`}>
        <TooltipProvider>
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1 min-w-0 cursor-help" dir="auto">
                {isLeaseConflictProtection && (
                  <ShieldCheck className="h-3 w-3 shrink-0 text-amber-600" aria-hidden="true" />
                )}
                {/* Session reuse indicator */}
                {isSessionReuse && !isLeaseConflictProtection && (
                  <Link2 className="h-3 w-3 shrink-0 text-violet-500" />
                )}
                {/* Affinity hit (cache reuse) indicator */}
                {isAffinityHit && !isSessionReuse && !isLeaseConflictProtection && (
                  <DatabaseZap className="h-3 w-3 shrink-0 text-teal-500" />
                )}
                {/* Initial selection: show compact priority badge before name */}
                {!isSessionReuse && selectionContext && (
                  <span className="shrink-0 text-[10px] text-emerald-600 dark:text-emerald-400 font-mono font-medium">
                    P{selectionContext.selectedPriority}
                  </span>
                )}
                <span className="truncate min-w-0">{displayName}</span>
                {isLeaseConflictProtection && (
                  <Badge
                    variant="outline"
                    className="shrink-0 border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300"
                  >
                    {tRouting("modes.lease_conflict")}
                  </Badge>
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="max-w-[320px]">
              <div className="space-y-2">
                {/* Provider name */}
                <div className="font-medium text-xs">{displayName}</div>
                {isLeaseConflictProtection && (
                  <div className="flex items-start gap-1.5 border-b pb-2 text-[10px] text-amber-700 dark:border-zinc-700 dark:text-amber-300">
                    <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>{tRouting("bypassReasons.lease_conflict")}</span>
                  </div>
                )}
                {singleRequestItem?.statusCode && (
                  <div className="flex items-center gap-1">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] px-1 py-0",
                        singleRequestItem.statusCode >= 200 && singleRequestItem.statusCode < 300
                          ? "border-emerald-500 text-emerald-600"
                          : "border-rose-500 text-rose-600"
                      )}
                    >
                      {singleRequestItem.statusCode}
                    </Badge>
                    {singleRequestItem.statusCodeInferred && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1 py-0 border-amber-500 text-amber-700 dark:text-amber-300"
                        title={t("logs.details.statusCodeInferredTooltip")}
                      >
                        {t("logs.details.statusCodeInferredBadge")}
                      </Badge>
                    )}
                  </div>
                )}

                {/* 注意：假 200 检测发生在 SSE 流式结束后；此时内容已可能透传给客户端。 */}
                {hasFake200PostStreamFailure && (
                  <div className="flex items-start gap-1.5 text-[10px] text-amber-500 dark:text-amber-400">
                    <InfoIcon className="h-3 w-3 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="space-y-0.5">
                      {typeof fake200CodeForDisplay === "string" && (
                        <div>
                          {t("logs.details.fake200DetectedReason", {
                            reason: t(
                              getFake200ReasonKey(
                                fake200CodeForDisplay,
                                "logs.details.fake200Reasons"
                              )
                            ),
                          })}
                        </div>
                      )}
                      <div>{t("logs.details.fake200ForwardedNotice")}</div>
                      <div className="space-y-1 pt-1 text-amber-600 dark:text-amber-300">
                        <div className="font-medium">
                          {t("logs.details.fake200RetryTooltipTitle")}
                        </div>
                        <div>{t("logs.details.fake200RetryTooltipServerRetry")}</div>
                        <div>{t("logs.details.fake200RetryTooltipSessionFallback")}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Session reuse detailed info */}
                {isSessionReuse && (
                  <div className="space-y-1.5 pt-1 border-t border-zinc-600 dark:border-zinc-300">
                    <div className="flex items-center gap-1.5 text-[10px] text-violet-400 dark:text-violet-600 font-medium">
                      <Link2 className="h-3 w-3" />
                      <span>{tChain("reasons.session_reuse")}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] pl-1">
                      {sessionReuseContext?.sessionAge !== undefined && (
                        <div>
                          <span className="text-zinc-400 dark:text-zinc-500">
                            {tChain("timeline.sessionAge") || "Age"}:
                          </span>{" "}
                          <span className="text-zinc-200 dark:text-zinc-700">
                            {sessionReuseContext.sessionAge}s
                          </span>
                        </div>
                      )}
                      {sessionReuseItem?.priority !== undefined && (
                        <div>
                          <span className="text-zinc-400 dark:text-zinc-500">
                            {tChain("details.priority")}:
                          </span>{" "}
                          <span className="text-zinc-200 dark:text-zinc-700">
                            P{sessionReuseItem.priority}
                          </span>
                        </div>
                      )}
                      {sessionReuseItem?.costMultiplier !== undefined && (
                        <div>
                          <span className="text-zinc-400 dark:text-zinc-500">
                            {tChain("details.costMultiplier")}:
                          </span>{" "}
                          <span className="text-zinc-200 dark:text-zinc-700">
                            x{sessionReuseItem.costMultiplier}
                          </span>
                        </div>
                      )}
                    </div>
                    {sessionReuseItem?.selectionMethod && (
                      <div className="text-[10px] text-zinc-400 dark:text-zinc-500 pt-0.5">
                        {tChain("summary.originHint", {
                          method: tChain(`selectionMethods.${sessionReuseItem.selectionMethod}`),
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Affinity hit (cache reuse) detailed info */}
                {isAffinityHit && !isSessionReuse && (
                  <div className="space-y-1.5 pt-1 border-t border-zinc-600 dark:border-zinc-300">
                    <div className="flex items-center gap-1.5 text-[10px] text-teal-400 dark:text-teal-600 font-medium">
                      <DatabaseZap className="h-3 w-3" />
                      <span>{tChain("reasons.affinity_hit")}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] pl-1">
                      {affinityHitItem?.affinity?.matchedDepth != null && (
                        <div>
                          <span className="text-zinc-400 dark:text-zinc-500">
                            {tChain("affinity.matchedDepth")}:
                          </span>{" "}
                          <span className="text-zinc-200 dark:text-zinc-700">
                            {affinityHitItem.affinity.matchedDepth}
                          </span>
                        </div>
                      )}
                      {affinityHitItem?.affinity?.matchedPrefixBytes != null && (
                        <div>
                          <span className="text-zinc-400 dark:text-zinc-500">
                            {tChain("affinity.matchedPrefixBytes")}:
                          </span>{" "}
                          <span className="text-zinc-200 dark:text-zinc-700">
                            {affinityHitItem.affinity.matchedPrefixBytes}
                          </span>
                        </div>
                      )}
                      {affinityHitItem?.affinity?.matchedFp && (
                        <div className="col-span-2">
                          <span className="text-zinc-400 dark:text-zinc-500">
                            {tChain("affinity.matchedFp")}:
                          </span>{" "}
                          <span className="font-mono text-zinc-200 dark:text-zinc-700">
                            {affinityHitItem.affinity.matchedFp.slice(0, 16)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Initial selection detailed info */}
                {!isSessionReuse && selectionContext && (
                  <div className="space-y-1.5 pt-1 border-t border-zinc-600 dark:border-zinc-300">
                    <div className="text-[10px] text-zinc-300 dark:text-zinc-600 font-medium">
                      {tChain("timeline.initialSelection") || "Initial Selection"}
                    </div>
                    {/* Selection funnel */}
                    <div className="flex items-center gap-1 text-[10px] text-zinc-200 dark:text-zinc-700">
                      <span>{selectionContext.totalProviders}</span>
                      <span className="text-zinc-400 dark:text-zinc-500">total</span>
                      <ChevronRight className="h-2.5 w-2.5" />
                      <span>{selectionContext.enabledProviders}</span>
                      <span className="text-zinc-400 dark:text-zinc-500">enabled</span>
                      <ChevronRight className="h-2.5 w-2.5" />
                      <span>{selectionContext.afterHealthCheck}</span>
                      <span className="text-zinc-400 dark:text-zinc-500">healthy</span>
                    </div>
                    {/* Priority and candidates */}
                    <div className="text-[10px] space-y-0.5 pl-1">
                      <div className="flex items-center gap-1">
                        <span className="text-zinc-400 dark:text-zinc-500">
                          {tChain("details.priority")}:
                        </span>
                        <span className="text-zinc-200 dark:text-zinc-700 font-medium">
                          P{selectionContext.selectedPriority}
                        </span>
                        {selectionContext.candidatesAtPriority && (
                          <span className="text-zinc-400 dark:text-zinc-500">
                            ({selectionContext.candidatesAtPriority.length} candidates)
                          </span>
                        )}
                      </div>
                      {/* Show candidates with probability */}
                      {selectionContext.candidatesAtPriority &&
                        selectionContext.candidatesAtPriority.length > 1 && (
                          <div className="text-zinc-400 dark:text-zinc-500">
                            {selectionContext.candidatesAtPriority.map((c, i) => (
                              <span key={c.id}>
                                {i > 0 && ", "}
                                <span
                                  className={
                                    c.name === displayName
                                      ? "text-zinc-200 dark:text-zinc-700 font-medium"
                                      : ""
                                  }
                                >
                                  {c.name}
                                </span>
                                {(() => {
                                  const formatted = formatProbabilityCompact(c.probability);
                                  return formatted ? (
                                    <span className="text-zinc-500 dark:text-zinc-400">
                                      ({formatted})
                                    </span>
                                  ) : null;
                                })()}
                              </span>
                            ))}
                          </div>
                        )}
                    </div>
                    {/* Provider config */}
                    {initialSelection && (
                      <div className="grid grid-cols-3 gap-x-2 text-[10px] text-zinc-400 dark:text-zinc-500 pt-1">
                        {initialSelection.weight !== undefined && (
                          <div>
                            <span>{tChain("details.weight")}:</span>{" "}
                            <span className="text-zinc-200 dark:text-zinc-700">
                              {initialSelection.weight}
                            </span>
                          </div>
                        )}
                        {initialSelection.costMultiplier !== undefined && (
                          <div>
                            <span>{tChain("details.costMultiplier")}:</span>{" "}
                            <span className="text-zinc-200 dark:text-zinc-700">
                              x{initialSelection.costMultiplier}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  // Multiple requests: show popover with visual chain
  const actualRequests = chain.filter(isActualRequest);

  // Get the successful provider's costMultiplier and groupTag
  const successfulProvider = [...chain]
    .reverse()
    .find(
      (item) =>
        item.reason === "request_success" ||
        item.reason === "retry_success" ||
        item.reason === "hedge_winner"
    );
  const finalCostMultiplier = successfulProvider?.costMultiplier;
  const finalGroupTag = successfulProvider?.groupTag;
  const finalGroupTags = parseGroupTags(finalGroupTag);
  const hasFinalCostBadge =
    finalCostMultiplier !== undefined &&
    finalCostMultiplier !== null &&
    Number.isFinite(finalCostMultiplier) &&
    finalCostMultiplier !== 1;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto p-0 font-normal hover:bg-transparent w-full min-w-0"
          aria-label={`${displayName} - ${isHedge ? tChain("timeline.hedgeRace") : `${requestCount}${t("logs.table.times")}`}`}
        >
          <span className="flex w-full items-center gap-1 min-w-0">
            {/* Request count badge */}
            {isLeaseConflictProtection ? (
              <ShieldCheck className="h-3 w-3 shrink-0 text-amber-600" aria-hidden="true" />
            ) : isHedge ? (
              <GitBranch className="h-3 w-3 shrink-0 text-indigo-500" />
            ) : (
              <Badge variant="secondary" className="shrink-0">
                {requestCount}
                {t("logs.table.times")}
              </Badge>
            )}
            {/* Provider name */}
            <span className="truncate min-w-0" dir="auto">
              {displayName}
            </span>
            {isLeaseConflictProtection && (
              <Badge
                variant="outline"
                className="shrink-0 border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300"
              >
                {tRouting("modes.lease_conflict")}
              </Badge>
            )}
            {/* Cost multiplier badge (if not 1) */}
            {hasFinalCostBadge && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] px-1 py-0 shrink-0",
                  finalCostMultiplier > 1
                    ? "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-800"
                    : "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-800"
                )}
              >
                x{finalCostMultiplier.toFixed(2)}
              </Badge>
            )}
            {/* Group tag badges (if present) */}
            {finalGroupTags.map((group) => (
              <TooltipProvider key={group}>
                <Tooltip delayDuration={200}>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1 py-0 shrink-0 bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900/30 dark:text-slate-400 dark:border-slate-700 max-w-[120px] truncate"
                    >
                      {group}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>{group}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
            {/* Info icon */}
            <InfoIcon className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[360px] max-w-[calc(100vw-2rem)] p-0" align="start">
        <div className="p-3 border-b">
          <div className="flex items-center justify-between">
            <h4 className="flex items-center gap-1.5 font-semibold text-sm">
              {isLeaseConflictProtection && (
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
              )}
              {isLeaseConflictProtection
                ? tRouting("modes.lease_conflict")
                : t("logs.providerChain.decisionChain")}
            </h4>
            <Badge variant="outline" className="text-[10px]">
              {isHedge ? tChain("timeline.hedgeRace") : `${requestCount} ${t("logs.table.times")}`}
            </Badge>
          </div>
        </div>

        {/* Visual chain */}
        <div className="p-3 space-y-0 max-h-[300px] overflow-y-auto">
          {actualRequests.map((item, index) => {
            const status = getItemStatus(item);
            const Icon = status.icon;
            const isLast = index === actualRequests.length - 1;

            return (
              <div
                key={`${item.id}-${index}`}
                className={cn(
                  "relative flex gap-2",
                  onChainItemClick &&
                    "cursor-pointer hover:bg-muted/50 rounded-md p-1 -m-1 transition-colors"
                )}
                onClick={
                  onChainItemClick
                    ? () => {
                        // Map actualRequests index back to original chain index
                        const originalIndex = chain.indexOf(item);
                        onChainItemClick(originalIndex);
                      }
                    : undefined
                }
                onKeyDown={
                  onChainItemClick
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          const originalIndex = chain.indexOf(item);
                          onChainItemClick(originalIndex);
                        }
                      }
                    : undefined
                }
                role={onChainItemClick ? "button" : undefined}
                tabIndex={onChainItemClick ? 0 : undefined}
              >
                {/* Timeline connector */}
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                      status.bgColor
                    )}
                  >
                    <Icon className={cn("h-3 w-3", status.color)} />
                  </div>
                  {!isLast && <div className="w-0.5 flex-1 min-h-[8px] bg-border" />}
                </div>

                {/* Content */}
                <div className={cn("flex-1 pb-3", isLast && "pb-0")}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{item.name}</span>
                    {item.statusCode && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] px-1 py-0",
                          item.statusCode >= 200 && item.statusCode < 300
                            ? "border-emerald-500 text-emerald-600"
                            : "border-rose-500 text-rose-600"
                        )}
                      >
                        {item.statusCode}
                      </Badge>
                    )}
                    {item.statusCode && item.statusCodeInferred && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1 py-0 border-amber-500 text-amber-700 dark:text-amber-300"
                        title={t("logs.details.statusCodeInferredTooltip")}
                      >
                        {t("logs.details.statusCodeInferredBadge")}
                      </Badge>
                    )}
                    {item.reason && !item.statusCode && (
                      <span className="text-[10px] text-muted-foreground">
                        {tChain(`reasons.${item.reason}`)}
                      </span>
                    )}
                  </div>
                  {item.errorMessage && (
                    <>
                      <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                        {item.errorMessage}
                      </p>
                      {typeof item.errorMessage === "string" &&
                        item.errorMessage.startsWith("FAKE_200_") && (
                          <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-0.5 line-clamp-2">
                            {t("logs.details.fake200DetectedReason", {
                              reason: t(
                                getFake200ReasonKey(
                                  item.errorMessage.split(": ")[0],
                                  "logs.details.fake200Reasons"
                                )
                              ),
                            })}
                          </p>
                        )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-2 border-t bg-muted/30">
          {hasFake200PostStreamFailure && (
            <div className="flex items-start justify-center gap-1.5 text-[10px] text-amber-700 dark:text-amber-300 px-2 pb-1">
              <InfoIcon className="h-3 w-3 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex flex-col items-center gap-1 text-center">
                <span>{t("logs.details.fake200ForwardedNotice")}</span>
                <Fake200RetryTooltip
                  className="justify-center text-amber-700 dark:text-amber-300"
                  side="top"
                  align="center"
                />
              </div>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground text-center">
            {onChainItemClick
              ? t("logs.providerChain.clickItemForDetails")
              : t("logs.details.clickStatusCode")}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
