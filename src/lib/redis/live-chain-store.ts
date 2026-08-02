import "server-only";

import type { ProviderChainItem } from "@/types/message";
import { normalizeRoutingTrace, type RoutingTraceV1 } from "@/types/routing-trace";
import { RedisKVStore } from "./redis-kv-store";

export interface LiveProviderSnapshot {
  id: number;
  name: string;
}

export interface LiveChainSnapshot {
  chain: ProviderChainItem[];
  phase: string;
  updatedAt: number;
  activeProviders?: LiveProviderSnapshot[];
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
    switch (terminalEvent.outcome ?? trace.summary?.outcome) {
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

function deriveDiscoveryActiveProviders(trace: RoutingTraceV1): LiveProviderSnapshot[] | undefined {
  const activeAttempts = new Map<string, LiveProviderSnapshot>();
  let sawAttemptLifecycle = false;

  for (const event of trace.events) {
    if (event.type === "attempt_started" && event.attemptId && event.provider) {
      sawAttemptLifecycle = true;
      activeAttempts.set(event.attemptId, {
        id: event.provider.id,
        name: event.provider.name ?? String(event.provider.id),
      });
      continue;
    }

    if (event.type === "attempt_finished" && event.attemptId) {
      sawAttemptLifecycle = true;
      activeAttempts.delete(event.attemptId);
      continue;
    }

    if (event.type === "winner_committed" && event.attemptId && event.provider) {
      sawAttemptLifecycle = true;
      activeAttempts.clear();
      activeAttempts.set(event.attemptId, {
        id: event.provider.id,
        name: event.provider.name ?? String(event.provider.id),
      });
      continue;
    }

    if (event.type === "request_finished") {
      sawAttemptLifecycle = true;
      activeAttempts.clear();
    }
  }

  if (!sawAttemptLifecycle) return undefined;
  return [
    ...new Map([...activeAttempts.values()].map((provider) => [provider.id, provider])).values(),
  ];
}

function deriveLegacyActiveProviders(chain: ProviderChainItem[]): LiveProviderSnapshot[] {
  const activeProviders = new Map<number, LiveProviderSnapshot>();

  for (const item of chain) {
    const provider = { id: item.id, name: item.name };
    switch (item.reason) {
      case "initial_selection":
      case "session_reuse":
      case "affinity_hit":
      case "hedge_launched":
        activeProviders.set(item.id, provider);
        break;
      case "hedge_winner":
      case "request_success":
      case "retry_success":
        activeProviders.clear();
        activeProviders.set(item.id, provider);
        break;
      case "retry_failed":
      case "system_error":
      case "resource_not_found":
      case "hedge_loser_cancelled":
      case "hedge_loser_billed":
      case "client_abort":
        activeProviders.delete(item.id);
        break;
    }
  }

  return [...activeProviders.values()];
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
  const activeProviders =
    routingTrace?.mode === "discovery" ? deriveDiscoveryActiveProviders(routingTrace) : undefined;

  // Trace recording starts before provider selection can append to the legacy
  // chain. Keep that earliest Discovery state visible instead of waiting for a
  // second Redis write.
  if (!snapshot) {
    if (!routingTrace) return null;
    return {
      chain: [],
      phase: inferPhase([], routingTrace),
      updatedAt: routingTrace.updatedAt,
      ...(activeProviders ? { activeProviders } : {}),
      routingTrace,
    };
  }

  return {
    ...snapshot,
    phase: inferPhase(snapshot.chain, routingTrace),
    ...(activeProviders ? { activeProviders } : {}),
    routingTrace,
  };
}

export async function writeLiveChain(
  sessionId: string,
  requestSequence: number,
  chain: ProviderChainItem[],
  activeProviders: LiveProviderSnapshot[] = deriveLegacyActiveProviders(chain)
): Promise<void> {
  const snapshot: LiveChainSnapshot = {
    chain,
    phase: inferPhase(chain),
    updatedAt: Date.now(),
    activeProviders,
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
