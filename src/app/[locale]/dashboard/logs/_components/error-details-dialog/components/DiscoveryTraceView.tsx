"use client";

import {
  CheckCircle,
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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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

type TraceRecord = Record<string, unknown>;

type AttemptView = {
  id: string;
  providerId: number | null;
  providerName: string | null;
  round: number;
  role: "sticky" | "normal" | "fallback";
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
  fallbackPromoted: boolean;
  winnerCommitted: boolean;
  history: Array<{
    type: string;
    elapsedMs: number | null;
    outcome: AttemptView["outcome"] | null;
  }>;
};

function asRecord(value: unknown): TraceRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as TraceRecord) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

function applyEventOutcome(attempt: AttemptView, type: string, event: TraceRecord): void {
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

function buildAttempts(trace: RoutingTraceV1): AttemptView[] {
  const attempts = new Map<string, AttemptView>();

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
    const attempt: AttemptView = existing ?? {
      id: attemptId,
      providerId: provider.id,
      providerName: provider.name,
      round,
      role: normalizeRole(event.attemptKind ?? event.role ?? event.kind, round),
      priority: provider.priority,
      startedAt: null,
      elapsedMs: null,
      outcome: "pending",
      statusCode: null,
      fallbackPromoted: false,
      winnerCommitted: false,
      history: [],
    };

    attempt.providerId ??= provider.id;
    attempt.providerName ??= provider.name;
    attempt.round = Math.max(attempt.round, round);
    attempt.priority ??= provider.priority;
    attempt.statusCode ??= asNumber(event.statusCode);
    const elapsedMs = asNumber(event.elapsedMs);
    if (type === "attempt_started") attempt.startedAt = elapsedMs;
    if (elapsedMs != null) attempt.elapsedMs = elapsedMs;
    attempt.role =
      attempt.role === "fallback"
        ? "fallback"
        : normalizeRole(
            event.attemptKind ?? event.role ?? event.kind ?? attempt.role,
            attempt.round
          );
    applyEventOutcome(attempt, type, event);
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

  return [...attempts.values()].sort((a, b) => {
    if (a.round !== b.round) return a.round - b.round;
    return (a.startedAt ?? Number.MAX_SAFE_INTEGER) - (b.startedAt ?? Number.MAX_SAFE_INTEGER);
  });
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
  const Icon =
    trace.mode === "discovery" ? Zap : trace.mode === "single_upstream" ? Server : GitBranch;
  const rawReason = trace.bypassReason;
  const reason =
    rawReason && KNOWN_BYPASS_REASONS.has(rawReason) ? rawReason : rawReason ? "unknown" : null;

  return (
    <div className="border-y py-3 space-y-2" data-testid="routing-mode-banner">
      <div className="flex items-center gap-2 flex-wrap">
        <Icon className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <span className="text-xs text-muted-foreground">{t("title")}</span>
        <Badge variant="outline" className="max-w-full whitespace-normal text-left">
          {t(`modes.${trace.mode}`)}
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

export function DiscoveryTraceView({ trace }: { trace: RoutingTraceV1 }) {
  const t = useTranslations("dashboard.logs.details.routingTrace");
  const attempts = buildAttempts(trace);
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
                <div className="font-medium">
                  {t(`bindingActions.${bindingEvent.bindingAction ?? "none"}`)} ·{" "}
                  {t(`bindingOutcomes.${bindingOutcome}`)}
                </div>
                {bindingEvent.reason && (
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
                  <AttemptCard key={attempt.id} attempt={attempt} />
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

function AttemptCard({ attempt }: { attempt: AttemptView }) {
  const t = useTranslations("dashboard.logs.details.routingTrace");
  const style = outcomeStyle(attempt.outcome);
  const Icon = style.icon;
  const providerName =
    attempt.providerName ?? t("providerFallback", { id: attempt.providerId ?? "-" });

  return (
    <article
      className={cn("min-w-0 rounded-md border p-3", style.className)}
      data-testid="discovery-attempt"
    >
      <div className="flex items-start gap-2 min-w-0">
        <Icon className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2 min-w-0">
            <span className="text-sm font-medium truncate" title={providerName}>
              {providerName}
            </span>
            {attempt.elapsedMs != null && (
              <span className="text-[10px] font-mono shrink-0">
                {t("elapsed", { elapsed: Math.max(0, Math.round(attempt.elapsedMs)) })}
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[10px] bg-background/60">
              {t(`roles.${attempt.role}`)}
            </Badge>
            <Badge variant="outline" className="text-[10px] bg-background/60">
              {t(`outcomes.${attempt.outcome}`)}
            </Badge>
            {attempt.priority != null && (
              <span className="text-[10px] opacity-80">
                {t("priority", { priority: attempt.priority })}
              </span>
            )}
            {attempt.statusCode != null && (
              <span className="text-[10px] font-mono">HTTP {attempt.statusCode}</span>
            )}
          </div>
          {(attempt.fallbackPromoted || attempt.winnerCommitted) && (
            <div className="mt-2 flex items-center gap-1 text-[10px]">
              <ChevronRight className="h-3 w-3 shrink-0" />
              <span>{attempt.winnerCommitted ? t("winnerCommitted") : t("fallbackPromoted")}</span>
            </div>
          )}
          {attempt.history.length > 0 && (
            <div className="mt-2 border-t border-current/10 pt-2 space-y-1">
              {attempt.history.map((event, index) => (
                <div
                  key={`${event.type}-${event.elapsedMs ?? "unknown"}-${index}`}
                  className="flex items-center justify-between gap-2 text-[10px] min-w-0"
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
      </div>
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
