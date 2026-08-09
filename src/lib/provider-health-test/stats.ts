import { HEALTH_TEST_WINDOW_SIZE } from "./defaults";

/** One probe sample stored for sparkline tooltips (oldest → newest in DB field). */
export interface ProviderHealthTestSample {
  ok: boolean;
  firstByteMs: number | null;
  latencyMs: number | null;
  status: string | null;
  model: string | null;
  source: string | null;
  errorType: string | null;
  errorMessage: string | null;
  httpStatusCode: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  costUsd: number | null;
  /** ISO-8601 timestamp */
  testedAt: string;
}

export interface HealthTestLogLike {
  ok: boolean;
  firstByteMs: number | null | undefined;
  latencyMs?: number | null;
  status?: string | null;
  model?: string | null;
  source?: string | null;
  errorType?: string | null;
  errorMessage?: string | null;
  httpStatusCode?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  costUsd?: number | string | null;
  createdAt?: Date | string | null;
}

export interface HealthTestStats {
  onlineRate: number | null;
  avgFirstByteMs: number | null;
  /** Oldest → newest, rich samples for UI tooltips. */
  recentResults: ProviderHealthTestSample[];
}

/** Denormalized rolling SLO metrics for one configured test model. */
export interface ProviderHealthTestModelStats {
  onlineRate: number | null;
  avgFirstByteMs: number | null;
  /** Oldest → newest samples for this model only. */
  recentResults: ProviderHealthTestSample[];
}

export type ProviderHealthTestModelStatsMap = Record<string, ProviderHealthTestModelStats>;

function toIso(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function toFiniteInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function toHealthTestSample(log: HealthTestLogLike): ProviderHealthTestSample {
  return {
    ok: log.ok,
    firstByteMs: toFiniteInt(log.firstByteMs),
    latencyMs: toFiniteInt(log.latencyMs),
    status: log.status ?? null,
    model: log.model ?? null,
    source: log.source ?? null,
    errorType: log.ok ? null : (log.errorType ?? null),
    errorMessage: log.ok ? null : (log.errorMessage ?? null),
    httpStatusCode: toFiniteInt(log.httpStatusCode),
    inputTokens: toFiniteInt(log.inputTokens),
    outputTokens: toFiniteInt(log.outputTokens),
    cacheCreationInputTokens: toFiniteInt(log.cacheCreationInputTokens),
    cacheReadInputTokens: toFiniteInt(log.cacheReadInputTokens),
    costUsd: toFiniteNumber(log.costUsd),
    testedAt: toIso(log.createdAt),
  };
}

/**
 * Normalize DB jsonb which may be legacy boolean[] or rich samples.
 * Always returns oldest → newest samples.
 */
export function normalizeHealthTestRecentResults(
  raw: unknown
): ProviderHealthTestSample[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return Array.isArray(raw) ? [] : null;
  }

  // Legacy boolean[]
  if (typeof raw[0] === "boolean") {
    return (raw as boolean[]).map((ok) => ({
      ok,
      firstByteMs: null,
      latencyMs: null,
      status: ok ? "green" : "red",
      model: null,
      source: null,
      errorType: null,
      errorMessage: null,
      httpStatusCode: null,
      inputTokens: null,
      outputTokens: null,
      cacheCreationInputTokens: null,
      cacheReadInputTokens: null,
      costUsd: null,
      testedAt: new Date(0).toISOString(),
    }));
  }

  return (raw as ProviderHealthTestSample[]).map((item) => ({
    ok: Boolean(item?.ok),
    firstByteMs: toFiniteInt(item?.firstByteMs),
    latencyMs: toFiniteInt(item?.latencyMs),
    status: item?.status ?? null,
    model: item?.model ?? null,
    source: item?.source ?? null,
    errorType: item?.errorType ?? null,
    errorMessage: item?.errorMessage ?? null,
    httpStatusCode: toFiniteInt(item?.httpStatusCode),
    inputTokens: toFiniteInt(item?.inputTokens),
    outputTokens: toFiniteInt(item?.outputTokens),
    cacheCreationInputTokens: toFiniteInt(item?.cacheCreationInputTokens),
    cacheReadInputTokens: toFiniteInt(item?.cacheReadInputTokens),
    costUsd: toFiniteNumber(item?.costUsd),
    testedAt: typeof item?.testedAt === "string" ? item.testedAt : new Date(0).toISOString(),
  }));
}

