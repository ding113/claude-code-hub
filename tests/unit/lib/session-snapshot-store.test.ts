import { lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemSettings } from "@/types/system-config";

const getCachedSystemSettingsMock = vi.fn();
const getCachedSystemSettingsOnlyCacheMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: () => getCachedSystemSettingsMock(),
  getCachedSystemSettingsOnlyCache: () => getCachedSystemSettingsOnlyCacheMock(),
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => null,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const roots: string[] = [];
const originalSnapshotRoot = process.env.SESSION_SNAPSHOT_ROOT;

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "cch-session-store-"));
  roots.push(root);
  return root;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(async () => {
  if (originalSnapshotRoot === undefined) {
    delete process.env.SESSION_SNAPSHOT_ROOT;
  } else {
    process.env.SESSION_SNAPSHOT_ROOT = originalSnapshotRoot;
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("session snapshot store selection", () => {
  it("uses the persisted backend on cold start without starting filesystem storage", async () => {
    const base = await createRoot();
    const snapshotRoot = path.join(base, "snapshots");
    process.env.SESSION_SNAPSHOT_ROOT = snapshotRoot;
    const settings = { sessionSnapshotStore: "disabled" } as SystemSettings;
    getCachedSystemSettingsMock.mockResolvedValue(settings);
    getCachedSystemSettingsOnlyCacheMock.mockReturnValue(settings);

    const { startSessionSnapshotStore, stopSessionSnapshotStores } = await import(
      "@/lib/session-snapshot/store"
    );
    await startSessionSnapshotStore();

    await expect(lstat(snapshotRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await stopSessionSnapshotStores();
  });

  it("allows a later backend transition after filesystem startup fails", async () => {
    const base = await createRoot();
    const blockedRoot = path.join(base, "not-a-directory");
    await writeFile(blockedRoot, "blocked");
    process.env.SESSION_SNAPSHOT_ROOT = blockedRoot;
    getCachedSystemSettingsOnlyCacheMock.mockReturnValue(null);

    const { getSessionSnapshotStore, reconfigureSessionSnapshotStore, stopSessionSnapshotStores } =
      await import("@/lib/session-snapshot/store");

    await expect(reconfigureSessionSnapshotStore("filesystem")).rejects.toBeInstanceOf(Error);
    await expect(reconfigureSessionSnapshotStore("disabled")).resolves.toBeUndefined();
    expect(
      getSessionSnapshotStore().enqueuePatch(
        {
          sessionId: "disabled",
          sequence: 1,
          kind: "request",
          phase: "before",
        },
        { body: "ignored" },
        300
      )
    ).toBe(false);
    await stopSessionSnapshotStores();
  });
});
