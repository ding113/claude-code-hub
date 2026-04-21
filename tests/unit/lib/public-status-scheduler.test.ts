import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshPublicStatusSnapshotMock = vi.fn();
const acquireLeaderLockMock = vi.fn();
const clearPublicStatusSnapshotMock = vi.fn();
const findAllProviderGroupsMock = vi.fn();
const releaseLeaderLockMock = vi.fn();
const renewLeaderLockMock = vi.fn();
const startLeaderLockKeepAliveMock = vi.fn();
const getRedisClientMock = vi.fn();

vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/public-status/service", () => ({
  refreshPublicStatusSnapshot: (...args: unknown[]) => refreshPublicStatusSnapshotMock(...args),
}));

vi.mock("@/lib/provider-endpoints/leader-lock", () => ({
  acquireLeaderLock: (...args: unknown[]) => acquireLeaderLockMock(...args),
  releaseLeaderLock: (...args: unknown[]) => releaseLeaderLockMock(...args),
  renewLeaderLock: (...args: unknown[]) => renewLeaderLockMock(...args),
  startLeaderLockKeepAlive: (...args: unknown[]) => startLeaderLockKeepAliveMock(...args),
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: (...args: unknown[]) => getRedisClientMock(...args),
}));

vi.mock("@/repository/provider-groups", () => ({
  findAllProviderGroups: (...args: unknown[]) => findAllProviderGroupsMock(...args),
}));

vi.mock("@/repository/public-status-snapshot", () => ({
  clearPublicStatusSnapshot: (...args: unknown[]) => clearPublicStatusSnapshotMock(...args),
}));

import {
  getPublicStatusSchedulerStatus,
  initializePublicStatusScheduler,
  startPublicStatusScheduler,
  stopPublicStatusScheduler,
} from "@/lib/public-status/scheduler";

describe("public status scheduler", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    getRedisClientMock.mockReturnValue({ status: "ready" });
    acquireLeaderLockMock.mockResolvedValue({ key: "lock-key", token: "lock-token" });
    clearPublicStatusSnapshotMock.mockResolvedValue(undefined);
    findAllProviderGroupsMock.mockResolvedValue([]);
    releaseLeaderLockMock.mockResolvedValue(undefined);
    renewLeaderLockMock.mockResolvedValue(true);
    startLeaderLockKeepAliveMock.mockReturnValue({ stop: vi.fn() });

    await stopPublicStatusScheduler();
  });

  afterEach(async () => {
    await stopPublicStatusScheduler();
    vi.useRealTimers();
  });

  it("stops the local interval when refresh reports that public status is disabled", async () => {
    refreshPublicStatusSnapshotMock.mockResolvedValue({
      status: "disabled",
      reason: "no-configured-targets",
    });

    startPublicStatusScheduler();

    for (let index = 0; index < 10; index++) {
      await Promise.resolve();
      if (!getPublicStatusSchedulerStatus().started) {
        break;
      }
    }

    expect(refreshPublicStatusSnapshotMock).toHaveBeenCalledTimes(1);
    expect(getPublicStatusSchedulerStatus().started).toBe(false);
    expect(releaseLeaderLockMock).toHaveBeenCalled();
  });

  it("clears stale snapshots during initialization when no public groups are enabled", async () => {
    findAllProviderGroupsMock.mockResolvedValue([{ id: 1, name: "alpha", description: null }]);

    await initializePublicStatusScheduler();

    expect(clearPublicStatusSnapshotMock).toHaveBeenCalledTimes(1);
    expect(getPublicStatusSchedulerStatus().started).toBe(false);
  });
});
