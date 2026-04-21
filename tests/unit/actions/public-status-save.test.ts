import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getSystemSettingsMock = vi.fn();
const updateSystemSettingsMock = vi.fn();
const findAllProviderGroupsMock = vi.fn();
const updateProviderGroupMock = vi.fn();
const revalidatePathMock = vi.fn();
const invalidateSystemSettingsCacheMock = vi.fn();
const refreshPublicStatusSnapshotMock = vi.fn();
const startPublicStatusSchedulerMock = vi.fn();
const stopPublicStatusSchedulerMock = vi.fn();
const clearPublicStatusSnapshotMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: () => getSessionMock(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/lib/config", () => ({
  invalidateSystemSettingsCache: () => invalidateSystemSettingsCacheMock(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: () => getSystemSettingsMock(),
  updateSystemSettings: (...args: unknown[]) => updateSystemSettingsMock(...args),
}));

vi.mock("@/repository/provider-groups", () => ({
  findAllProviderGroups: () => findAllProviderGroupsMock(),
  updateProviderGroup: (...args: unknown[]) => updateProviderGroupMock(...args),
}));

vi.mock("@/lib/public-status/service", () => ({
  refreshPublicStatusSnapshot: () => refreshPublicStatusSnapshotMock(),
}));

vi.mock("@/lib/public-status/scheduler", () => ({
  startPublicStatusScheduler: () => startPublicStatusSchedulerMock(),
  stopPublicStatusScheduler: () => stopPublicStatusSchedulerMock(),
}));

vi.mock("@/repository/public-status-snapshot", () => ({
  clearPublicStatusSnapshot: () => clearPublicStatusSnapshotMock(),
}));

import { savePublicStatusSettings } from "@/actions/public-status";

describe("savePublicStatusSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    getSystemSettingsMock.mockResolvedValue({
      id: 1,
      publicStatusWindowHours: 24,
      publicStatusAggregationIntervalMinutes: 5,
    });
    findAllProviderGroupsMock.mockResolvedValue([
      { id: 10, name: "alpha", description: null },
      {
        id: 11,
        name: "beta",
        description: '{"publicStatus":{"displayName":"Old Beta","modelIds":["o1"]}}',
      },
    ]);
    updateSystemSettingsMock.mockResolvedValue({
      id: 1,
      publicStatusWindowHours: 24,
      publicStatusAggregationIntervalMinutes: 5,
    });
    refreshPublicStatusSnapshotMock.mockResolvedValue({
      status: "updated",
      groupCount: 1,
      modelCount: 2,
    });
    startPublicStatusSchedulerMock.mockResolvedValue(undefined);
    stopPublicStatusSchedulerMock.mockResolvedValue(undefined);
    clearPublicStatusSnapshotMock.mockResolvedValue(undefined);
    updateProviderGroupMock.mockResolvedValue({});
  });

  it("requires admin session", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const result = await savePublicStatusSettings({
      publicStatusWindowHours: 24,
      publicStatusAggregationIntervalMinutes: 5,
      groups: [],
    });

    expect(result.ok).toBe(false);
    expect(updateSystemSettingsMock).not.toHaveBeenCalled();
    expect(updateProviderGroupMock).not.toHaveBeenCalled();
  });

  it("updates system settings and rewrites group descriptions from the status-page tab payload", async () => {
    const result = await savePublicStatusSettings({
      publicStatusWindowHours: 48,
      publicStatusAggregationIntervalMinutes: 10,
      groups: [
        {
          groupName: "alpha",
          displayName: "Alpha Public",
          modelIds: ["gpt-4.1", "o3"],
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(updateSystemSettingsMock).toHaveBeenCalledWith({
      publicStatusWindowHours: 48,
      publicStatusAggregationIntervalMinutes: 10,
    });
    expect(updateProviderGroupMock).toHaveBeenCalledTimes(2);
    expect(updateProviderGroupMock).toHaveBeenNthCalledWith(
      1,
      10,
      expect.objectContaining({
        description: expect.stringContaining('"displayName":"Alpha Public"'),
      })
    );
    expect(updateProviderGroupMock).toHaveBeenNthCalledWith(
      2,
      11,
      expect.objectContaining({
        description: null,
      })
    );
    expect(refreshPublicStatusSnapshotMock).toHaveBeenCalled();
    expect(startPublicStatusSchedulerMock).toHaveBeenCalled();
    expect(stopPublicStatusSchedulerMock).not.toHaveBeenCalled();
    expect(invalidateSystemSettingsCacheMock).toHaveBeenCalled();
    expect(revalidatePathMock).toHaveBeenCalled();
  });

  it("clears runtime scheduling when no public groups remain configured", async () => {
    const result = await savePublicStatusSettings({
      publicStatusWindowHours: 24,
      publicStatusAggregationIntervalMinutes: 5,
      groups: [],
    });

    expect(result.ok).toBe(true);
    expect(stopPublicStatusSchedulerMock).toHaveBeenCalled();
    expect(clearPublicStatusSnapshotMock).toHaveBeenCalled();
    expect(startPublicStatusSchedulerMock).not.toHaveBeenCalled();
  });

  it("rejects oversized serialized group config before hitting the database column limit", async () => {
    const result = await savePublicStatusSettings({
      publicStatusWindowHours: 24,
      publicStatusAggregationIntervalMinutes: 5,
      groups: [
        {
          groupName: "alpha",
          displayName: "Alpha Public",
          modelIds: Array.from({ length: 120 }, (_, index) => `gpt-${index}`),
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("500");
    expect(updateProviderGroupMock).not.toHaveBeenCalled();
  });
});
