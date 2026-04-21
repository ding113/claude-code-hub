import { beforeEach, describe, expect, it, vi } from "vitest";

const getSystemSettingsMock = vi.fn();
const findAllProviderGroupsMock = vi.fn();
const aggregatePublicStatusSnapshotMock = vi.fn();
const getPublicStatusSnapshotRecordMock = vi.fn();
const clearPublicStatusSnapshotMock = vi.fn();
const savePublicStatusSnapshotMock = vi.fn();

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: () => getSystemSettingsMock(),
}));

vi.mock("@/repository/provider-groups", () => ({
  findAllProviderGroups: () => findAllProviderGroupsMock(),
}));

vi.mock("@/lib/public-status/aggregation", () => ({
  aggregatePublicStatusSnapshot: (...args: unknown[]) => aggregatePublicStatusSnapshotMock(...args),
}));

vi.mock("@/repository/public-status-snapshot", () => ({
  getPublicStatusSnapshotRecord: () => getPublicStatusSnapshotRecordMock(),
  clearPublicStatusSnapshot: () => clearPublicStatusSnapshotMock(),
  savePublicStatusSnapshot: (...args: unknown[]) => savePublicStatusSnapshotMock(...args),
}));

import { refreshPublicStatusSnapshot } from "@/lib/public-status/service";

describe("refreshPublicStatusSnapshot", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T00:05:00.000Z"));

    const { invalidateConfiguredPublicStatusGroupsCache } = await import(
      "@/lib/public-status/config"
    );
    invalidateConfiguredPublicStatusGroupsCache();

    const { invalidateSystemSettingsCache } = await import("@/lib/config/system-settings-cache");
    invalidateSystemSettingsCache();

    getSystemSettingsMock.mockResolvedValue({
      id: 1,
      publicStatusWindowHours: 24,
      publicStatusAggregationIntervalMinutes: 5,
    });
    getPublicStatusSnapshotRecordMock.mockResolvedValue(null);
    clearPublicStatusSnapshotMock.mockResolvedValue(undefined);
  });

  it("stays disabled and does not aggregate when no group has configured public models", async () => {
    findAllProviderGroupsMock.mockResolvedValue([
      { id: 1, name: "default", description: null },
      {
        id: 2,
        name: "alpha",
        description: '{"publicStatus":{"displayName":"Alpha","modelIds":[]}}',
      },
    ]);

    const result = await refreshPublicStatusSnapshot();

    expect(result).toEqual({
      status: "disabled",
      reason: "no-configured-targets",
    });
    expect(clearPublicStatusSnapshotMock).toHaveBeenCalled();
    expect(aggregatePublicStatusSnapshotMock).not.toHaveBeenCalled();
    expect(savePublicStatusSnapshotMock).not.toHaveBeenCalled();
  });

  it("aggregates and persists snapshot after at least one group config declares public models", async () => {
    findAllProviderGroupsMock.mockResolvedValue([
      {
        id: 2,
        name: "alpha",
        description: '{"publicStatus":{"displayName":"Alpha","modelIds":["gpt-4.1","o3"]}}',
      },
    ]);
    aggregatePublicStatusSnapshotMock.mockResolvedValue({
      groups: [{ groupName: "alpha" }],
      generatedAt: "2026-04-21T00:00:00.000Z",
    });

    const result = await refreshPublicStatusSnapshot();

    expect(aggregatePublicStatusSnapshotMock).toHaveBeenCalledWith({
      windowHours: 24,
      bucketMinutes: 5,
      groups: [
        {
          groupName: "alpha",
          displayName: "Alpha",
          modelIds: ["gpt-4.1", "o3"],
        },
      ],
    });
    expect(savePublicStatusSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        groups: [{ groupName: "alpha" }],
      })
    );
    expect(result).toEqual({
      status: "updated",
      groupCount: 1,
      modelCount: 2,
    });
  });

  it("skips aggregation when the last snapshot is still within the configured interval", async () => {
    findAllProviderGroupsMock.mockResolvedValue([
      {
        id: 2,
        name: "alpha",
        description: '{"publicStatus":{"displayName":"Alpha","modelIds":["gpt-4.1","o3"]}}',
      },
    ]);
    getPublicStatusSnapshotRecordMock.mockResolvedValue({
      aggregatedAt: "2026-04-21T00:02:00.000Z",
      payload: {
        generatedAt: "2026-04-21T00:02:00.000Z",
        bucketMinutes: 5,
        groups: [],
      },
    });

    const result = await refreshPublicStatusSnapshot();

    expect(result).toEqual({
      status: "skipped",
      reason: "not-due",
    });
    expect(getSystemSettingsMock).not.toHaveBeenCalled();
    expect(findAllProviderGroupsMock).not.toHaveBeenCalled();
    expect(aggregatePublicStatusSnapshotMock).not.toHaveBeenCalled();
    expect(savePublicStatusSnapshotMock).not.toHaveBeenCalled();
  });
});
