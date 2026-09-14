import { beforeEach, describe, expect, it, vi } from "vitest";

const settingsMocks = vi.hoisted(() => ({
  getCachedSystemSettings: vi.fn(),
}));
vi.mock("@/lib/config/system-settings-cache", () => settingsMocks);

const repositoryMocks = vi.hoisted(() => ({
  getSystemSettings: vi.fn(),
}));
vi.mock("@/repository/system-config", () => repositoryMocks);

const checkerMocks = vi.hoisted(() => ({
  ClientVersionChecker: {
    updateUserVersion: vi.fn(async () => undefined),
    shouldUpgrade: vi.fn(),
  },
}));
vi.mock("@/lib/client-version-checker", () => checkerMocks);

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ProxyVersionGuard } from "@/app/v1/_lib/proxy/version-guard";

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    userAgent: "claude-cli/1.0.0 (external, cli)",
    authState: { user: { id: 7 } },
    ...overrides,
  } as never;
}

describe("ProxyVersionGuard settings source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads settings from the process cache and never queries the repository", async () => {
    settingsMocks.getCachedSystemSettings.mockResolvedValue({ enableClientVersionCheck: false });

    const result = await ProxyVersionGuard.ensure(makeSession());

    expect(result).toBeNull();
    expect(settingsMocks.getCachedSystemSettings).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.getSystemSettings).not.toHaveBeenCalled();
    expect(checkerMocks.ClientVersionChecker.shouldUpgrade).not.toHaveBeenCalled();
  });

  it("blocks outdated clients when the cached setting enables the check", async () => {
    settingsMocks.getCachedSystemSettings.mockResolvedValue({ enableClientVersionCheck: true });
    checkerMocks.ClientVersionChecker.shouldUpgrade.mockResolvedValue({
      needsUpgrade: true,
      gaVersion: "2.0.0",
    });

    const result = await ProxyVersionGuard.ensure(makeSession());

    expect(result).toBeInstanceOf(Response);
    expect(result?.status).toBe(400);
    const body = (await result?.json()) as { error: { required_version: string } };
    expect(body.error.required_version).toBe("2.0.0");
    expect(repositoryMocks.getSystemSettings).not.toHaveBeenCalled();
  });

  it("fails open when the settings cache throws", async () => {
    settingsMocks.getCachedSystemSettings.mockRejectedValue(new Error("cache failure"));

    await expect(ProxyVersionGuard.ensure(makeSession())).resolves.toBeNull();
  });
});
