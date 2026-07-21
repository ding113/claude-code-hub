export const ROUTING_TRACE_VERSION = 1 as const;
export const ROUTING_TRACE_MAX_EVENTS = 512;

export type RoutingTraceMode = "discovery" | "legacy_hedge" | "legacy_serial" | "single_upstream";

export type RoutingTraceEventType =
  | "request_started"
  | "round_started"
  | "sticky_probe_started"
  | "sticky_timeout"
  | "attempt_started"
  | "attempt_ready"
  | "attempt_held"
  | "attempt_finished"
  | "fallback_promoted"
  | "winner_committed"
  | "binding_finalized"
  | "request_finished";

export type RoutingTraceAttemptKind = "sticky" | "normal" | "fallback";
export type RoutingTraceWinnerOrigin = "sticky" | "normal" | "fallback" | "none";
export type RoutingTraceRequestOutcome = "success" | "failed" | "client_abort" | "deadline";

export interface RoutingTraceConfigV1 {
  discoveryConcurrency: number;
  maxDiscoveryRounds: number;
  discoverySlaMs: number;
  stickySlaMs: number;
  racingTotalTimeoutMs: number;
  stickyTimeoutCooldownMs: number;
  /** The binding/session TTL in seconds; optional for traces written before this field existed. */
  sessionTtlSeconds?: number;
}

export interface RoutingTraceProviderV1 {
  id: number;
  name?: string;
  priority?: number;
}

/**
 * A sanitized routing lifecycle event. This intentionally excludes request
 * bodies, API keys, upstream URLs, and raw upstream error payloads.
 */
export interface RoutingTraceEventV1 {
  type: RoutingTraceEventType;
  at: number;
  elapsedMs: number;
  round?: number;
  attemptId?: string;
  attemptKind?: RoutingTraceAttemptKind;
  provider?: RoutingTraceProviderV1;
  outcome?: string;
  cancellationKind?: string;
  statusCode?: number;
  reason?: string;
  bindingAction?: "create" | "renew" | "clear" | "none";
  durationMs?: number;
}

export interface RoutingTraceSummaryV1 {
  outcome: RoutingTraceRequestOutcome;
  statusCode: number;
  durationMs: number;
  ttfbMs: number | null;
  attemptsPerRequest: number;
  maxActiveAttempts: number;
  rounds: number;
  providerMs: number;
  fallbackPromotions: number;
  cancelFailures: number;
  winnerOrigin: RoutingTraceWinnerOrigin;
  winnerProviderId: number | null;
  winnerRound: number | null;
}

export interface RoutingTraceV1 {
  version: typeof ROUTING_TRACE_VERSION;
  mode: RoutingTraceMode;
  startedAt: number;
  updatedAt: number;
  discoveryEnabled: boolean;
  eligible: boolean;
  bypassReason?: string;
  config?: RoutingTraceConfigV1;
  events: RoutingTraceEventV1[];
  summary?: RoutingTraceSummaryV1;
  truncated?: boolean;
}

const ROUTING_TRACE_MODES = new Set<RoutingTraceMode>([
  "discovery",
  "legacy_hedge",
  "legacy_serial",
  "single_upstream",
]);
const ROUTING_TRACE_EVENT_TYPES = new Set<RoutingTraceEventType>([
  "request_started",
  "round_started",
  "sticky_probe_started",
  "sticky_timeout",
  "attempt_started",
  "attempt_ready",
  "attempt_held",
  "attempt_finished",
  "fallback_promoted",
  "winner_committed",
  "binding_finalized",
  "request_finished",
]);

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeRoutingTraceEvent(value: unknown): RoutingTraceEventV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (
    !ROUTING_TRACE_EVENT_TYPES.has(event.type as RoutingTraceEventType) ||
    finiteNumber(event.at) === undefined ||
    finiteNumber(event.elapsedMs) === undefined
  ) {
    return null;
  }

  const attemptKinds = new Set<RoutingTraceAttemptKind>(["sticky", "normal", "fallback"]);
  const bindingActions = new Set<NonNullable<RoutingTraceEventV1["bindingAction"]>>([
    "create",
    "renew",
    "clear",
    "none",
  ]);
  const providerValue = event.provider;
  const provider =
    providerValue && typeof providerValue === "object" && !Array.isArray(providerValue)
      ? (providerValue as Record<string, unknown>)
      : null;
  const providerId = finiteNumber(provider?.id);

  return {
    type: event.type as RoutingTraceEventType,
    at: event.at as number,
    elapsedMs: event.elapsedMs as number,
    ...(finiteNumber(event.round) !== undefined ? { round: event.round as number } : {}),
    ...(nonEmptyString(event.attemptId) ? { attemptId: event.attemptId as string } : {}),
    ...(attemptKinds.has(event.attemptKind as RoutingTraceAttemptKind)
      ? { attemptKind: event.attemptKind as RoutingTraceAttemptKind }
      : {}),
    ...(providerId !== undefined
      ? {
          provider: {
            id: providerId,
            ...(nonEmptyString(provider?.name) ? { name: provider?.name as string } : {}),
            ...(finiteNumber(provider?.priority) !== undefined
              ? { priority: provider?.priority as number }
              : {}),
          },
        }
      : {}),
    ...(nonEmptyString(event.outcome) ? { outcome: event.outcome as string } : {}),
    ...(nonEmptyString(event.cancellationKind)
      ? { cancellationKind: event.cancellationKind as string }
      : {}),
    ...(finiteNumber(event.statusCode) !== undefined
      ? { statusCode: event.statusCode as number }
      : {}),
    ...(nonEmptyString(event.reason) ? { reason: event.reason as string } : {}),
    ...(bindingActions.has(event.bindingAction as NonNullable<RoutingTraceEventV1["bindingAction"]>)
      ? {
          bindingAction: event.bindingAction as NonNullable<RoutingTraceEventV1["bindingAction"]>,
        }
      : {}),
    ...(finiteNumber(event.durationMs) !== undefined
      ? { durationMs: event.durationMs as number }
      : {}),
  };
}

