import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilesystemSessionSnapshotStore } from "@/lib/session-snapshot/filesystem-store";

const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "cch-session-snapshot-"));
  roots.push(root);
  return root;
}

async function findSnapshotFile(directory: string): Promise<string | null> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findSnapshotFile(child);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name.endsWith(".json.gz")) {
      return child;
    }
  }
  return null;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FilesystemSessionSnapshotStore", () => {
  it("merges partial writes and publishes a gzip snapshot atomically", async () => {
    const root = await createRoot();
    const store = new FilesystemSessionSnapshotStore({ root, cleanupIntervalMs: 0 });
    const key = {
      sessionId: "../../secret",
      sequence: 1,
      kind: "request" as const,
      phase: "after" as const,
    };

    expect(store.enqueuePatch(key, { body: { model: "gpt" } }, 300)).toBe(true);
    expect(store.enqueuePatch(key, { meta: { method: "POST" } }, 300)).toBe(true);

    await expect(store.get(key)).resolves.toEqual({
      body: { model: "gpt" },
      meta: { method: "POST" },
    });
    const file = await findSnapshotFile(root);
    expect(file).not.toBeNull();
    expect(file).not.toContain("secret");
    expect(file).toMatch(/\.json\.gz$/);
    await store.stop();
  });

  it("rejects a logical snapshot and pending queue that exceed configured budgets", async () => {
    const root = await createRoot();
    const store = new FilesystemSessionSnapshotStore({
      root,
      maxSnapshotBytes: 128,
      maxPendingBytes: 100,
      cleanupIntervalMs: 0,
    });
    const first = {
      sessionId: "one",
      sequence: 1,
      kind: "request" as const,
      phase: "before" as const,
    };
    const second = { ...first, sessionId: "two" };

    expect(store.enqueuePatch(first, { body: "x".repeat(70) }, 300)).toBe(true);
    expect(store.enqueuePatch(second, { body: "y".repeat(70) }, 300)).toBe(false);
    expect(store.enqueuePatch(second, { body: "z".repeat(200) }, 300)).toBe(false);
    await store.stop();
  });

  it("removes expired snapshots using the inherited TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T12:00:00.000Z"));
    const root = await createRoot();
    const store = new FilesystemSessionSnapshotStore({ root, cleanupIntervalMs: 0 });
    const key = {
      sessionId: "ttl",
      sequence: 1,
      kind: "response" as const,
      phase: "after" as const,
    };

    expect(store.enqueuePatch(key, { body: "ok" }, 1)).toBe(true);
    await expect(store.get(key)).resolves.toEqual({ body: "ok" });
    vi.setSystemTime(new Date("2026-07-30T12:00:02.000Z"));
    await store.cleanup();
    await expect(store.get(key)).resolves.toBeNull();
    await store.stop();
  });

  it("treats corrupt compressed files as unavailable", async () => {
    const root = await createRoot();
    const store = new FilesystemSessionSnapshotStore({ root, cleanupIntervalMs: 0 });
    const key = {
      sessionId: "corrupt",
      sequence: 1,
      kind: "request" as const,
      phase: "before" as const,
    };

    expect(store.enqueuePatch(key, { body: "ok" }, 300)).toBe(true);
    await store.get(key);
    const file = await findSnapshotFile(root);
    expect(file).not.toBeNull();
    await writeFile(file!, "not-gzip");
    await expect(store.get(key)).resolves.toBeNull();
    await store.stop();
  });

  it("can restart after a backend reconfiguration stops the store", async () => {
    const root = await createRoot();
    const store = new FilesystemSessionSnapshotStore({ root, cleanupIntervalMs: 0 });
    const first = {
      sessionId: "restart",
      sequence: 1,
      kind: "request" as const,
      phase: "before" as const,
    };
    const second = { ...first, sequence: 2 };

    expect(store.enqueuePatch(first, { body: "before-stop" }, 300)).toBe(true);
    await expect(store.get(first)).resolves.toEqual({ body: "before-stop" });
    await store.stop();
    expect(store.enqueuePatch(second, { body: "while-stopped" }, 300)).toBe(false);

    for (let sequence = second.sequence; sequence < second.sequence + 20; sequence += 1) {
      const key = { ...second, sequence };
      await store.start();
      expect(store.enqueuePatch(key, { body: `after-restart-${sequence}` }, 300)).toBe(true);
      await expect(store.get(key)).resolves.toEqual({ body: `after-restart-${sequence}` });
      await store.stop();
    }
  });

  it("serializes an overlapping stop and restart", async () => {
    const root = await createRoot();
    const store = new FilesystemSessionSnapshotStore({ root, cleanupIntervalMs: 0 });
    await store.start();

    let releaseDrain!: () => void;
    const drainGate = new Promise<void>((resolve) => {
      releaseDrain = resolve;
    });
    const internals = store as unknown as {
      accepting: boolean;
      ensureRoot(): Promise<void>;
      started: boolean;
      waitForDrain(): Promise<void>;
    };
    vi.spyOn(internals, "waitForDrain").mockReturnValue(drainGate);
    vi.spyOn(internals, "ensureRoot").mockResolvedValue();

    const stopping = store.stop();
    const restarting = store.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseDrain();
    await Promise.all([stopping, restarting]);

    expect(internals.accepting).toBe(true);
    expect(internals.started).toBe(true);
    await store.stop();
  });
});
