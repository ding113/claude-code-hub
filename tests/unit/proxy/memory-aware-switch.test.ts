import { EventEmitter } from "node:events";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  getStreamGatePrebufferBudget,
  resolveStreamGateGlobalPrebufferByteCap,
} from "@/app/v1/_lib/proxy/stream-gate/prebuffer-budget";
import { ByteStore, STORE_SCRATCH_BYTES } from "@/lib/body-store/byte-store";
import { loadRequestBody } from "@/lib/body-store/request-body-store";
import { getMemoryGovernor, LocalCapacityError } from "@/lib/memory/governor";
import { MemoryGovernor } from "../../../server-lib/memory-governor";

const GATE_CAP = 128 * 1024;
// getEnvConfig 在进程内只解析一次，门控上限必须在任何模块读取环境变量之前设置。
const previousGateCap = vi.hoisted(() => {
  const previous = process.env.STREAM_GATE_GLOBAL_PREBUFFER_BYTE_CAP;
  process.env.STREAM_GATE_GLOBAL_PREBUFFER_BYTE_CAP = String(128 * 1024);
  return previous;
});
afterAll(() => {
  if (previousGateCap === undefined) delete process.env.STREAM_GATE_GLOBAL_PREBUFFER_BYTE_CAP;
  else process.env.STREAM_GATE_GLOBAL_PREBUFFER_BYTE_CAP = previousGateCap;
});

const GOVERNOR_KEY = Symbol.for("cch.memoryGovernor");
const BUDGET_KEY = Symbol.for("cch.streamGatePrebufferBudget");
const globals = globalThis as unknown as Record<symbol, unknown>;

