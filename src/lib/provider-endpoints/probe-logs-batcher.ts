import { getProviderEndpointProbeLogs } from "@/actions/provider-endpoints";
import { createAbortError } from "@/lib/abort-utils";

export type ProbeLog = {
  ok: boolean;
  latencyMs: number | null;
  createdAt?: string | number | Date | null;
};

function normalizeProbeLog(value: unknown): ProbeLog | null {
  if (!value || typeof value !== "object") return null;

  const rawOk = (value as { ok?: unknown }).ok;
  if (typeof rawOk !== "boolean") return null;

  const rawLatencyMs = (value as { latencyMs?: unknown }).latencyMs;
  const latencyMs =
    typeof rawLatencyMs === "number" && Number.isFinite(rawLatencyMs) ? rawLatencyMs : null;

  const rawCreatedAt = (value as { createdAt?: unknown }).createdAt;
  const createdAt =
    rawCreatedAt === undefined ||
    rawCreatedAt === null ||
    typeof rawCreatedAt === "string" ||
    typeof rawCreatedAt === "number" ||
    rawCreatedAt instanceof Date
      ? rawCreatedAt
      : undefined;

  return { ok: rawOk, latencyMs, createdAt };
}

function normalizeProbeLogs(value: unknown): ProbeLog[] {
  if (!Array.isArray(value)) return [];

  const logs: ProbeLog[] = [];
  for (const item of value) {
    const normalized = normalizeProbeLog(item);
    if (normalized) logs.push(normalized);
  }
  return logs;
}

function normalizeProbeLogsByEndpointId(data: unknown): Record<number, ProbeLog[]> | null {
  if (!data || typeof data !== "object") return null;

  if (Array.isArray(data)) {
    const map: Record<number, ProbeLog[]> = {};
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const endpointId = (item as { endpointId?: unknown }).endpointId;
      const logs = (item as { logs?: unknown }).logs;
      if (typeof endpointId !== "number" || !Array.isArray(logs)) continue;
      map[endpointId] = normalizeProbeLogs(logs);
    }
    return map;
  }

  const obj = data as Record<string, unknown>;

  const logsByEndpointId = obj.logsByEndpointId;
  if (logsByEndpointId && typeof logsByEndpointId === "object") {
    const raw = logsByEndpointId as Record<string, unknown>;
    const map: Record<number, ProbeLog[]> = {};
    for (const [k, v] of Object.entries(raw)) {
      const endpointId = Number.parseInt(k, 10);
      if (!Number.isFinite(endpointId) || !Array.isArray(v)) continue;
      map[endpointId] = normalizeProbeLogs(v);
    }
    return map;
  }

  const items = obj.items;
  if (Array.isArray(items)) {
    const map: Record<number, ProbeLog[]> = {};
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const endpointId = (item as { endpointId?: unknown }).endpointId;
      const logs = (item as { logs?: unknown }).logs;
      if (typeof endpointId !== "number" || !Array.isArray(logs)) continue;
      map[endpointId] = normalizeProbeLogs(logs);
    }
    return map;
  }

  return null;
}

let isBatchProbeLogsEndpointAvailable: boolean | undefined;
let batchProbeLogsEndpointDisabledAt: number | null = null;
const BATCH_PROBE_LOGS_RETRY_INTERVAL_MS = 5 * 60 * 1000;

function isBatchProbeLogsDisabled(): boolean {
  if (isBatchProbeLogsEndpointAvailable !== false) return false;
  if (batchProbeLogsEndpointDisabledAt === null) {
    isBatchProbeLogsEndpointAvailable = undefined;
    return false;
  }
  if (Date.now() - batchProbeLogsEndpointDisabledAt > BATCH_PROBE_LOGS_RETRY_INTERVAL_MS) {
    isBatchProbeLogsEndpointAvailable = undefined;
    batchProbeLogsEndpointDisabledAt = null;
    return false;
  }
  return true;
}

