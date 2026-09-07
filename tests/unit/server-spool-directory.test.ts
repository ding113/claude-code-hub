// @vitest-environment node
import fs from "node:fs";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  cleanupOrphanSpools,
  getSpoolRoot,
  spoolPrefix,
  startSpoolCleanup,
} from "../../server-lib/spool-directory";

describe("遗留暂存文件回收", () => {
  it("后台清理立即返回，不重叠扫描，失败后仍继续定期清理", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const cleanup = vi.fn().mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const onError = vi.fn();
    const stop = startSpoolCleanup({ cleanup, onError });
    try {
      expect(typeof stop).toBe("function");
      expect(cleanup).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(120000);
      expect(cleanup).toHaveBeenCalledTimes(1);
      finish();
      await vi.advanceTimersByTimeAsync(0);
      const failure = new Error("disk unavailable");
      cleanup.mockRejectedValueOnce(failure);
      await vi.advanceTimersByTimeAsync(60000);
      expect(onError).toHaveBeenCalledWith(failure);
      await vi.advanceTimersByTimeAsync(60000);
      expect(cleanup).toHaveBeenCalledTimes(3);
      stop();
      await vi.advanceTimersByTimeAsync(60000);
      expect(cleanup).toHaveBeenCalledTimes(3);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it("只删除确认死亡或 PID 被复用的自有目录", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cch-orphan-test-"));
    const names = [
      "cch-101-unknown-dead",
      "cch-102-10-reused",
      "cch-103-20-alive",
      "cch-104-unknown-safe",
      "unrelated",
    ];
    try {
      for (const name of names) await mkdir(path.join(root, name));
      vi.spyOn(process, "kill").mockImplementation((pid) => {
        if (pid === 101) throw Object.assign(new Error("gone"), { code: "ESRCH" });
        return true;
      });
      const read = fs.readFileSync.bind(fs);
      vi.spyOn(fs, "readFileSync").mockImplementation(((
        file: fs.PathOrFileDescriptor,
        ...args: unknown[]
      ) => {
        if (String(file).startsWith("/proc/"))
          return `102 (test with ) name) ${Array(19).fill("0").join(" ")} 20`;
        return (read as (...values: unknown[]) => unknown)(file, ...args);
      }) as typeof fs.readFileSync);
      await cleanupOrphanSpools(root);
      expect((await readdir(root)).sort()).toEqual(names.slice(2).sort());
      expect(spoolPrefix()).toMatch(new RegExp(`^cch-${process.pid}-`));
      expect(getSpoolRoot({ CCH_MEMORY_SPILL_DIR: root })).toBe(path.resolve(root));
      expect(path.isAbsolute(getSpoolRoot({}))).toBe(true);
      await cleanupOrphanSpools(path.join(root, "missing"));
    } finally {
      vi.restoreAllMocks();
      await rm(root, { recursive: true, force: true });
    }
  });
});
