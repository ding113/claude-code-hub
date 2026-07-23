"use client";

import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  GitBranch,
  Link2,
  Server,
  ShieldCheck,
  XCircle,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn, formatTokenAmount } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/currency";
import { summarizeHedgeBilling } from "@/lib/utils/hedge-billing";
import { redactJsonString } from "@/lib/utils/message-redaction";
import { sanitizeErrorTextForDetail } from "@/lib/utils/upstream-error-detection";
import type { HedgeLoserBilling } from "@/types/cost-breakdown";
import type { ProviderChainItem } from "@/types/message";
import type { RoutingTraceV1 } from "@/types/routing-trace";

const KNOWN_BYPASS_REASONS = new Set([
  "disabled",
  "non_streaming",
  "retry_not_allowed",
  "provider_switch_not_allowed",
  "raw_passthrough",
  "unsupported_protocol",
  "websocket",
  "streaming_hedge_disabled",
  "raw_cross_provider_fallback",
  "missing_session",
  "missing_key",
  "rollout_ineligible",
  "redis_capability_unavailable",
  "binding_conflict",
  "lease_conflict",
  "lease_unavailable",
]);

const KNOWN_CANCELLATION_KINDS = new Set([
  "discovery_loser",
  "discovery_sla_timeout",
  "round_timeout",
  "sticky_timeout",
  "request_deadline",
  "client_abort",
  "winner_committed",
]);

type TraceRecord = Record<string, unknown>;

type AttemptView = {
  id: string;
  providerId: number | null;
  providerName: string | null;
  sequence: number | null;
  round: number;
  role: "sticky" | "normal" | "fallback";
  promotedFrom: "sticky" | "normal" | null;
  priority: number | null;
  startedAt: number | null;
  elapsedMs: number | null;
  outcome:
    | "pending"
    | "ready"
    | "held"
    | "winner"
    | "failed"
    | "cancelled"
    | "timeout"
    | "client_abort"
    | "deadline";
  statusCode: number | null;
  cancellationKind: string | null;
  reason: string | null;
  fallbackPromoted: boolean;
  winnerCommitted: boolean;
  chainItem: ProviderChainItem | null;
  billingEntry: HedgeLoserBilling | null;
  billingStatus: "none" | "billed" | "not_obtained";
  winnerCostUsd: string | null;
  history: Array<{
    type: string;
    elapsedMs: number | null;
    outcome: AttemptView["outcome"] | null;
    cancellationKind: string | null;
    reason: string | null;
  }>;
};

function findDiscoveryBillingEntry(
  hedgeLosers: HedgeLoserBilling[] | null | undefined,
  attempt: Pick<AttemptView, "providerId" | "sequence" | "chainItem">
): HedgeLoserBilling | null {
  if (!hedgeLosers || hedgeLosers.length === 0 || attempt.providerId == null) return null;
  const candidates = hedgeLosers.filter((entry) => entry.providerId === attempt.providerId);
  if (candidates.length === 0) return null;

  const attemptNumbers = [attempt.sequence ?? attempt.chainItem?.attemptNumber].filter(
    (number): number is number => number != null && Number.isFinite(number)
  );
  for (const attemptNumber of attemptNumbers) {
    const exact = candidates.find((entry) => entry.attemptNumber === attemptNumber);
    if (exact) return exact;
  }
  return null;
}

function inferMissingBillingStatus(attempt: AttemptView): AttemptView["billingStatus"] {
  if (attempt.winnerCommitted || attempt.outcome === "winner") return "none";
  if (
    attempt.outcome === "cancelled" ||
    attempt.outcome === "timeout" ||
    attempt.outcome === "client_abort" ||
    attempt.outcome === "deadline" ||
    attempt.outcome === "failed"
  ) {
    return "not_obtained";
  }
  return "none";
}

function asRecord(value: unknown): TraceRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as TraceRecord) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isDisplayableCost(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}

function parseAttemptSequence(attemptId: string): number | null {
  const match = /:(\d+)$/.exec(attemptId);
  return match ? Number(match[1]) : null;
}

