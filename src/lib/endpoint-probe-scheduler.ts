import "server-only";

import { recordEndpointFailure, recordEndpointSuccess } from "@/lib/endpoint-circuit-breaker";
import { logger } from "@/lib/logger";
import { executeProviderTest } from "@/lib/provider-testing/test-service";
import { findAllProvidersFresh } from "@/repository/provider";
import { findProviderEndpointsByVendorIds } from "@/repository/provider-endpoint";
import {
  createProviderEndpointProbeEvent,
  deleteProviderEndpointProbeEventsOlderThan,
} from "@/repository/provider-endpoint-probe-event";
import type { Provider, ProviderType } from "@/types/provider";

type ProbeTarget = {
  endpointId: number;
  vendorId: number;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
};

function parsePositiveInt(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const parsed = Number.parseInt(input, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const ENABLE_ENDPOINT_PROBING = process.env.ENABLE_ENDPOINT_PROBING === "true";
const ENDPOINT_PROBE_INTERVAL_MS = parsePositiveInt(
  process.env.ENDPOINT_PROBE_INTERVAL_MS,
  300_000
);
const ENDPOINT_PROBE_TIMEOUT_MS = parsePositiveInt(process.env.ENDPOINT_PROBE_TIMEOUT_MS, 5_000);
const ENDPOINT_PROBE_MAX_PER_CYCLE = parsePositiveInt(process.env.ENDPOINT_PROBE_MAX_PER_CYCLE, 20);
const ENDPOINT_PROBE_CONCURRENCY = parsePositiveInt(process.env.ENDPOINT_PROBE_CONCURRENCY, 5);
const ENDPOINT_PROBE_RETENTION_DAYS = parsePositiveInt(
  process.env.ENDPOINT_PROBE_RETENTION_DAYS,
  7
);
const ENDPOINT_PROBE_CLEANUP_INTERVAL_MS = parsePositiveInt(
  process.env.ENDPOINT_PROBE_CLEANUP_INTERVAL_MS,
  24 * 60 * 60 * 1000
);

const CONFIG_CACHE_TTL_MS = 60_000;

const schedulerState = globalThis as unknown as {
  __CCH_ENDPOINT_PROBE_INTERVAL_ID__?: ReturnType<typeof setInterval> | null;
  __CCH_ENDPOINT_PROBE_CLEANUP_INTERVAL_ID__?: ReturnType<typeof setInterval> | null;
  __CCH_ENDPOINT_PROBE_CURSOR__?: number;
};

let isProbing = false;
let targetsCache: { expiresAt: number; targets: ProbeTarget[] } | null = null;

function isValidBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function keyOf(vendorId: number, providerType: Provider["providerType"]): string {
  return `${vendorId}:${providerType}`;
}

function pickTargetsRoundRobin(targets: ProbeTarget[]): ProbeTarget[] {
  if (targets.length <= ENDPOINT_PROBE_MAX_PER_CYCLE) {
    return targets;
  }

  const cursor = schedulerState.__CCH_ENDPOINT_PROBE_CURSOR__ ?? 0;
  const sorted = [...targets].sort((a, b) => a.endpointId - b.endpointId);

  const picked: ProbeTarget[] = [];
  for (let i = 0; i < ENDPOINT_PROBE_MAX_PER_CYCLE; i++) {
    const index = (cursor + i) % sorted.length;
    picked.push(sorted[index]);
  }

  schedulerState.__CCH_ENDPOINT_PROBE_CURSOR__ = (cursor + picked.length) % sorted.length;
  return picked;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const pending = new Set<Promise<void>>();

  for (const item of items) {
    let taskPromise: Promise<void>;
    taskPromise = fn(item).finally(() => {
      pending.delete(taskPromise);
    });

    pending.add(taskPromise);

    if (pending.size >= concurrency) {
      await Promise.race(pending);
    }
  }

  await Promise.allSettled(pending);
}

async function loadTargetsCached(): Promise<ProbeTarget[]> {
  const now = Date.now();
  if (targetsCache && targetsCache.expiresAt > now) {
    return targetsCache.targets;
  }

  const providers = await findAllProvidersFresh();

  const enabledProviders = providers
    .filter((p) => p.isEnabled && Number.isFinite(p.vendorId ?? NaN) && !!p.key)
    .sort((a, b) => {
      const aPriority = a.priority ?? 0;
      const bPriority = b.priority ?? 0;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.id - b.id;
    });

  const vendorTypeKeyToApiKey = new Map<string, string>();
  const vendorIds: number[] = [];

  for (const p of enabledProviders) {
    if (!p.vendorId) continue;

    const key = keyOf(p.vendorId, p.providerType);
    if (!vendorTypeKeyToApiKey.has(key)) {
      vendorTypeKeyToApiKey.set(key, p.key);
    }

    vendorIds.push(p.vendorId);
  }

  const uniqueVendorIds = Array.from(new Set(vendorIds));
  if (uniqueVendorIds.length === 0) {
    targetsCache = { expiresAt: now + CONFIG_CACHE_TTL_MS, targets: [] };
    return [];
  }

  const endpoints = await findProviderEndpointsByVendorIds(uniqueVendorIds);

  const targets: ProbeTarget[] = [];

  for (const endpoint of endpoints) {
    if (!endpoint.isEnabled) continue;
    if (!isValidBaseUrl(endpoint.baseUrl)) continue;

    const apiKey = vendorTypeKeyToApiKey.get(keyOf(endpoint.vendorId, endpoint.providerType));
    if (!apiKey) {
      continue;
    }

    targets.push({
      endpointId: endpoint.id,
      vendorId: endpoint.vendorId,
      providerType: endpoint.providerType,
      baseUrl: endpoint.baseUrl,
      apiKey,
    });
  }

  targetsCache = { expiresAt: now + CONFIG_CACHE_TTL_MS, targets };
  return targets;
}

async function probeTarget(target: ProbeTarget): Promise<void> {
  const checkedAt = new Date();

  try {
    const result = await executeProviderTest({
      providerUrl: target.baseUrl,
      apiKey: target.apiKey,
      providerType: target.providerType,
      timeoutMs: ENDPOINT_PROBE_TIMEOUT_MS,
    });

    if (result.success) {
      recordEndpointSuccess(target.endpointId);

      await createProviderEndpointProbeEvent({
        endpointId: target.endpointId,
        source: "active_probe",
        result: "success",
        statusCode: result.httpStatusCode ?? null,
        latencyMs: result.latencyMs ?? null,
        checkedAt,
      });

      return;
    }

    const error = new Error(result.errorMessage ?? "Endpoint probe failed");
    if (result.errorType) {
      error.name = result.errorType;
    }

    recordEndpointFailure(target.endpointId, error);

    await createProviderEndpointProbeEvent({
      endpointId: target.endpointId,
      source: "active_probe",
      result: "fail",
      statusCode: result.httpStatusCode ?? null,
      latencyMs: result.latencyMs ?? null,
      errorType: result.errorType ?? null,
      errorMessage: result.errorMessage ?? null,
      checkedAt,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    recordEndpointFailure(target.endpointId, err);

    await createProviderEndpointProbeEvent({
      endpointId: target.endpointId,
      source: "active_probe",
      result: "fail",
      statusCode: null,
      latencyMs: null,
      errorType: err.name,
      errorMessage: err.message,
      checkedAt,
    });
  }
}

export async function runEndpointProbeCycleOnce(): Promise<void> {
  if (isProbing) {
    logger.debug("[EndpointProbe] Skipping cycle, previous cycle still running");
    return;
  }

  isProbing = true;

  try {
    const targets = await loadTargetsCached();
    if (targets.length === 0) {
      logger.debug("[EndpointProbe] No endpoints available for probing");
      return;
    }

    const selected = pickTargetsRoundRobin(targets);

    logger.info("[EndpointProbe] Starting probe cycle", {
      totalTargets: targets.length,
      selectedTargets: selected.length,
      timeoutMs: ENDPOINT_PROBE_TIMEOUT_MS,
      concurrency: ENDPOINT_PROBE_CONCURRENCY,
    });

    let succeeded = 0;
    let failed = 0;

    await runWithConcurrency(selected, ENDPOINT_PROBE_CONCURRENCY, async (target) => {
      try {
        await probeTarget(target);
        succeeded++;
      } catch {
        failed++;
      }
    });

    logger.info("[EndpointProbe] Probe cycle completed", {
      attempted: selected.length,
      succeeded,
      failed,
    });
  } catch (error) {
    logger.warn("[EndpointProbe] Probe cycle failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    isProbing = false;
  }
}

export async function cleanupEndpointProbeEventsOnce(): Promise<number> {
  try {
    const deleted = await deleteProviderEndpointProbeEventsOlderThan({
      days: ENDPOINT_PROBE_RETENTION_DAYS,
    });

    if (deleted > 0) {
      logger.info("[EndpointProbe] Old probe events cleaned", {
        deleted,
        retentionDays: ENDPOINT_PROBE_RETENTION_DAYS,
      });
    }

    return deleted;
  } catch (error) {
    logger.warn("[EndpointProbe] Failed to cleanup old probe events", {
      error: error instanceof Error ? error.message : String(error),
      retentionDays: ENDPOINT_PROBE_RETENTION_DAYS,
    });

    return 0;
  }
}

export function startEndpointProbeScheduler(): void {
  if (!ENABLE_ENDPOINT_PROBING) {
    logger.info("[EndpointProbe] Endpoint probing is disabled");
    return;
  }

  if (schedulerState.__CCH_ENDPOINT_PROBE_INTERVAL_ID__) {
    return;
  }

  void runEndpointProbeCycleOnce();
  void cleanupEndpointProbeEventsOnce();

  schedulerState.__CCH_ENDPOINT_PROBE_INTERVAL_ID__ = setInterval(() => {
    void runEndpointProbeCycleOnce();
  }, ENDPOINT_PROBE_INTERVAL_MS);

  schedulerState.__CCH_ENDPOINT_PROBE_CLEANUP_INTERVAL_ID__ = setInterval(() => {
    void cleanupEndpointProbeEventsOnce();
  }, ENDPOINT_PROBE_CLEANUP_INTERVAL_MS);

  logger.info("[EndpointProbe] Scheduler started", {
    intervalSeconds: Math.round(ENDPOINT_PROBE_INTERVAL_MS / 1000),
    timeoutMs: ENDPOINT_PROBE_TIMEOUT_MS,
    maxPerCycle: ENDPOINT_PROBE_MAX_PER_CYCLE,
    retentionDays: ENDPOINT_PROBE_RETENTION_DAYS,
  });
}

export function stopEndpointProbeScheduler(): void {
  if (schedulerState.__CCH_ENDPOINT_PROBE_INTERVAL_ID__) {
    clearInterval(schedulerState.__CCH_ENDPOINT_PROBE_INTERVAL_ID__);
    schedulerState.__CCH_ENDPOINT_PROBE_INTERVAL_ID__ = null;
  }

  if (schedulerState.__CCH_ENDPOINT_PROBE_CLEANUP_INTERVAL_ID__) {
    clearInterval(schedulerState.__CCH_ENDPOINT_PROBE_CLEANUP_INTERVAL_ID__);
    schedulerState.__CCH_ENDPOINT_PROBE_CLEANUP_INTERVAL_ID__ = null;
  }

  logger.info("[EndpointProbe] Scheduler stopped");
}

export function isEndpointProbingEnabled(): boolean {
  return ENABLE_ENDPOINT_PROBING;
}

export function getEndpointProbeSchedulerStatus(): {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  timeoutMs: number;
  maxPerCycle: number;
  concurrency: number;
  retentionDays: number;
} {
  return {
    enabled: ENABLE_ENDPOINT_PROBING,
    running: !!schedulerState.__CCH_ENDPOINT_PROBE_INTERVAL_ID__,
    intervalMs: ENDPOINT_PROBE_INTERVAL_MS,
    timeoutMs: ENDPOINT_PROBE_TIMEOUT_MS,
    maxPerCycle: ENDPOINT_PROBE_MAX_PER_CYCLE,
    concurrency: ENDPOINT_PROBE_CONCURRENCY,
    retentionDays: ENDPOINT_PROBE_RETENTION_DAYS,
  };
}