function normalizeRoutingTraceConfig(value: unknown): RoutingTraceConfigV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const config = value as Record<string, unknown>;
  const discoveryConcurrency = finiteNumber(config.discoveryConcurrency);
  const maxDiscoveryRounds = finiteNumber(config.maxDiscoveryRounds);
  const discoverySlaMs = finiteNumber(config.discoverySlaMs);
  const stickySlaMs = finiteNumber(config.stickySlaMs);
  const racingTotalTimeoutMs = finiteNumber(config.racingTotalTimeoutMs);
  const stickyTimeoutCooldownMs = finiteNumber(config.stickyTimeoutCooldownMs);
  if (
    discoveryConcurrency === undefined ||
    maxDiscoveryRounds === undefined ||
    discoverySlaMs === undefined ||
    stickySlaMs === undefined ||
    racingTotalTimeoutMs === undefined ||
    stickyTimeoutCooldownMs === undefined
  ) {
    return undefined;
  }
  return {
    discoveryConcurrency,
    maxDiscoveryRounds,
    discoverySlaMs,
    stickySlaMs,
    racingTotalTimeoutMs,
    stickyTimeoutCooldownMs,
    ...(finiteNumber(config.sessionTtlSeconds) !== undefined
      ? { sessionTtlSeconds: finiteNumber(config.sessionTtlSeconds) }
      : {}),
  };
}

function normalizeRoutingTraceSummary(value: unknown): RoutingTraceSummaryV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const summary = value as Record<string, unknown>;
  const outcomes = new Set<RoutingTraceRequestOutcome>([
    "success",
    "failed",
    "client_abort",
    "deadline",
  ]);
  const winnerOrigins = new Set<RoutingTraceWinnerOrigin>(["sticky", "normal", "fallback", "none"]);
  const numericKeys = [
    "statusCode",
    "durationMs",
    "attemptsPerRequest",
    "maxActiveAttempts",
    "rounds",
    "providerMs",
    "fallbackPromotions",
    "cancelFailures",
  ] as const;
  if (
    !outcomes.has(summary.outcome as RoutingTraceRequestOutcome) ||
    !winnerOrigins.has(summary.winnerOrigin as RoutingTraceWinnerOrigin) ||
    numericKeys.some((key) => finiteNumber(summary[key]) === undefined) ||
    !(summary.ttfbMs === null || finiteNumber(summary.ttfbMs) !== undefined) ||
    !(summary.winnerProviderId === null || finiteNumber(summary.winnerProviderId) !== undefined) ||
    !(summary.winnerRound === null || finiteNumber(summary.winnerRound) !== undefined)
  ) {
    return undefined;
  }
  return {
    outcome: summary.outcome as RoutingTraceRequestOutcome,
    statusCode: summary.statusCode as number,
    durationMs: summary.durationMs as number,
    ttfbMs: summary.ttfbMs as number | null,
    attemptsPerRequest: summary.attemptsPerRequest as number,
    maxActiveAttempts: summary.maxActiveAttempts as number,
    rounds: summary.rounds as number,
    providerMs: summary.providerMs as number,
    fallbackPromotions: summary.fallbackPromotions as number,
    cancelFailures: summary.cancelFailures as number,
    winnerOrigin: summary.winnerOrigin as RoutingTraceWinnerOrigin,
    winnerProviderId: summary.winnerProviderId as number | null,
    winnerRound: summary.winnerRound as number | null,
  };
}

/** Treat persisted JSON as untrusted so legacy or malformed rows remain readable. */
export function normalizeRoutingTrace(value: unknown): RoutingTraceV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const trace = value as Partial<RoutingTraceV1>;
  if (
    trace.version !== ROUTING_TRACE_VERSION ||
    !ROUTING_TRACE_MODES.has(trace.mode as RoutingTraceMode) ||
    typeof trace.startedAt !== "number" ||
    !Number.isFinite(trace.startedAt) ||
    typeof trace.updatedAt !== "number" ||
    !Number.isFinite(trace.updatedAt) ||
    typeof trace.discoveryEnabled !== "boolean" ||
    typeof trace.eligible !== "boolean" ||
    !Array.isArray(trace.events)
  ) {
    return null;
  }

  const events = trace.events
    .slice(0, ROUTING_TRACE_MAX_EVENTS)
    .map(normalizeRoutingTraceEvent)
    .filter((event): event is RoutingTraceEventV1 => event !== null);
  const config = normalizeRoutingTraceConfig(trace.config);
  const summary = normalizeRoutingTraceSummary(trace.summary);

  return {
    version: ROUTING_TRACE_VERSION,
    mode: trace.mode as RoutingTraceMode,
    startedAt: trace.startedAt,
    updatedAt: trace.updatedAt,
    discoveryEnabled: trace.discoveryEnabled,
    eligible: trace.eligible,
    ...(nonEmptyString(trace.bypassReason) ? { bypassReason: trace.bypassReason } : {}),
    ...(config ? { config } : {}),
    events,
    ...(summary ? { summary } : {}),
    ...(trace.truncated === true || trace.events.length > ROUTING_TRACE_MAX_EVENTS
      ? { truncated: true }
      : {}),
  };
}