async function tryFetchBatchProbeLogsByEndpointIds(
  endpointIds: number[],
  limit: number
): Promise<Record<number, ProbeLog[]> | null> {
  if (endpointIds.length <= 1) return null;
  if (isBatchProbeLogsDisabled()) return null;
  if (process.env.NODE_ENV === "test") return null;

  const MAX_ENDPOINT_IDS_PER_BATCH = 500;
  const chunks: number[][] = [];
  for (let index = 0; index < endpointIds.length; index += MAX_ENDPOINT_IDS_PER_BATCH) {
    chunks.push(endpointIds.slice(index, index + MAX_ENDPOINT_IDS_PER_BATCH));
  }

  const merged: Record<number, ProbeLog[]> = {};
  const fallbackEndpointIds = new Set<number>();
  const missingFromSuccessfulChunks = new Set<number>();
  let didAnyChunkSucceed = false;
  let didAnyChunkFail = false;
  let didAnyChunk404 = false;

  for (const chunk of chunks) {
    try {
      const res = await fetch("/api/actions/providers/batchGetProviderEndpointProbeLogs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ endpointIds: chunk, limit }),
      });

      if (res.status === 404) {
        didAnyChunkFail = true;
        didAnyChunk404 = true;

        for (const endpointId of chunk) fallbackEndpointIds.add(endpointId);
        continue;
      }

      if (!res.ok) {
        didAnyChunkFail = true;
        for (const endpointId of chunk) fallbackEndpointIds.add(endpointId);
        continue;
      }

      const json = (await res.json()) as { ok?: unknown; data?: unknown };
      if (json.ok !== true) {
        didAnyChunkFail = true;
        for (const endpointId of chunk) fallbackEndpointIds.add(endpointId);
        continue;
      }

      const normalized = normalizeProbeLogsByEndpointId(json.data);
      if (!normalized) {
        didAnyChunkFail = true;
        for (const endpointId of chunk) fallbackEndpointIds.add(endpointId);
        continue;
      }

      didAnyChunkSucceed = true;

      const normalizedEndpointIds = new Set<number>();
      for (const [endpointId, logs] of Object.entries(normalized)) {
        const id = Number(endpointId);
        normalizedEndpointIds.add(id);
        merged[id] = logs;
      }

      for (const endpointId of chunk) {
        if (!normalizedEndpointIds.has(endpointId)) missingFromSuccessfulChunks.add(endpointId);
      }
    } catch {
      didAnyChunkFail = true;
      for (const endpointId of chunk) fallbackEndpointIds.add(endpointId);
    }
  }

  if (!didAnyChunkSucceed) {
    if (didAnyChunk404) {
      isBatchProbeLogsEndpointAvailable = false;
      batchProbeLogsEndpointDisabledAt = Date.now();
    }
    return null;
  }

  isBatchProbeLogsEndpointAvailable = true;
  batchProbeLogsEndpointDisabledAt = null;

  if (!didAnyChunkFail) {
    return merged;
  }

  const endpointIdsToFetchIndividually = new Set<number>();
  for (const endpointId of fallbackEndpointIds) {
    if (merged[endpointId] === undefined) endpointIdsToFetchIndividually.add(endpointId);
  }
  for (const endpointId of missingFromSuccessfulChunks) {
    if (merged[endpointId] === undefined) endpointIdsToFetchIndividually.add(endpointId);
  }

  if (endpointIdsToFetchIndividually.size === 0) return merged;

  const rest = await fetchProbeLogsByEndpointIdsIndividually(
    Array.from(endpointIdsToFetchIndividually),
    limit
  ).catch(() => null);

  if (rest) {
    for (const [endpointId, logs] of Object.entries(rest)) {
      merged[Number(endpointId)] = logs;
    }
  }

  return merged;
}

