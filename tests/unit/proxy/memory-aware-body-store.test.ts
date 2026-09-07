// @vitest-environment node
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  brotliCompressSync,
  deflateRawSync,
  deflateSync,
  gzipSync,
  zstdCompressSync,
} from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ByteStore, STORE_SCRATCH_BYTES } from "@/lib/body-store/byte-store";
import { loadRequestBody } from "@/lib/body-store/request-body-store";
import { LocalCapacityError } from "@/lib/memory/governor";
import { MemoryGovernor } from "../../../server-lib/memory-governor";

let testDirectory: string;
beforeEach(async () => {
  // 使用工作区所在磁盘，避免 Linux 的 /tmp 挂载为 tmpfs。
  const root = path.join(process.cwd(), "tmp");
  await mkdir(root, { recursive: true });
  testDirectory = await mkdtemp(path.join(root, "cch-body-test-"));
  vi.stubEnv("CCH_MEMORY_SPILL_DIR", testDirectory);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(testDirectory, { recursive: true, force: true });
});
describe("内存/磁盘共享正文", () => {
  it("容量耗尽时逐块落盘，精确回放，重复释放不泄漏文件", async () => {
    const directory = await mkdtemp(path.join(testDirectory, "case-"));
    const governor = new MemoryGovernor({
      limit: STORE_SCRATCH_BYTES,
      monitor: false,
      remote: false,
    });
    const lease = await governor.acquire(STORE_SCRATCH_BYTES);
    const store = new ByteStore(lease, { directory, ioTimeoutMs: 5000 });
    try {
      const bytes = new TextEncoder().encode("大上下文\n".repeat(100000));
      for (let i = 0; i < bytes.length; i += 31931)
        await store.append(bytes.subarray(i, i + 31931));
      expect(store.spilled).toBe(true);
      expect(store.retainedByteLength).toBe(0);
      expect(Buffer.compare(Buffer.from(await store.arrayBuffer()), bytes)).toBe(0);
      expect(Buffer.compare(Buffer.from(await store.arrayBuffer()), bytes)).toBe(0);
      expect(governor.snapshot().usedBytes).toBe(STORE_SCRATCH_BYTES);
      await store.dispose();
      await store.dispose();
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await store.dispose();
      lease.release();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("落盘配额不足返回本地过载并清理已创建文件", async () => {
    const directory = await mkdtemp(path.join(testDirectory, "case-"));
    const governor = new MemoryGovernor({
      limit: STORE_SCRATCH_BYTES,
      monitor: false,
      remote: false,
    });
    const lease = await governor.acquire(STORE_SCRATCH_BYTES);
    const store = new ByteStore(lease, { directory, maxDiskBytes: 32 });
    try {
      await expect(store.append(new Uint8Array(33))).rejects.toBeInstanceOf(LocalCapacityError);
      await store.dispose();
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await store.dispose();
      lease.release();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("小正文保持内存并持有自有块，避免小视图挂住大 backing buffer", async () => {
    const governor = new MemoryGovernor({ limit: 1024 * 1024, monitor: false, remote: false });
    const lease = await governor.acquire(STORE_SCRATCH_BYTES);
    const store = new ByteStore(lease);
    const parent = new Uint8Array(16 * 1024 * 1024);
    parent[0] = 42;
    await store.append(parent.subarray(0, 1));
    parent[0] = 99;
    expect(new Uint8Array(await store.arrayBuffer())).toEqual(new Uint8Array([42]));
    expect(store.retainedByteLength).toBe(64 * 1024);
    await store.dispose();
    lease.release();
  });
});

describe("单消费者与流式解压", () => {
  const text = JSON.stringify({
    model: "test",
    messages: [{ role: "user", content: "你好，large body".repeat(60000) }],
  });
  it.each([
    ["gzip", gzipSync],
    ["x-gzip", gzipSync],
    ["br", brotliCompressSync],
    ["deflate", deflateSync],
    ["deflate", deflateRawSync],
    ["zstd", zstdCompressSync],
  ] as const)("%s 正文超过热内存阈值仍完整兼容", async (encoding, compress) => {
    const compressed = compress(Buffer.from(text));
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "content-encoding": encoding },
      body: compressed,
    });
    const clone = vi.spyOn(request, "clone");
    const result = await loadRequestBody(request);
    try {
      expect(new TextDecoder().decode(result.buffer)).toBe(text);
      expect(result.encoding).toBe(encoding);
      expect(result.originalByteLength).toBe(compressed.byteLength);
      expect(clone).not.toHaveBeenCalled();
    } finally {
      result.lease.release();
    }
  });
  it.each(["gzip", "br", "deflate", "zstd"])("%s 损坏输入为客户端 400", async (encoding) => {
    await expect(
      loadRequestBody(
        new Request("http://localhost/v1/messages", {
          method: "POST",
          headers: { "content-encoding": encoding },
          body: "not compressed",
        })
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it("未知编码与空多层编码保留兼容性", async () => {
    for (const [encoding, input] of [
      ["unknown", "wire"],
      ["gzip, br", ""],
    ]) {
      const result = await loadRequestBody(
        new Request("http://localhost/v1/messages", {
          method: "POST",
          headers: { "content-encoding": encoding },
          body: input,
        })
      );
      expect(new TextDecoder().decode(result.buffer)).toBe(input);
      expect(result.encoding).toBeNull();
      result.lease.release();
    }
  });
});
