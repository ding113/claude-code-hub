import "server-only";

import type { ProviderChainItem } from "@/types/message";
import { RedisKVStore } from "./redis-kv-store";

export interface LiveChainSnapshot {
  chain: ProviderChainItem[];
  phase: string;
  updatedAt: number;
}

const SESSION_TTL = Number.parseInt(process.env.SESSION_TTL || "300", 10);

const store = new RedisKVStore<LiveChainSnapshot>({
  prefix: "cch:live-chain:",
  defaultTtlSeconds: SESSION_TTL,
});

function buildKey(sessionId: string, requestSequence: number): string {
  return `${sessionId}:${requestSequence}`;
}

export function inferPhase(chain: ProviderChainItem[]): string {
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

export async function readLiveChain(
  sessionId: string,
  requestSequence: number
): Promise<LiveChainSnapshot | null> {
  return store.get(buildKey(sessionId, requestSequence));
}

export async function readLiveChainBatch(
  keys: Array<{ sessionId: string; requestSequence: number }>
): Promise<Map<string, LiveChainSnapshot>> {
  const results = new Map<string, LiveChainSnapshot>();
  if (keys.length === 0) return results;

  const entries = await Promise.all(
    keys.map(async (k) => {
      const snapshot = await store.get(buildKey(k.sessionId, k.requestSequence));
      return { key: buildKey(k.sessionId, k.requestSequence), snapshot };
    })
  );

  for (const { key, snapshot } of entries) {
    if (snapshot) results.set(key, snapshot);
  }
  return results;
}

export async function deleteLiveChain(sessionId: string, requestSequence: number): Promise<void> {
  await store.delete(buildKey(sessionId, requestSequence));
}
