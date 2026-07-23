import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveChainSnapshot } from "./live-chain-store";
import type { RoutingTraceV1 } from "@/types/routing-trace";

interface FakeStore {
  data: Map<string, unknown>;
  deleted: string[];
}

const stores = vi.hoisted(() => new Map<string, FakeStore>());

vi.mock("./redis-kv-store", () => ({
  RedisKVStore: class<T> {
    private readonly backend: FakeStore;

    constructor({ prefix }: { prefix: string }) {
      const existing = stores.get(prefix);
      this.backend = existing ?? {
        data: new Map<string, unknown>(),
        deleted: [],
      };
      stores.set(prefix, this.backend);
    }

    async set(key: string, value: T): Promise<boolean> {
      this.backend.data.set(key, value);
      return true;
    }

    async get(key: string): Promise<T | null> {
      return (this.backend.data.get(key) as T | undefined) ?? null;
    }

    async delete(key: string): Promise<boolean> {
      this.backend.deleted.push(key);
      return this.backend.data.delete(key);
    }
  },
}));

import {
  deleteLiveChain,
  readLiveChain,
  readLiveChainBatch,
  writeLiveChain,
  writeLiveRoutingTrace,
} from "./live-chain-store";

const CHAIN_PREFIX = "cch:live-chain:";
const TRACE_PREFIX = "cch:live-routing-trace:";

function makeTrace(overrides: Partial<RoutingTraceV1> = {}): RoutingTraceV1 {
  return {
    version: 1,
    mode: "discovery",
    startedAt: 100,
    updatedAt: 200,
    discoveryEnabled: true,
    eligible: true,
    events: [
      {
        type: "round_started",
        at: 100,
        elapsedMs: 0,
        round: 1,
      },
    ],
    ...overrides,
  };
}

function getStore(prefix: string): FakeStore {
  const store = stores.get(prefix);
  if (!store) throw new Error(`Missing fake store for ${prefix}`);
  return store;
}

describe("live-chain routing trace storage", () => {
  beforeEach(() => {
    for (const store of stores.values()) {
      store.data.clear();
      store.deleted.length = 0;
    }
  });

  it("stores routing trace separately and derives the live Discovery phase", async () => {
    const trace = makeTrace();
    await writeLiveChain("session-a", 1, [
      {
        id: 1,
        name: "provider-a",
        reason: "initial_selection",
        timestamp: 100,
      },
    ]);
    await writeLiveRoutingTrace("session-a", 1, trace);

    expect(getStore(CHAIN_PREFIX).data.get("session-a:1")).not.toHaveProperty("routingTrace");
    await expect(readLiveChain("session-a", 1)).resolves.toMatchObject({
      phase: "discovery_racing",
      routingTrace: trace,
    });
  });

  it("returns an early trace before the provider chain snapshot exists", async () => {
    const trace = makeTrace({
      updatedAt: 150,
      events: [{ type: "sticky_probe_started", at: 150, elapsedMs: 0 }],
    });
    await writeLiveRoutingTrace("early", 1, trace);

    await expect(readLiveChain("early", 1)).resolves.toEqual({
      chain: [],
      phase: "discovery_sticky",
      updatedAt: 150,
      routingTrace: trace,
    });
  });

  it("does not erase a concurrent trace when the legacy chain is updated", async () => {
    const trace = makeTrace({
      events: [{ type: "fallback_promoted", at: 200, elapsedMs: 100, round: 1 }],
    });
    await writeLiveRoutingTrace("session-a", 2, trace);
    await writeLiveChain("session-a", 2, [
      { id: 2, name: "provider-b", reason: "retry_failed", timestamp: 200 },
    ]);

    await expect(readLiveChain("session-a", 2)).resolves.toMatchObject({
      phase: "discovery_fallback",
      routingTrace: trace,
    });
  });

  it("keeps old snapshots readable when no routing trace exists", async () => {
    const snapshot: LiveChainSnapshot = {
      chain: [{ id: 1, name: "provider-a", reason: "retry_failed", timestamp: 100 }],
      phase: "retrying",
      updatedAt: 100,
    };
    getStore(CHAIN_PREFIX).data.set("legacy:1", snapshot);

    await expect(readLiveChain("legacy", 1)).resolves.toEqual({
      ...snapshot,
      routingTrace: null,
    });
  });

  it("accepts an embedded trace written during a rolling upgrade", async () => {
    const trace = makeTrace({
      events: [{ type: "winner_committed", at: 200, elapsedMs: 100 }],
    });
    getStore(CHAIN_PREFIX).data.set("rolling:1", {
      chain: [],
      phase: "queued",
      updatedAt: 100,
      routingTrace: trace,
    } satisfies LiveChainSnapshot);

    await expect(readLiveChain("rolling", 1)).resolves.toMatchObject({
      phase: "streaming",
      routingTrace: trace,
    });
  });

  it("ignores a malformed independently stored trace", async () => {
    getStore(CHAIN_PREFIX).data.set("malformed:1", {
      chain: [],
      phase: "queued",
      updatedAt: 100,
    } satisfies LiveChainSnapshot);
    getStore(TRACE_PREFIX).data.set("malformed:1", {
      version: 999,
      events: [],
    });

    await expect(readLiveChain("malformed", 1)).resolves.toMatchObject({
      phase: "queued",
      routingTrace: null,
    });
  });

  it("merges routing traces for batch reads", async () => {
    await writeLiveChain("batch", 1, []);
    await writeLiveChain("batch", 2, []);
    await writeLiveRoutingTrace(
      "batch",
      2,
      makeTrace({
        events: [{ type: "sticky_probe_started", at: 100, elapsedMs: 0 }],
      })
    );

    const result = await readLiveChainBatch([
      { sessionId: "batch", requestSequence: 1 },
      { sessionId: "batch", requestSequence: 2 },
      { sessionId: "missing", requestSequence: 3 },
    ]);

    expect(result.size).toBe(2);
    expect(result.get("batch:1")).toMatchObject({
      phase: "queued",
      routingTrace: null,
    });
    expect(result.get("batch:2")).toMatchObject({ phase: "discovery_sticky" });
  });

  it("deletes both live keys", async () => {
    await writeLiveChain("session-a", 3, []);
    await writeLiveRoutingTrace("session-a", 3, makeTrace());

    await deleteLiveChain("session-a", 3);

    expect(getStore(CHAIN_PREFIX).data.has("session-a:3")).toBe(false);
    expect(getStore(TRACE_PREFIX).data.has("session-a:3")).toBe(false);
    expect(getStore(CHAIN_PREFIX).deleted).toContain("session-a:3");
    expect(getStore(TRACE_PREFIX).deleted).toContain("session-a:3");
  });
});