function truncateForDisplay(value: string, maxLength = 8_192): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...` : value;
}

function sanitizeEndpoint(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return truncateForDisplay(url.toString(), 2_048);
  } catch {
    return truncateForDisplay(value.split(/[?#]/, 1)[0], 2_048);
  }
}

function getChainErrorMessage(item: ProviderChainItem | null): string | null {
  if (!item) return null;
  const sanitize = (value: string) =>
    truncateForDisplay(sanitizeErrorTextForDetail(redactJsonString(value)));
  if (item.errorMessage) return sanitize(item.errorMessage);
  if (item.errorDetails?.provider?.upstreamBody) {
    return sanitize(item.errorDetails.provider.upstreamBody);
  }
  if (item.errorDetails?.system?.errorMessage) {
    return sanitize(item.errorDetails.system.errorMessage);
  }
  if (item.errorDetails?.clientError) return sanitize(item.errorDetails.clientError);
  return null;
}

function buildProviderChainLookup(providerChain: ProviderChainItem[]): {
  byAttempt: Map<string, ProviderChainItem>;
  uniqueByProvider: Map<number, ProviderChainItem>;
} {
  const byAttempt = new Map<string, ProviderChainItem>();
  const byProvider = new Map<number, ProviderChainItem[]>();
  for (const item of providerChain) {
    const items = byProvider.get(item.id) ?? [];
    items.push(item);
    byProvider.set(item.id, items);
    if (Number.isFinite(item.attemptNumber)) {
      byAttempt.set(`${item.id}:${item.attemptNumber}`, item);
    }
  }

  const uniqueByProvider = new Map<number, ProviderChainItem>();
  for (const [providerId, items] of byProvider) {
    if (items.length === 1) uniqueByProvider.set(providerId, items[0]);
  }
  return { byAttempt, uniqueByProvider };
}

function findChainItem(
  attemptId: string,
  providerId: number | null,
  lookup: ReturnType<typeof buildProviderChainLookup>
): ProviderChainItem | null {
  if (providerId == null) return null;
  const sequence = parseAttemptSequence(attemptId);
  if (sequence != null) {
    const exact = lookup.byAttempt.get(`${providerId}:${sequence}`);
    if (exact) return exact;
  }
  return lookup.uniqueByProvider.get(providerId) ?? null;
}

function eventType(event: TraceRecord): string {
  return asString(event.type) ?? asString(event.event) ?? "unknown";
}

function eventProvider(event: TraceRecord): {
  id: number | null;
  name: string | null;
  priority: number | null;
} {
  const provider = asRecord(event.provider);
  return {
    id: asNumber(event.providerId) ?? asNumber(provider.id),
    name: asString(event.providerName) ?? asString(provider.name),
    priority: asNumber(event.priority) ?? asNumber(provider.priority),
  };
}

function normalizeRole(value: unknown, round: number): AttemptView["role"] {
  if (value === "fallback") return "fallback";
  if (value === "sticky" || round === 0) return "sticky";
  return "normal";
}

function normalizeOutcome(value: unknown): AttemptView["outcome"] | null {
  switch (value) {
    case "pending":
    case "ready":
    case "held":
    case "winner":
    case "failed":
    case "cancelled":
    case "timeout":
    case "client_abort":
    case "deadline":
      return value;
    case "sla_timeout":
      return "timeout";
    default:
      return null;
  }
}

function normalizeTerminalOutcome(
  value: unknown
): "success" | "failed" | "client_abort" | "deadline" | "pending" {
  switch (value) {
    case "success":
    case "failed":
    case "client_abort":
    case "deadline":
      return value;
    default:
      return "pending";
  }
}

function applyEventOutcome(
  attempt: AttemptView,
  type: string,
  event: TraceRecord,
  roleBeforeEvent: AttemptView["role"] | null
): void {
  const explicit = normalizeOutcome(event.outcome);
  if (explicit) attempt.outcome = explicit;

  switch (type) {
    case "attempt_ready":
      attempt.outcome = "ready";
      break;
    case "attempt_held":
      attempt.outcome = "held";
      break;
    case "attempt_failed":
      attempt.outcome = "failed";
      break;
    case "attempt_cancelled":
      attempt.outcome = "cancelled";
      break;
    case "fallback_promoted":
      if (roleBeforeEvent && roleBeforeEvent !== "fallback") {
        attempt.promotedFrom = roleBeforeEvent;
      }
      attempt.role = "fallback";
      attempt.fallbackPromoted = true;
      break;
    case "winner_committed":
      attempt.outcome = "winner";
      attempt.winnerCommitted = true;
      break;
  }

  const cancellationKind = asString(event.cancellationKind);
  if (cancellationKind === "client_abort") attempt.outcome = "client_abort";
  if (cancellationKind === "request_deadline") attempt.outcome = "deadline";
  if (
    cancellationKind === "discovery_sla_timeout" ||
    cancellationKind === "round_timeout" ||
    cancellationKind === "sticky_timeout"
  ) {
    attempt.outcome = "timeout";
  }
}

function buildAttempts(
  trace: RoutingTraceV1,
  providerChain: ProviderChainItem[],
  hedgeLosers: HedgeLoserBilling[] | null | undefined,
  costUsd: string | null | undefined
): AttemptView[] {
  const attempts = new Map<string, AttemptView>();
  const lookup = buildProviderChainLookup(providerChain);

  for (const rawEvent of trace.events) {
    const event = asRecord(rawEvent);
    const type = eventType(event);
    const provider = eventProvider(event);
    const attemptId =
      asString(event.attemptId) ??
      (provider.id != null && type.startsWith("attempt_")
        ? `${provider.id}:${asNumber(event.sequence) ?? attempts.size + 1}`
        : null);
    if (!attemptId) continue;

    const round = Math.max(0, asNumber(event.round) ?? 0);
    const existing = attempts.get(attemptId);
    const initialRole = normalizeRole(event.attemptKind ?? event.role ?? event.kind, round);
    const attempt: AttemptView = existing ?? {
      id: attemptId,
      providerId: provider.id,
      providerName: provider.name,
      sequence: parseAttemptSequence(attemptId),
      round,
      role: initialRole,
      promotedFrom: null,
      priority: provider.priority,
      startedAt: null,
      elapsedMs: null,
      outcome: "pending",
      statusCode: null,
      cancellationKind: null,
      reason: null,
      fallbackPromoted: false,
      winnerCommitted: false,
      chainItem: findChainItem(attemptId, provider.id, lookup),
      billingEntry: null,
      billingStatus: "none",
      winnerCostUsd: null,
      history: [],
    };

    attempt.providerId ??= provider.id;
    attempt.providerName ??= provider.name;
    attempt.sequence ??= parseAttemptSequence(attempt.id);
    attempt.chainItem ??= findChainItem(attempt.id, attempt.providerId, lookup);
    attempt.round = Math.max(attempt.round, round);
    attempt.priority ??= provider.priority;
    attempt.statusCode ??= asNumber(event.statusCode);
    attempt.cancellationKind ??= asString(event.cancellationKind);
    attempt.reason ??= asString(event.reason);
    const elapsedMs = asNumber(event.elapsedMs);
    if (type === "attempt_started") attempt.startedAt = elapsedMs;
    if (elapsedMs != null) attempt.elapsedMs = elapsedMs;
    const roleBeforeEvent = existing ? attempt.role : null;
    attempt.role =
      attempt.role === "fallback"
        ? "fallback"
        : normalizeRole(
            event.attemptKind ?? event.role ?? event.kind ?? attempt.role,
            attempt.round
          );
    applyEventOutcome(attempt, type, event, roleBeforeEvent);
    if (
      type === "attempt_started" ||
      type === "attempt_ready" ||
      type === "attempt_held" ||
      type === "attempt_finished" ||
      type === "fallback_promoted" ||
      type === "winner_committed"
    ) {
      attempt.history.push({
        type,
        elapsedMs,
        outcome: normalizeOutcome(event.outcome),
        cancellationKind: asString(event.cancellationKind),
        reason: asString(event.reason),
      });
    }
    attempts.set(attemptId, attempt);
  }

  const terminalEvent = trace.events.findLast((event) => event.type === "request_finished");
  const terminalOutcome = normalizeTerminalOutcome(terminalEvent?.outcome);
  if (terminalEvent && terminalOutcome !== "success") {
    for (const attempt of attempts.values()) {
      if (!attempt.winnerCommitted) continue;
      attempt.outcome =
        terminalOutcome === "client_abort" || terminalOutcome === "deadline"
          ? terminalOutcome
          : "failed";
      attempt.statusCode = terminalEvent?.statusCode ?? attempt.statusCode;
    }
  }

  const sortedAttempts = [...attempts.values()].sort((a, b) => {
    if (a.round !== b.round) return a.round - b.round;
    return (a.startedAt ?? Number.MAX_SAFE_INTEGER) - (b.startedAt ?? Number.MAX_SAFE_INTEGER);
  });

  const hedgeSummary = summarizeHedgeBilling(costUsd, hedgeLosers);
  for (const attempt of sortedAttempts) {
    const billingEntry = findDiscoveryBillingEntry(hedgeLosers, attempt);
    if (billingEntry) {
      attempt.billingEntry = billingEntry;
      attempt.billingStatus = "billed";
      continue;
    }

    attempt.billingStatus = inferMissingBillingStatus(attempt);
    if (attempt.winnerCommitted || attempt.outcome === "winner") {
      // When billed losers exist, subtract them from the persisted request total
      // so the winner card agrees with the existing hedge billing table. With no
      // loser entry, costUsd is the only safe winner amount available.
      attempt.winnerCostUsd = hedgeSummary?.winnerCost ?? costUsd ?? null;
    }
  }

  return sortedAttempts;
}

function numberFrom(record: TraceRecord, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = asNumber(record[key]);
    if (value != null) return value;
  }
  return null;
}

function deriveRuntimeStats(trace: RoutingTraceV1): {
  rounds: number;
  attemptCount: number;
  maxActive: number;
} {
  const startedAttempts = new Set<string>();
  const activeAttempts = new Set<string>();
  let anonymousAttempts = 0;
  let maxActive = 0;
  let maxRound = 0;

  for (const event of trace.events) {
    if (typeof event.round === "number" && Number.isFinite(event.round)) {
      maxRound = Math.max(maxRound, event.round);
    }

    if (event.type === "attempt_started") {
      if (!event.attemptId) {
        anonymousAttempts += 1;
        continue;
      }
      if (!startedAttempts.has(event.attemptId)) {
        startedAttempts.add(event.attemptId);
        activeAttempts.add(event.attemptId);
        maxActive = Math.max(maxActive, activeAttempts.size);
      }
      continue;
    }

    if (event.type === "attempt_finished" && event.attemptId) {
      activeAttempts.delete(event.attemptId);
    }
  }

  return {
    rounds: maxRound,
    attemptCount: startedAttempts.size + anonymousAttempts,
    maxActive,
  };
}

function outcomeStyle(outcome: AttemptView["outcome"]): {
  icon: typeof Server;
  className: string;
} {
  switch (outcome) {
    case "winner":
      return {
        icon: CheckCircle,
        className:
          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300",
      };
    case "failed":
      return {
        icon: XCircle,
        className:
          "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/20 dark:text-rose-300",
      };
    case "cancelled":
    case "client_abort":
    case "deadline":
      return {
        icon: XCircle,
        className:
          "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
      };
    case "held":
    case "timeout":
      return {
        icon: Clock3,
        className:
          "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300",
      };
    case "ready":
      return {
        icon: ShieldCheck,
        className:
          "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-300",
      };
    default:
      return {
        icon: Server,
        className: "border-border bg-muted/30 text-muted-foreground dark:bg-slate-900/30",
      };
  }
}

export function RoutingModeBanner({ trace }: { trace: RoutingTraceV1 }) {
  const t = useTranslations("dashboard.logs.details.routingTrace");
  const isLeaseConflict =
    trace.mode === "single_upstream" && trace.bypassReason === "lease_conflict";
  const Icon =
    trace.mode === "discovery"
      ? Zap
      : isLeaseConflict
        ? ShieldCheck
        : trace.mode === "single_upstream"
          ? Server
          : GitBranch;
  const rawReason = trace.bypassReason;
  const reason =
    rawReason && KNOWN_BYPASS_REASONS.has(rawReason) ? rawReason : rawReason ? "unknown" : null;

  return (
    <div className="border-y py-3 space-y-2" data-testid="routing-mode-banner">
      <div className="flex items-center gap-2 flex-wrap">
        <Icon className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <span className="text-xs text-muted-foreground">{t("title")}</span>
        <Badge variant="outline" className="max-w-full whitespace-normal text-left">
          {isLeaseConflict ? t("modes.lease_conflict") : t(`modes.${trace.mode}`)}
        </Badge>
      </div>
      {reason && (
        <p className="text-xs text-muted-foreground break-words">
          {t("bypassed", { reason: t(`bypassReasons.${reason}`) })}
        </p>
      )}
    </div>
  );
}

export function DiscoveryTraceView({
  trace,
  providerChain = [],
  hedgeLosers,
  costUsd,
  winnerUsage,
}: {
  trace: RoutingTraceV1;
  providerChain?: ProviderChainItem[];
  hedgeLosers?: HedgeLoserBilling[] | null;
  costUsd?: string | null;
  winnerUsage?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    cacheCreationInputTokens?: number | null;
    cacheReadInputTokens?: number | null;
  };
}) {
  const t = useTranslations("dashboard.logs.details.routingTrace");
  const attempts = buildAttempts(trace, providerChain, hedgeLosers, costUsd);
  const grouped = new Map<number, AttemptView[]>();
  for (const attempt of attempts) {
    const group = grouped.get(attempt.round) ?? [];
    group.push(attempt);
    grouped.set(attempt.round, group);
  }

  const summary = asRecord(trace.summary);
  const config = asRecord(trace.config);
  const runtimeStats = deriveRuntimeStats(trace);
  const rounds =
    numberFrom(summary, "rounds", "roundsVisited") ??
    Math.max(runtimeStats.rounds, ...attempts.map((attempt) => attempt.round));
  const attemptCount =
    numberFrom(summary, "attemptsPerRequest", "attempts", "attemptsStarted") ??
    Math.max(runtimeStats.attemptCount, attempts.length);
  const maxActive = numberFrom(summary, "maxActive", "maxActiveAttempts") ?? runtimeStats.maxActive;
  const terminalEvent = trace.events.findLast((event) => event.type === "request_finished");
  const bindingEvent = trace.events.findLast((event) => event.type === "binding_finalized");
  const terminalOutcome = normalizeTerminalOutcome(terminalEvent?.outcome);
  const bindingOutcome =
    bindingEvent?.outcome === "updated" ||
    bindingEvent?.outcome === "cleared" ||
    bindingEvent?.outcome === "skipped" ||
    bindingEvent?.outcome === "failed"
      ? bindingEvent.outcome
      : "unknown";
  const isFallbackWinnerBinding =
    bindingEvent?.bindingAction === "none" &&
    bindingOutcome === "skipped" &&
    bindingEvent.reason === "fallback_winner" &&
    asString(summary.winnerOrigin) === "fallback";
  const bindingSummary = isFallbackWinnerBinding
    ? t("bindingFallbackWinner")
    : bindingEvent
      ? `${t(`bindingActions.${bindingEvent.bindingAction ?? "none"}`)} · ${t(`bindingOutcomes.${bindingOutcome}`)}`
      : null;

  return (
    <div className="space-y-5" data-testid="discovery-trace-view">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            {t("discoveryTitle")}
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("summary", { rounds, attempts: attemptCount, maxActive })}
          </p>
        </div>
        {trace.truncated && (
          <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-300">
            {t("traceTruncated")}
          </Badge>
        )}
      </div>

      {(terminalEvent || bindingEvent) && (
        <div className="border-y divide-y text-xs" data-testid="discovery-terminal-status">
          {terminalEvent && (
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-muted-foreground">{t("terminalOutcome")}</span>
              <div className="flex items-center justify-end gap-2 flex-wrap">
                <Badge variant="outline">{t(`outcomes.${terminalOutcome}`)}</Badge>
                {terminalEvent.statusCode != null && (
                  <span className="font-mono">HTTP {terminalEvent.statusCode}</span>
                )}
              </div>
            </div>
          )}
          {bindingEvent && (
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-muted-foreground">{t("bindingResult")}</span>
              <div className="min-w-0 text-right">
                <div
                  className="font-medium"
                  data-testid="discovery-binding-summary"
                  title={isFallbackWinnerBinding ? bindingEvent.reason : undefined}
                >
                  {bindingSummary}
                </div>
                {bindingEvent.reason && !isFallbackWinnerBinding && (
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground break-all">
                    {bindingEvent.reason}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {Object.keys(config).length > 0 && (
        <div className="border-y py-3">
          <div className="text-xs font-medium mb-2">{t("config")}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
            {numberFrom(config, "discoveryConcurrency", "concurrency") != null && (
              <TraceValue
                label={t("configConcurrency")}
                value={numberFrom(config, "discoveryConcurrency", "concurrency")}
              />
            )}
            {numberFrom(config, "maxDiscoveryRounds", "maxRounds") != null && (
              <TraceValue
                label={t("configMaxRounds")}
                value={numberFrom(config, "maxDiscoveryRounds", "maxRounds")}
              />
            )}
            {numberFrom(config, "discoverySlaMs") != null && (
              <TraceValue
                label={t("configDiscoverySla")}
                value={`${numberFrom(config, "discoverySlaMs")}ms`}
              />
            )}
            {numberFrom(config, "stickySlaMs") != null && (
              <TraceValue
                label={t("configStickySla")}
                value={`${numberFrom(config, "stickySlaMs")}ms`}
              />
            )}
            {numberFrom(config, "racingTotalTimeoutMs", "totalTimeoutMs") != null && (
              <TraceValue
                label={t("configTotalTimeout")}
                value={`${numberFrom(config, "racingTotalTimeoutMs", "totalTimeoutMs")}ms`}
              />
            )}
            {numberFrom(config, "stickyTimeoutCooldownMs") != null && (
              <TraceValue
                label={t("configStickyCooldown")}
                value={`${numberFrom(config, "stickyTimeoutCooldownMs")}ms`}
              />
            )}
            {numberFrom(config, "sessionTtlSeconds") != null && (
              <TraceValue
                label={t("configStickyBindingTtl")}
                value={`${numberFrom(config, "sessionTtlSeconds")}s`}
              />
            )}
          </div>
        </div>
      )}

      {grouped.size === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          <CircleDot className="h-7 w-7 mx-auto mb-2 opacity-50" />
          {t("noAttempts")}
        </div>
      ) : (
        <div className="space-y-6">
          {[...grouped.entries()].map(([round, roundAttempts]) => (
            <section key={round} className="space-y-3" data-testid={`discovery-round-${round}`}>
              <div className="flex items-center justify-between gap-3 border-b pb-2">
                <div className="flex items-center gap-2 min-w-0">
                  {round === 0 ? (
                    <Link2 className="h-4 w-4 shrink-0 text-violet-600" />
                  ) : (
                    <GitBranch className="h-4 w-4 shrink-0 text-blue-600" />
                  )}
                  <h5 className="text-sm font-medium truncate">
                    {round === 0 ? t("stickyPhase") : t("round", { round })}
                  </h5>
                </div>
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {t("attempts", { count: roundAttempts.length })}
                </Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {roundAttempts.map((attempt) => (
                  <AttemptCard key={attempt.id} attempt={attempt} winnerUsage={winnerUsage} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function TraceValue({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-mono break-all">{value}</div>
    </div>
  );
}

function AttemptCard({
  attempt,
  winnerUsage,
}: {
  attempt: AttemptView;
  winnerUsage?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    cacheCreationInputTokens?: number | null;
    cacheReadInputTokens?: number | null;
  };
}) {
  const t = useTranslations("dashboard.logs.details.routingTrace");
  const tDetails = useTranslations("dashboard.logs.details");
  const [expanded, setExpanded] = useState(false);
  const style = outcomeStyle(attempt.outcome);
  const Icon = style.icon;
  const providerName =
    attempt.providerName ?? t("providerFallback", { id: attempt.providerId ?? "-" });
  const chainItem = attempt.chainItem;
  const statusCode = chainItem?.statusCode ?? attempt.statusCode;
  const endpoint = sanitizeEndpoint(chainItem?.endpointUrl);
  const errorMessage = getChainErrorMessage(chainItem);
  const roleLabel = attempt.promotedFrom
    ? t("roleTransition", {
        from: t(`roles.${attempt.promotedFrom}`),
        to: t(`roles.${attempt.role}`),
      })
    : t(`roles.${attempt.role}`);
  const cancellationLabel = attempt.cancellationKind
    ? KNOWN_CANCELLATION_KINDS.has(attempt.cancellationKind)
      ? t(`cancellationKinds.${attempt.cancellationKind}`)
      : attempt.cancellationKind
    : null;

  const billingEntry = attempt.billingEntry;
  const billedCost = attempt.winnerCostUsd ?? billingEntry?.costUsd;
  const tokenRows = billingEntry
    ? [
        ["input", billingEntry.inputTokens],
        ["output", billingEntry.outputTokens],
        ["cacheWrite", billingEntry.cacheCreationInputTokens],
        ["cacheRead", billingEntry.cacheReadInputTokens],
      ].filter(([, value]) => typeof value === "number" && Number.isFinite(value))
    : [];
  const winnerTokenRows = attempt.winnerCommitted
    ? [
        ["input", winnerUsage?.inputTokens],
        ["output", winnerUsage?.outputTokens],
        ["cacheWrite", winnerUsage?.cacheCreationInputTokens],
        ["cacheRead", winnerUsage?.cacheReadInputTokens],
      ].filter(([, value]) => typeof value === "number" && Number.isFinite(value))
    : [];
  const renderBillingDetails = () => {
    const isWinner = attempt.winnerCommitted || attempt.outcome === "winner";
    const effectiveStatus =
      isWinner && attempt.winnerCostUsd != null ? "billed" : attempt.billingStatus;
    if (effectiveStatus === "none") return null;
    const statusKey = effectiveStatus === "billed" ? "billed" : "notObtained";
    const statusClass =
      effectiveStatus === "billed"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300"
        : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300";
    const rows = isWinner ? winnerTokenRows : tokenRows;

    return (
      <div
        className="border-t border-current/10 pt-2 space-y-2"
        data-testid="discovery-attempt-billing"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">{t("attemptDetails.billing")}</span>
          <Badge
            variant="outline"
            className={cn("text-[10px]", statusClass)}
            data-testid="discovery-attempt-billing-status"
          >
            {t(`attemptDetails.${statusKey}`)}
          </Badge>
        </div>
        {effectiveStatus === "billed" && isDisplayableCost(billedCost) && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">
              {isWinner ? t("attemptDetails.winnerCost") : t("attemptDetails.billedCost")}
            </span>
            <span className="font-mono font-medium">{formatCurrency(billedCost, "USD", 6)}</span>
          </div>
        )}
        {effectiveStatus === "billed" && rows.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-muted-foreground">
            {rows.map(([kind, value]) => (
              <span key={kind}>
                {tDetails(`billingDetails.${kind}`)} {formatTokenAmount(value as number)}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <article
      className={cn("min-w-0 rounded-md border p-3", style.className)}
      data-testid="discovery-attempt"
    >
      <button
        type="button"
        className="w-full min-w-0 text-left"
        aria-expanded={expanded}
        data-testid="discovery-attempt-toggle"
        onClick={() => setExpanded((current) => !current)}
      >
        <div className="flex items-start gap-2 min-w-0">
          <Icon className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2 min-w-0">
              <span className="text-sm font-medium truncate" title={providerName}>
                {providerName}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                {statusCode != null && (
                  <span className="text-[10px] font-mono">HTTP {statusCode}</span>
                )}
                {expanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className="text-[10px] bg-background/60">
                {roleLabel}
              </Badge>
              <Badge variant="outline" className="text-[10px] bg-background/60">
                {t(`outcomes.${attempt.outcome}`)}
              </Badge>
              {attempt.priority != null && (
                <span className="text-[10px] opacity-80">
                  {t("priority", { priority: attempt.priority })}
                </span>
              )}
              {attempt.elapsedMs != null && (
                <span className="text-[10px] font-mono opacity-80">
                  {t("elapsed", { elapsed: Math.max(0, Math.round(attempt.elapsedMs)) })}
                </span>
              )}
            </div>
            {(attempt.fallbackPromoted || attempt.winnerCommitted) && (
              <div className="mt-2 flex items-center gap-1 text-[10px]">
                <ChevronRight className="h-3 w-3 shrink-0" />
                <span>
                  {attempt.winnerCommitted ? t("winnerCommitted") : t("fallbackPromoted")}
                </span>
              </div>
            )}
          </div>
        </div>
      </button>
      {expanded && (
        <div
          className="mt-3 border-t border-current/10 pt-3 space-y-2 text-[10px]"
          data-testid="discovery-attempt-details"
        >
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 min-w-0">
            {attempt.providerId != null && (
              <TraceValue label={t("attemptDetails.providerId")} value={attempt.providerId} />
            )}
            {attempt.sequence != null && (
              <TraceValue label={t("attemptDetails.attempt")} value={`#${attempt.sequence}`} />
            )}
            {statusCode != null && (
              <TraceValue
                label={t("attemptDetails.status")}
                value={`${statusCode}${chainItem?.statusCodeInferred ? ` ${t("attemptDetails.inferred")}` : ""}`}
              />
            )}
          </div>
          {endpoint && (
            <div className="border-t border-current/10 pt-2 min-w-0">
              <div className="text-muted-foreground mb-1">{t("attemptDetails.endpoint")}</div>
              <code className="block break-all">{endpoint}</code>
            </div>
          )}
          {errorMessage && (
            <div className="border-t border-current/10 pt-2 min-w-0">
              <div className="text-rose-700 dark:text-rose-300 mb-1">
                {t("attemptDetails.error")}
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-rose-50 p-2 dark:bg-rose-950/20">
                {errorMessage}
              </pre>
            </div>
          )}
          {cancellationLabel && (
            <div className="border-t border-current/10 pt-2">
              <span className="text-muted-foreground">{t("attemptDetails.cancellation")}:</span>{" "}
              <span>{cancellationLabel}</span>
            </div>
          )}
          {renderBillingDetails()}
          {attempt.history.length > 0 && (
            <div className="border-t border-current/10 pt-2 space-y-1">
              <div className="text-muted-foreground">{t("attemptDetails.timeline")}</div>
              {attempt.history.map((event, index) => (
                <div
                  key={`${event.type}-${event.elapsedMs ?? "unknown"}-${index}`}
                  className="flex items-center justify-between gap-2 min-w-0"
                >
                  <span className="flex items-center gap-1 min-w-0">
                    <span className="h-1 w-1 rounded-full bg-current shrink-0 opacity-60" />
                    <span className="truncate">{formatAttemptEvent(t, event)}</span>
                  </span>
                  {event.elapsedMs != null && (
                    <span className="font-mono shrink-0 opacity-80">
                      {t("elapsed", { elapsed: Math.max(0, Math.round(event.elapsedMs)) })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function formatAttemptEvent(
  t: ReturnType<typeof useTranslations<"dashboard.logs.details.routingTrace">>,
  event: AttemptView["history"][number]
): string {
  switch (event.type) {
    case "attempt_started":
      return t("events.started");
    case "attempt_ready":
      return t("events.ready");
    case "attempt_held":
      return t("events.held");
    case "fallback_promoted":
      return t("events.fallbackPromoted");
    case "winner_committed":
      return t("events.winnerCommitted");
    case "attempt_finished":
      return t("events.finished", {
        outcome: t(`outcomes.${event.outcome ?? "pending"}`),
      });
    default:
      return event.type;
  }
}
