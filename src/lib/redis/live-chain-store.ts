import "server-only";

import type { ProviderChainItem } from "@/types/message";
import { normalizeRoutingTrace, type RoutingTraceV1 } from "@/types/routing-trace";
import { RedisKVStore } from "./redis-kv-store";

export interface LiveChainSnapshot {
  chain: ProviderChainItem[];
  phase: string;
  updatedAt: number;
  routingTrace?: RoutingTraceV1 | null;
}

const SESSION_TTL = Number.parseInt(process.env.SESSION_TTL || "300", 10);

const store = new RedisKVStore<LiveChainSnapshot>({
  prefix: "cch:live-chain:",
  defaultTtlSeconds: SESSION_TTL,
});

// Routing traces are updated independently from the provider chain. A separate
// key prevents a legacy chain writer from overwriting concurrent trace events.
const routingTraceStore = new RedisKVStore<RoutingTraceV1>({
  prefix: "cch:live-routing-trace:",
  defaultTtlSeconds: SESSION_TTL,
});

function buildKey(sessionId: string, requestSequence: number): string {
  return `${sessionId}:${requestSequence}`;
}

function inferDiscoveryPhase(trace: RoutingTraceV1): string {
  const terminalEvent = trace.events.findLast((event) => event.type === "request_finished");
  if (terminalEvent) {
    switch (trace.summary?.outcome ?? terminalEvent.outcome) {
      case "success":
        return "completed";
      case "client_abort":
        return "aborted";
      case "deadline":
        return "deadline";
      case "failed":
        return "failed";
    }
  }

  const last = trace.events[trace.events.length - 1];
  if (!last) return "discovery_racing";

  switch (last.type) {
    case "sticky_probe_started":
      return "discovery_sticky";
    case "fallback_promoted":
      return "discovery_fallback";
    case "winner_committed":
    case "binding_finalized":
      return "streaming";
    case "request_finished":
      switch (last.outcome) {
        case "success":
          return "completed";
        case "client_abort":
          return "aborted";
        case "deadline":
          return "deadline";
        default:
          return "failed";
      }
    case "round_started":
    case "sticky_timeout":
    case "attempt_started":
    case "attempt_ready":
    case "attempt_held":
    case "attempt_finished":
      return "discovery_racing";
  }

  return "discovery_racing";
}

export function inferPhase(
  chain: ProviderChainItem[],
  routingTrace?: RoutingTraceV1 | null
): string {
  if (routingTrace?.mode === "discovery") {
    return inferDiscoveryPhase(routingTrace);
  }

  if (chain.length === 0) return "queued";
  const last = chain[chain.length - 1];
  switch (last.reason) {
    case "initial_selection":
      return "provider_selected";
    case "session_reuse":
      return "session_reused";
    case "retry_failed":
    case "system_error":
    case "resource_not_found":
      return "retrying";
    case "hedge_triggered":
    case "hedge_launched":
      return "hedge_racing";
    case "hedge_winner":
    case "hedge_loser_cancelled":
    case "hedge_loser_billed":
      return "hedge_resolved";
    case "request_success":
    case "retry_success":
      return "streaming";
    case "client_abort":
      return "aborted";
    default:
      return "forwarding";
  }
}

function mergeSnapshot(
  snapshot: LiveChainSnapshot | null,
  storedRoutingTrace: unknown
): LiveChainSnapshot | null {
  // During rolling upgrades a trace may already be embedded in the old
  // snapshot shape. Prefer the independently updated trace when both exist.
  const routingTrace =
    normalizeRoutingTrace(storedRoutingTrace) ?? normalizeRoutingTrace(snapshot?.routingTrace);

  // Trace recording starts before provider selection can append to the legacy
  // chain. Keep that earliest Discovery state visible instead of waiting for a
  // second Redis write.
  if (!snapshot) {
    if (!routingTrace) return null;
    return {
      chain: [],
      phase: inferPhase([], routingTrace),
      updatedAt: routingTrace.updatedAt,
      routingTrace,
    };
  }

  return {
    ...snapshot,
    phase: inferPhase(snapshot.chain, routingTrace),
    routingTrace,
  };
}

export async function writeLiveChain(
  sessionId: string,
  requestSequence: number,
  chain: ProviderChainItem[]
): Promise<void> {
  const snapshot: LiveChainSnapshot = {
    chain,
    phase: inferPhase(chain),
    updatedAt: Date.now(),
  };
  await store.set(buildKey(sessionId, requestSequence), snapshot);
}

export async function writeLiveRoutingTrace(
  sessionId: string,
  requestSequence: number,
  routingTrace: RoutingTraceV1
): Promise<void> {
  await routingTraceStore.set(buildKey(sessionId, requestSequence), routingTrace);
}

export async function readLiveChain(
  sessionId: string,
  requestSequence: number
): Promise<LiveChainSnapshot | null> {
  const key = buildKey(sessionId, requestSequence);
  const [snapshot, routingTrace] = await Promise.all([store.get(key), routingTraceStore.get(key)]);
  return mergeSnapshot(snapshot, routingTrace);
}

export async function readLiveChainBatch(
  keys: Array<{ sessionId: string; requestSequence: number }>
): Promise<Map<string, LiveChainSnapshot>> {
  const results = new Map<string, LiveChainSnapshot>();
  if (keys.length === 0) return results;

  const entries = await Promise.all(
    keys.map(async (k) => {
      const key = buildKey(k.sessionId, k.requestSequence);
      const [snapshot, routingTrace] = await Promise.all([
        store.get(key),
        routingTraceStore.get(key),
      ]);
      return { key, snapshot: mergeSnapshot(snapshot, routingTrace) };
    })
  );

  for (const { key, snapshot } of entries) {
    if (snapshot) results.set(key, snapshot);
  }
  return results;
}

export async function deleteLiveChain(sessionId: string, requestSequence: number): Promise<void> {
  const key = buildKey(sessionId, requestSequence);
  await Promise.all([store.delete(key), routingTraceStore.delete(key)]);
}
