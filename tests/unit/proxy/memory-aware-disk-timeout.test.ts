// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { ByteStore, STORE_SCRATCH_BYTES } from "@/lib/body-store/byte-store";
import { LocalCapacityError } from "@/lib/memory/governor";
import { logger } from "@/lib/logger";
import { MemoryGovernor } from "../../../server-lib/memory-governor";
import { getSpoolBudget } from "../../../server-lib/spool-directory";

const disk = vi.hoisted(() => ({
  mkdir: vi.fn(),
  statfs: vi.fn(),
  mkdtemp: vi.fn(),
  open: vi.fn(),
  rm: vi.fn(),
  write: vi.fn(),
  close: vi.fn(),
}));
vi.mock("node:fs/promises", () => disk);
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("磁盘故障与取消", () => {
  function setup() {
    disk.statfs.mockResolvedValue({ type: 0, bavail: 1024 ** 3, bsize: 4096 });
    disk.mkdtemp.mockResolvedValue("C:/cch-test-spool/owned");
    disk.open.mockResolvedValue({ write: disk.write, close: disk.close });
    const governor = new MemoryGovernor({
      limit: STORE_SCRATCH_BYTES,
      remote: false,
      monitor: false,
    });
    const lease = governor.tryLease(STORE_SCRATCH_BYTES)!;
    return { governor, lease };
  }

  it.each(["timeout", "abort"])("%s 结束请求等待，在途写入结束后才归还容量", async (mode) => {
    vi.useFakeTimers();
    const { governor, lease } = setup();
    let finish!: (value: { bytesWritten: number }) => void;
    disk.write.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const controller = new AbortController();
    const store = new ByteStore(lease, { signal: controller.signal });
    const append = store.append(new Uint8Array(100));
    const rejected = expect(append).rejects.toBeInstanceOf(
      mode === "timeout" ? LocalCapacityError : DOMException
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(disk.write).toHaveBeenCalledOnce();
    if (mode === "timeout") await vi.advanceTimersByTimeAsync(19999);
    else controller.abort();
    await rejected;
    await store.dispose(() => lease.release());
    expect(governor.snapshot().usedBytes).toBe(STORE_SCRATCH_BYTES);
    expect(disk.close).not.toHaveBeenCalled();
    finish({ bytesWritten: 100 });
    await vi.advanceTimersByTimeAsync(0);
    expect(disk.close).toHaveBeenCalledOnce();
    expect(disk.rm).toHaveBeenCalledOnce();
    expect(governor.snapshot().usedBytes).toBe(0);
    await expect(store.append(new Uint8Array(1))).rejects.toBeInstanceOf(LocalCapacityError);
  });

  it("拒绝 tmpfs，并清理打开文件失败留下的目录", async () => {
    const { lease } = setup();
    disk.statfs.mockResolvedValueOnce({ type: 0x01021994, bavail: 100, bsize: 4096 });
    const ram = new ByteStore(lease);
    await expect(ram.append(new Uint8Array(1))).rejects.toBeInstanceOf(LocalCapacityError);
    await ram.dispose();
    disk.open.mockRejectedValueOnce(new Error("disk failure"));
    const failed = new ByteStore(lease);
    await expect(failed.append(new Uint8Array(1))).rejects.toBeInstanceOf(LocalCapacityError);
    await failed.dispose(() => lease.release());
    expect(disk.rm).toHaveBeenCalledOnce();
  });

  it("删除失败保留实际磁盘额度，后台重试成功后恰好归还一次", async () => {
    vi.useFakeTimers();
    const { lease } = setup();
    const before = { ...getSpoolBudget() };
    disk.write.mockResolvedValue({ bytesWritten: 100 });
    disk.rm.mockRejectedValueOnce(new Error("temporary filesystem error"));
    const store = new ByteStore(lease);
    await store.append(new Uint8Array(100));
    await expect(store.dispose(() => lease.release())).rejects.toThrow(
      "temporary filesystem error"
    );
    expect(getSpoolBudget()).toMatchObject({ bytes: before.bytes + 100, files: before.files + 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(getSpoolBudget()).toEqual(before);
    await store.dispose();
    expect(disk.rm).toHaveBeenCalledTimes(2);
    expect(disk.close).toHaveBeenCalledOnce();
  });

  it("32 个 worker 分摊同一可用磁盘的 10%，不能各自占用 10%", async () => {
    vi.stubEnv("CCH_MULTICORE_WORKER_COUNT", "32");
    const { lease } = setup();
    disk.statfs.mockResolvedValue({ type: 0, bavail: 32000, bsize: 1 });
    disk.write.mockResolvedValue({ bytesWritten: 100 });
    const store = new ByteStore(lease);
    try {
      await store.append(new Uint8Array(100));
      await expect(store.append(new Uint8Array(1))).rejects.toBeInstanceOf(LocalCapacityError);
    } finally {
      await store.dispose(() => lease.release());
    }
  });

  it("同一 tmpfs 暂存目录仅警告一次并指出配置修复方式", async () => {
    const { lease } = setup();
    disk.statfs.mockResolvedValue({ type: 0x01021994, bavail: 1000, bsize: 4096 });
    for (let i = 0; i < 2; i++) {
      const store = new ByteStore(lease, { directory: "C:/cch-test-spool/warn-once" });
      await expect(store.append(new Uint8Array(1))).rejects.toBeInstanceOf(LocalCapacityError);
      await store.dispose();
    }
    lease.release();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      "memory_spool_unavailable",
      expect.objectContaining({
        reason: "tmpfs_or_ramfs",
        action: expect.stringContaining("CCH_MEMORY_SPILL_DIR"),
      })
    );
  });
});
