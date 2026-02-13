"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { getProviderEndpointProbeLogs } from "@/actions/provider-endpoints";
import { useInViewOnce } from "@/lib/hooks/use-in-view-once";
import { cn } from "@/lib/utils";

type SparkPoint = {
  index: number;
  latencyMs: number | null;
  ok: boolean;
  timestamp?: number;
};

type ProbeLog = {
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

function formatLatency(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: SparkPoint }>;
}) {
  if (!active || !payload?.[0]) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md bg-popover/95 backdrop-blur-sm border border-border px-2 py-1 shadow-md">
      <div className="flex items-center gap-2 text-xs">
        <span className={cn("h-2 w-2 rounded-full", point.ok ? "bg-emerald-500" : "bg-red-500")} />
        <span className="font-mono font-medium">{formatLatency(point.latencyMs)}</span>
      </div>
    </div>
  );
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
  if (batchProbeLogsEndpointDisabledAt === null) return true;
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
  let stopBatching = false;

  for (const chunk of chunks) {
    if (stopBatching) {
      didAnyChunkFail = true;
      for (const endpointId of chunk) fallbackEndpointIds.add(endpointId);
      continue;
    }

    try {
      const res = await fetch("/api/actions/providers/batchGetProviderEndpointProbeLogs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ endpointIds: chunk, limit }),
      });

      if (res.status === 404) {
        isBatchProbeLogsEndpointAvailable = false;
        batchProbeLogsEndpointDisabledAt = Date.now();
        didAnyChunkFail = true;
        stopBatching = true;
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

  if (!didAnyChunkSucceed) return null;

  if (!didAnyChunkFail) {
    isBatchProbeLogsEndpointAvailable = true;
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

  // 注意：idx 的读取/自增发生在 await 之前的同步代码段，依赖 JS 单线程语义，因此是安全的。
  const workers = Array.from({ length: Math.min(concurrency, endpointIds.length) }, async () => {
    for (;;) {
      const current = endpointIds[idx];
      idx += 1;
      if (current == null) return;

      try {
        const res = await getProviderEndpointProbeLogs({
          endpointId: current,
          limit,
        });
        map[current] = res.ok && res.data ? normalizeProbeLogs(res.data.logs) : [];
      } catch {
        map[current] = [];
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

class ProbeLogsBatcher {
  private readonly pendingByLimit = new Map<number, Map<number, BatchRequest[]>>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  load(endpointId: number, limit: number): Promise<ProbeLog[]> {
    return new Promise((resolve, reject) => {
      const group = this.pendingByLimit.get(limit) ?? new Map<number, BatchRequest[]>();
      const list = group.get(endpointId) ?? [];
      list.push({ endpointId, resolve, reject });
      group.set(endpointId, list);
      this.pendingByLimit.set(limit, group);

      if (this.flushTimer) return;
      const delayMs = process.env.NODE_ENV === "test" ? 0 : 10;
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush().catch(() => {});
      }, delayMs);
    });
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

const probeLogsBatcher = new ProbeLogsBatcher();

export function EndpointLatencySparkline(props: { endpointId: number; limit?: number }) {
  const limit = props.limit ?? 12;
  const { ref, isInView } = useInViewOnce<HTMLDivElement>();

  const { data: points = [] } = useQuery({
    queryKey: ["endpoint-probe-logs", props.endpointId, limit],
    queryFn: async (): Promise<SparkPoint[]> => {
      const logs = await probeLogsBatcher.load(props.endpointId, limit);

      return logs
        .slice()
        .reverse()
        .map((log, idx) => {
          const rawTimestamp =
            log.createdAt === undefined || log.createdAt === null
              ? undefined
              : new Date(log.createdAt).getTime();

          return {
            index: idx,
            latencyMs: log.latencyMs ?? null,
            ok: log.ok,
            timestamp:
              rawTimestamp !== undefined && Number.isFinite(rawTimestamp)
                ? rawTimestamp
                : undefined,
          };
        });
    },
    staleTime: 30_000,
    enabled: isInView,
  });

  const avgLatency = useMemo(() => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const recentPoints = points.filter(
      (p) => p.latencyMs !== null && p.timestamp && p.timestamp >= fiveMinutesAgo
    );
    if (recentPoints.length === 0) return null;
    const sum = recentPoints.reduce((acc, p) => acc + (p.latencyMs ?? 0), 0);
    return sum / recentPoints.length;
  }, [points]);

  if (points.length === 0) {
    return (
      <div ref={ref} className="flex items-center gap-2">
        <div className="h-6 w-32 rounded bg-muted/20" />
      </div>
    );
  }

  const lastPoint = points[points.length - 1];
  const stroke = lastPoint?.ok ? "#16a34a" : "#dc2626";

  return (
    <div ref={ref} className="flex items-center gap-2">
      <div className="h-6 w-32">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
            <YAxis hide domain={[0, "dataMax + 50"]} />
            <Tooltip content={<CustomTooltip />} cursor={false} isAnimationActive={false} />
            <Line
              type="monotone"
              dataKey="latencyMs"
              stroke={stroke}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0, fill: stroke }}
              isAnimationActive={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {avgLatency !== null && (
        <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
          {formatLatency(avgLatency)}
        </span>
      )}
    </div>
  );
}
