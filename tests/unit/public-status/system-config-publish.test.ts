import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockGetSystemSettings = vi.hoisted(() => vi.fn());
const mockUpdateSystemSettings = vi.hoisted(() => vi.fn());
const mockPublishCurrentPublicStatusConfigProjection = vi.hoisted(() => vi.fn());
const mockSchedulePublicStatusRebuild = vi.hoisted(() => vi.fn());
const mockInvalidateSystemSettingsCache = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getSession: mockGetSession,
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mockGetSystemSettings,
  updateSystemSettings: mockUpdateSystemSettings,
}));

vi.mock("@/lib/public-status/config-publisher", () => ({
  publishCurrentPublicStatusConfigProjection: mockPublishCurrentPublicStatusConfigProjection,
}));

vi.mock("@/lib/public-status/rebuild-hints", () => ({
  schedulePublicStatusRebuild: mockSchedulePublicStatusRebuild,
}));

vi.mock("@/lib/config", () => ({
  invalidateSystemSettingsCache: mockInvalidateSystemSettingsCache,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: () => {},
    warn: () => {},
  },
}));

describe("system settings public-status republish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: {
        id: 1,
        role: "admin",
      },
    });
    mockGetSystemSettings.mockResolvedValue({
      id: 1,
      siteTitle: "Claude Code Hub",
    });
    mockUpdateSystemSettings.mockResolvedValue({
      id: 1,
      siteTitle: "Claude Code Hub",
      publicStatusWindowHours: 24,
      publicStatusAggregationIntervalMinutes: 5,
    });
    mockPublishCurrentPublicStatusConfigProjection.mockResolvedValue({
      configVersion: "cfg-1",
      key: "public-status:v1:config:cfg-1",
      written: true,
      groupCount: 1,
    });
    mockSchedulePublicStatusRebuild.mockResolvedValue({
      accepted: true,
      rebuildState: "rebuilding",
    });
  });

  it("republishes public-status projection when related system settings change", async () => {
    const { saveSystemSettings } = await import("@/actions/system-config");

    const result = await saveSystemSettings({
      siteTitle: "Status Aware Title",
      publicStatusWindowHours: 48,
      publicStatusAggregationIntervalMinutes: 15,
    });

    expect(result.ok).toBe(true);
    expect(mockPublishCurrentPublicStatusConfigProjection).toHaveBeenCalledWith({
      reason: "save-system-settings",
    });
    expect(mockSchedulePublicStatusRebuild).toHaveBeenCalledWith({
      intervalMinutes: 15,
      rangeHours: 48,
      reason: "system-settings-updated",
    });
    expect(mockInvalidateSystemSettingsCache).toHaveBeenCalled();
    expect(mockRevalidatePath).toHaveBeenCalled();
  });
});