/**
 * Average successful probe total wall time from a provider's current rolling
 * samples. This is the SLO/ranking metric; first-byte time is display-only.
 */
export function resolveHealthTestAvgLatencyMs(provider: {
  healthTestRecentResults?: unknown;
}): number | null {
  const samples = normalizeHealthTestRecentResults(provider.healthTestRecentResults) ?? [];
  const successfulLatencies = samples
    .filter(
      (sample) =>
        sample.ok && typeof sample.latencyMs === "number" && Number.isFinite(sample.latencyMs)
    )
    .map((sample) => sample.latencyMs as number);

  if (successfulLatencies.length === 0) return null;
  return Math.round(
    successfulLatencies.reduce((total, latency) => total + latency, 0) /
      successfulLatencies.length
  );
}

/** Normalize the per-model JSON snapshot stored on providers. */
export function normalizeHealthTestModelStats(
  raw: unknown
): ProviderHealthTestModelStatsMap | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: ProviderHealthTestModelStatsMap = {};
  for (const [model, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalizedModel = model.trim();
    if (!normalizedModel || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    const onlineRate = toFiniteNumber(item.onlineRate);
    const avgFirstByteMs = toFiniteInt(item.avgFirstByteMs);
    const recentResults = normalizeHealthTestRecentResults(item.recentResults) ?? [];
    if (!out[normalizedModel]) {
      out[normalizedModel] = { onlineRate, avgFirstByteMs, recentResults };
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Compute online rate / average first-byte / sparkline from newest-first logs.
 * Online rate = ok / window; avg first-byte uses successful samples only.
 * recentResults is oldest → newest.
 */
export function computeHealthTestStats(
  logsNewestFirst: HealthTestLogLike[],
  windowSize: number = HEALTH_TEST_WINDOW_SIZE
): HealthTestStats {
  const window = logsNewestFirst.slice(0, windowSize);
  if (window.length === 0) {
    return { onlineRate: null, avgFirstByteMs: null, recentResults: [] };
  }

  const okCount = window.reduce((acc, log) => acc + (log.ok ? 1 : 0), 0);
  const onlineRate = okCount / window.length;

  const successFirstBytes = window
    .filter((log) => log.ok && typeof log.firstByteMs === "number" && Number.isFinite(log.firstByteMs))
    .map((log) => log.firstByteMs as number);

  const avgFirstByteMs =
    successFirstBytes.length > 0
      ? Math.round(successFirstBytes.reduce((a, b) => a + b, 0) / successFirstBytes.length)
      : null;

  // oldest → newest for sparkline (PAST → NOW)
  const recentResults = window.map(toHealthTestSample).reverse();

  return { onlineRate, avgFirstByteMs, recentResults };
}

/**
 * Compute independent rolling SLO snapshots for each non-empty model key.
 * Input logs must be newest-first; each model keeps its own window.
 */
export function computeHealthTestModelStats(
  logsNewestFirst: HealthTestLogLike[],
  windowSize: number = HEALTH_TEST_WINDOW_SIZE
): ProviderHealthTestModelStatsMap {
  const logsByModel = new Map<string, HealthTestLogLike[]>();
  for (const log of logsNewestFirst) {
    const model = log.model?.trim();
    if (!model) continue;
    const bucket = logsByModel.get(model) ?? [];
    if (bucket.length < windowSize) {
      bucket.push({ ...log, model });
    }
    logsByModel.set(model, bucket);
  }

  const result: ProviderHealthTestModelStatsMap = {};
  for (const [model, logs] of logsByModel) {
    const stats = computeHealthTestStats(logs, windowSize);
    result[model] = {
      onlineRate: stats.onlineRate,
      avgFirstByteMs: stats.avgFirstByteMs,
      recentResults: stats.recentResults,
    };
  }
  return result;
}

export function formatOnlineRatePercent(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "-";
  return `${(rate * 100).toFixed(2)}%`;
}
