// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { ByteStore, STORE_SCRATCH_BYTES } from "@/lib/body-store/byte-store";
import { LocalCapacityError } from "@/lib/memory/governor";
import { MemoryGovernor } from "../../../server-lib/memory-governor";

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
afterEach(() => vi.useRealTimers());

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
});