function installGovernor(governor: MemoryGovernor) {
  const previousGovernor = globals[GOVERNOR_KEY];
  const previousBudget = globals[BUDGET_KEY];
  globals[GOVERNOR_KEY] = governor;
  delete globals[BUDGET_KEY];
  return () => {
    globals[GOVERNOR_KEY] = previousGovernor;
    globals[BUDGET_KEY] = previousBudget;
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("内存准入开关", () => {
  it("默认关闭：超出额度的租约与增长立即成功，只记账", async () => {
    const governor = new MemoryGovernor({ limit: 0, remote: false, monitor: false });
    expect(governor.enabled).toBe(false);
    expect(governor.snapshot().enabled).toBe(false);

    const lease = governor.tryLease(1024 * 1024, "body_read");
    expect(lease).not.toBeNull();
    expect(lease!.tryGrow(4 * 1024 * 1024)).toBe(true);
    await expect(lease!.tryGrowAsync!(8 * 1024 * 1024)).resolves.toBe(true);
    const acquired = await governor.acquire(2 * 1024 * 1024);
    expect(governor.snapshot()).toMatchObject({
      usedBytes: 10 * 1024 * 1024,
      waiting: 0,
      rejected: 0,
    });

    governor.setEnabled(true);
    expect(governor.snapshot().enabled).toBe(true);
    expect(governor.tryLease(1)).toBeNull();
    expect(lease!.tryGrow(16 * 1024 * 1024)).toBe(false);
    await expect(governor.acquire(1, undefined, 0)).rejects.toBeInstanceOf(LocalCapacityError);

    lease!.release();
    acquired.release();
    expect(governor.snapshot().usedBytes).toBe(0);
  });

  it("关闭时多进程 worker 不向 primary 申请授权", async () => {
    const child = Object.assign(new EventEmitter(), {
      env: {},
      connected: true,
      send: vi.fn((_message: unknown, callback?: (error?: Error) => void) => callback?.()),
    });
    const governor = new MemoryGovernor({ processRef: child, remote: true, monitor: false });

    const lease = await governor.acquire(4 * 1024 * 1024);
    expect(lease.tryGrow(8 * 1024 * 1024)).toBe(true);
    await expect(lease.tryGrowAsync!(16 * 1024 * 1024)).resolves.toBe(true);
    expect(child.send).not.toHaveBeenCalled();
    expect(governor.snapshot().limitBytes).toBe(0);
    lease.release();
  });

  it("排队中的请求在开关关闭后立即放行", async () => {
    vi.useFakeTimers();
    const governor = new MemoryGovernor({ limit: 0, remote: false, monitor: false, enabled: true });
    let admitted = false;
    const waiting = governor.acquire(1024).then((lease) => {
      admitted = true;
      return lease;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(admitted).toBe(false);
    expect(governor.snapshot().waiting).toBe(1);

    governor.setEnabled(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(admitted).toBe(true);
    (await waiting).release();
    expect(governor.snapshot()).toMatchObject({ waiting: 0, rejected: 0, usedBytes: 0 });
  });

  it("关闭时正文全部留在内存，不创建暂存文件", async () => {
    const restore = installGovernor(
      new MemoryGovernor({ limit: 0, remote: false, monitor: false })
    );
    vi.stubEnv("CCH_MEMORY_SPILL_DIR", "/nonexistent/cch-spool-must-not-be-used");
    try {
      const lease = getMemoryGovernor().tryLease(STORE_SCRATCH_BYTES)!;
      const store = new ByteStore(lease);
      const body = new Uint8Array(3 * 1024 * 1024).map((_, index) => index % 251);
      for (let offset = 0; offset < body.byteLength; offset += 100_000) {
        await store.append(body.subarray(offset, offset + 100_000));
      }
      expect(store.spilled).toBe(false);
      expect(Buffer.from(await store.arrayBuffer()).equals(Buffer.from(body))).toBe(true);
      await store.dispose(() => lease.release());
    } finally {
      restore();
    }
  });

  it("关闭时零额度也能读取并解压大正文", async () => {
    const restore = installGovernor(
      new MemoryGovernor({ limit: 0, remote: false, monitor: false })
    );
    vi.stubEnv("CCH_MEMORY_SPILL_DIR", "/nonexistent/cch-spool-must-not-be-used");
    try {
      const text = JSON.stringify({ model: "claude-test", input: "y".repeat(2 * 1024 * 1024) });
      const loaded = await loadRequestBody(
        new Request("http://localhost/v1/messages", {
          method: "POST",
          headers: { "content-encoding": "gzip" },
          body: gzipSync(Buffer.from(text)),
        })
      );
      expect(new TextDecoder().decode(loaded.buffer)).toBe(text);
      expect(loaded.encoding).toBe("gzip");
      loaded.lease.release();
    } finally {
      restore();
    }
  });

  it("开关变化只在状态实际改变时通知，取消订阅后不再通知", () => {
    const governor = new MemoryGovernor({ limit: 0, remote: false, monitor: false });
    const seen: boolean[] = [];
    const unsubscribe = governor.onEnabledChange((enabled) => seen.push(enabled));
    governor.setEnabled(false);
    governor.setEnabled(true);
    governor.setEnabled(true);
    governor.setEnabled(false);
    unsubscribe();
    governor.setEnabled(true);
    expect(seen).toEqual([true, false]);
    expect(governor.enabled).toBe(true);
  });

  it("关闭开关时立即放行门控子限额队列中的请求", async () => {
    vi.useFakeTimers();
    const governor = new MemoryGovernor({
      limit: 64 * 1024 ** 2,
      remote: false,
      monitor: false,
      enabled: true,
    });
    const restore = installGovernor(governor);
    try {
      const budget = getStreamGatePrebufferBudget();
      const first = await budget.acquire(GATE_CAP);
      let admitted = false;
      const queued = budget.acquire(GATE_CAP).then((lease) => {
        admitted = true;
        return lease;
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(admitted).toBe(false);
      expect(budget.snapshot().waiting).toBe(1);

      governor.setEnabled(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(admitted).toBe(true);
      expect(budget.snapshot().waiting).toBe(0);
      (await queued).release();
      first.release();
    } finally {
      restore();
    }
  });

  it("门控子限额只在开启时生效", async () => {
    const cap = GATE_CAP;
    expect(resolveStreamGateGlobalPrebufferByteCap()).toBe(cap);
    const governor = new MemoryGovernor({ limit: 0, remote: false, monitor: false });
    const restore = installGovernor(governor);
    try {
      const budget = getStreamGatePrebufferBudget();
      expect(budget.snapshot().limit).toBe(Number.MAX_SAFE_INTEGER);
      const first = await budget.acquire(cap);
      const second = await budget.acquire(cap);
      expect(first.tryGrow(32 * cap)).toBe(true);
      expect(budget.snapshot()).toMatchObject({ waiting: 0, reservedBytes: 33 * cap });

      governor.setEnabled(true);
      expect(budget.snapshot().limit).toBe(cap);
      expect(first.tryGrow(64 * cap)).toBe(false);

      first.release();
      second.release();
      expect(budget.snapshot().reservedBytes).toBe(0);
    } finally {
      restore();
    }
  });
});