async function fetchProbeLogsByEndpointIdsIndividually(
  endpointIds: number[],
  limit: number
): Promise<Record<number, ProbeLog[]>> {
  const map: Record<number, ProbeLog[]> = {};
  const concurrency = 4;
  let idx = 0;

  const workers = Array.from({ length: Math.min(concurrency, endpointIds.length) }, async () => {
    for (;;) {
      const currentIndex = idx++;
      if (currentIndex >= endpointIds.length) return;
      const endpointId = endpointIds[currentIndex];

      try {
        const res = await getProviderEndpointProbeLogs({
          endpointId,
          limit,
        });
        map[endpointId] = res.ok && res.data ? normalizeProbeLogs(res.data.logs) : [];
      } catch {
        map[endpointId] = [];
      }
    }
  });

  await Promise.all(workers);
  return map;
}

async function fetchProbeLogsByEndpointIds(
  endpointIds: number[],
  limit: number
): Promise<Record<number, ProbeLog[]>> {
  const batched = await tryFetchBatchProbeLogsByEndpointIds(endpointIds, limit);
  if (batched) return batched;
  return fetchProbeLogsByEndpointIdsIndividually(endpointIds, limit);
}

type BatchRequest = {
  endpointId: number;
  resolve: (logs: ProbeLog[]) => void;
  reject: (error: unknown) => void;
};

export class ProbeLogsBatcher {
  private readonly pendingByLimit = new Map<number, Map<number, BatchRequest[]>>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  load(endpointId: number, limit: number, options?: { signal?: AbortSignal }): Promise<ProbeLog[]> {
    return new Promise((resolve, reject) => {
      const signal = options?.signal;
      if (signal?.aborted) {
        reject(createAbortError(signal));
        return;
      }

      let settled = false;
      let request: BatchRequest;

      const onAbort = () => {
        if (settled) return;
        settled = true;
        this.removePendingRequest(limit, endpointId, request);
        this.maybeCancelFlushTimer();
        reject(createAbortError(signal));
      };

      request = {
        endpointId,
        resolve: (logs) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          resolve(logs);
        },
        reject: (error) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const group = this.pendingByLimit.get(limit) ?? new Map<number, BatchRequest[]>();
      const list = group.get(endpointId) ?? [];
      list.push(request);
      group.set(endpointId, list);
      this.pendingByLimit.set(limit, group);

      if (this.flushTimer) return;
      const delayMs = process.env.NODE_ENV === "test" ? 0 : 10;
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush().catch((error) => {
          if (process.env.NODE_ENV !== "test") {
            console.error("[ProbeLogsBatcher] flush failed", error);
          }
        });
      }, delayMs);
    });
  }

  private maybeCancelFlushTimer() {
    if (!this.flushTimer) return;
    if (this.pendingByLimit.size > 0) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private removePendingRequest(limit: number, endpointId: number, request: BatchRequest) {
    const group = this.pendingByLimit.get(limit);
    if (!group) return;
    const list = group.get(endpointId);
    if (!list) return;

    const next = list.filter((item) => item !== request);
    if (next.length > 0) {
      group.set(endpointId, next);
      return;
    }

    group.delete(endpointId);
    if (group.size === 0) {
      this.pendingByLimit.delete(limit);
    }
  }

  private async flush() {
    const snapshot = new Map(this.pendingByLimit);
    this.pendingByLimit.clear();

    try {
      await Promise.all(
        Array.from(snapshot.entries(), async ([limit, group]) => {
          const endpointIds = Array.from(group.keys());
          if (endpointIds.length === 0) return;

          try {
            const map = await fetchProbeLogsByEndpointIds(endpointIds, limit);
            for (const [endpointId, requests] of group.entries()) {
              const logs = map[endpointId] ?? [];
              for (const req of requests) req.resolve(logs);
            }
          } catch (error) {
            for (const requests of group.values()) {
              for (const req of requests) req.reject(error);
            }
          }
        })
      );
    } catch (error) {
      for (const group of snapshot.values()) {
        for (const requests of group.values()) {
          for (const req of requests) req.reject(error);
        }
      }
    }
  }
}

export const probeLogsBatcher = new ProbeLogsBatcher();
