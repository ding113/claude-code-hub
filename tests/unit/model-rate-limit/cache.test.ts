import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const publishMock = vi.fn(async () => {});
vi.mock("@/lib/redis/pubsub", () => ({
  subscribeCacheInvalidation: vi.fn(async () => () => {}),
  publishCacheInvalidation: (...args: unknown[]) => publishMock(...(args as [])),
}));
vi.mock("@/drizzle/db", () => ({ db: {} }));

import {
  configureModelLimitSnapshotFetcher,
  getModelLimitSnapshot,
  publishModelLimitCacheInvalidation,
  resetModelLimitCache,
} from "@/lib/model-rate-limit/cache";
import type { ModelLimitSnapshot } from "@/lib/model-rate-limit/types";

// Distinguish snapshots by a marker entry in modelToGroupId.
function snapshot(marker: string): ModelLimitSnapshot {
  return {
    modelToGroupId: new Map([[marker, 1]]),
    groupMembers: new Map(),
    limits: new Map(),
    userGroupIdsByTag: new Map(),
    boostGrantsByUser: new Map(),
  };
}

function markerOf(s: ModelLimitSnapshot): string {
  return [...s.modelToGroupId.keys()][0];
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  resetModelLimitCache();
  publishMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("model-limit snapshot cache (OPT-C SWR)", () => {
  it("T-SC-3: cold start awaits the first build", async () => {
    const fetcherMock = vi.fn(async () => snapshot("A"));
    configureModelLimitSnapshotFetcher(fetcherMock);

    const s1 = await getModelLimitSnapshot();
    expect(markerOf(s1)).toBe("A");
    expect(fetcherMock).toHaveBeenCalledTimes(1);
  });

  it("T-SC-1: warm read within TTL returns cached data without re-fetching", async () => {
    const fetcherMock = vi.fn(async () => snapshot("A"));
    configureModelLimitSnapshotFetcher(fetcherMock);

    await getModelLimitSnapshot();
    vi.setSystemTime(10_000); // still within 30s TTL
    const s2 = await getModelLimitSnapshot();

    expect(markerOf(s2)).toBe("A");
    expect(fetcherMock).toHaveBeenCalledTimes(1);
  });

  it("T-SC-2: stale read serves old snapshot and refreshes in the background", async () => {
    const fetcherMock = vi
      .fn<[], Promise<ModelLimitSnapshot>>()
      .mockResolvedValueOnce(snapshot("A"))
      .mockResolvedValue(snapshot("B"));
    configureModelLimitSnapshotFetcher(fetcherMock);

    await getModelLimitSnapshot(); // cold -> A, expires at 30_000
    vi.setSystemTime(31_000); // past TTL -> stale

    const stale = await getModelLimitSnapshot(); // serves old A immediately
    expect(markerOf(stale)).toBe("A");

    await flush(); // background refresh lands B

    const fresh = await getModelLimitSnapshot();
    expect(markerOf(fresh)).toBe("B");
    expect(fetcherMock).toHaveBeenCalledTimes(2);
  });

  it("T-SC-5: concurrent cold reads share a single refresh", async () => {
    const fetcherMock = vi.fn(async () => snapshot("A"));
    configureModelLimitSnapshotFetcher(fetcherMock);

    const [a, b] = await Promise.all([getModelLimitSnapshot(), getModelLimitSnapshot()]);

    expect(markerOf(a)).toBe("A");
    expect(markerOf(b)).toBe("A");
    expect(fetcherMock).toHaveBeenCalledTimes(1);
  });

  it("T-SC-6: write path rebuilds locally (read-your-writes) then broadcasts", async () => {
    const fetcherMock = vi
      .fn<[], Promise<ModelLimitSnapshot>>()
      .mockResolvedValueOnce(snapshot("A"))
      .mockResolvedValue(snapshot("B"));
    configureModelLimitSnapshotFetcher(fetcherMock);

    await getModelLimitSnapshot(); // A cached

    await publishModelLimitCacheInvalidation(); // mark stale + await rebuild -> B + broadcast

    const afterWrite = await getModelLimitSnapshot();
    expect(markerOf(afterWrite)).toBe("B"); // writing pod is immediately fresh
    expect(publishMock).toHaveBeenCalledTimes(1);
  });
});
