import { logger } from "@/lib/logger";
import type { RoutingTraceSummaryV1 } from "@/types/routing-trace";

export type DiscoveryLifecycleEvent =
  | "request_started"
  | "attempt_started"
  | "attempt_finished"
  | "fallback_promoted"
  | "parser_limit"
  | "cancel_failed"
  | "lease_conflict"
  | "binding_cas_conflict"
  | "request_finished";

export type DiscoveryWinnerOrigin = "sticky" | "normal" | "fallback" | "none";

type DiscoveryMetricIdentity = {
  requestId: number | string | null;
  sessionId: string;
  keyId: number;
};

export function recordDiscoveryControlEvent(
  event: "lease_conflict" | "binding_cas_conflict",
  context: DiscoveryMetricIdentity & Record<string, unknown>
): void {
  logger.info("[DiscoveryMetric] Control event", { event, ...context });
}

export class DiscoveryRequestMetrics {
  private readonly attemptStartedAt = new Map<string, number>();
  private readonly fallbackAttempts = new Set<string>();
  private attempts = 0;
  private active = 0;
  private maxActive = 0;
  private maxRound = 0;
  private providerMs = 0;
  private fallbackPromotions = 0;
  private cancelFailures = 0;
  private summary: RoutingTraceSummaryV1 | null = null;

  constructor(
    private readonly identity: DiscoveryMetricIdentity,
    private readonly startedAt: number
  ) {
    this.event("request_started");
  }

  event(event: DiscoveryLifecycleEvent, context: Record<string, unknown> = {}): void {
    logger.debug("[DiscoveryMetric] Lifecycle event", {
      event,
      ...this.identity,
      elapsedMs: Math.max(0, Date.now() - this.startedAt),
      ...context,
    });
  }

  attemptStarted(options: {
    attemptId: string;
    providerId: number;
    round: number;
    kind: DiscoveryWinnerOrigin;
  }): void {
    if (this.attemptStartedAt.has(options.attemptId)) return;
    this.attemptStartedAt.set(options.attemptId, Date.now());
    this.attempts += 1;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.maxRound = Math.max(this.maxRound, options.round);
    this.event("attempt_started", options);
  }

  attemptFinished(
    attemptId: string,
    context: { providerId: number; outcome: string; cancellationKind?: string | null }
  ): void {
    const startedAt = this.attemptStartedAt.get(attemptId);
    if (startedAt == null) return;
    this.attemptStartedAt.delete(attemptId);
    this.active = Math.max(0, this.active - 1);
    const durationMs = Math.max(0, Date.now() - startedAt);
    this.providerMs += durationMs;
    this.event("attempt_finished", { attemptId, durationMs, ...context });
  }

  fallbackPromoted(attemptId: string, providerId: number, round: number): void {
    if (this.fallbackAttempts.has(attemptId)) return;
    this.fallbackAttempts.add(attemptId);
    this.fallbackPromotions += 1;
    this.maxRound = Math.max(this.maxRound, round);
    this.event("fallback_promoted", { attemptId, providerId, round });
  }

  cancelFailed(attemptId: string, providerId: number, error: unknown): void {
    this.cancelFailures += 1;
    this.event("cancel_failed", {
      attemptId,
      providerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  snapshot(context: {
    outcome: "success" | "failed" | "client_abort" | "deadline";
    statusCode: number;
    winnerOrigin?: DiscoveryWinnerOrigin;
    winnerProviderId?: number | null;
    winnerRound?: number | null;
  }): RoutingTraceSummaryV1 {
    if (this.summary) return this.summary;
    const elapsedMs = Math.max(0, Date.now() - this.startedAt);
    this.summary = {
      outcome: context.outcome,
      statusCode: context.statusCode,
      durationMs: elapsedMs,
      ttfbMs: context.outcome === "success" ? elapsedMs : null,
      attemptsPerRequest: this.attempts,
      maxActiveAttempts: this.maxActive,
      rounds: this.maxRound,
      providerMs: this.providerMs,
      fallbackPromotions: this.fallbackPromotions,
      cancelFailures: this.cancelFailures,
      winnerOrigin: context.winnerOrigin ?? "none",
      winnerProviderId: context.winnerProviderId ?? null,
      winnerRound: context.winnerRound ?? null,
    };
    logger.debug("[DiscoveryMetric] Aggregate snapshot", {
      event: context.outcome === "success" ? "winner_committed" : "request_failed",
      ...this.identity,
      ...context,
      elapsedMs,
      ttfbMs: context.outcome === "success" ? elapsedMs : null,
      attemptsPerRequest: this.attempts,
      maxActiveAttempts: this.maxActive,
      rounds: this.maxRound,
      providerMs: this.providerMs,
      fallbackPromotions: this.fallbackPromotions,
      cancelFailures: this.cancelFailures,
    });
    return this.summary;
  }
}
