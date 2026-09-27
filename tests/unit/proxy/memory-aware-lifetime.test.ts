// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { AsyncTaskManager } from "@/lib/async-task-manager";
import { loadRequestBody, retainRequestMemory } from "@/lib/body-store/request-body-store";
import { getMemoryGovernor } from "@/lib/memory/governor";
import {
  attachRequestMemory,
  getRequestMemoryLifetimeStats,
  onRequestMemoryForcedEnd,
  retainCurrentRequestMemory,
  retainRequestMemoryUntil,
  withRequestMemoryLifetime,
} from "@/lib/memory/request-lifetime";
import { MemoryGovernor } from "../../../server-lib/memory-governor";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("请求内存确定性回收", () => {
  it("小预算连续处理大正文无需 GC，额度在响应 EOF 后归零", async () => {
    const governor = new MemoryGovernor({ limit: 4 * 1024 ** 2, remote: false, monitor: false });
    vi.spyOn(getMemoryGovernor(), "acquire").mockImplementation((bytes, signal, wait) =>
      governor.acquire(bytes, signal, wait)
    );
    vi.spyOn(getMemoryGovernor(), "tryLease").mockImplementation((bytes) =>
      governor.tryLease(bytes)
    );
    for (let i = 0; i < 20; i++) {
      const response = await withRequestMemoryLifetime(async () => {
        const request = new Request("http://localhost/v1/responses", {
          method: "POST",
          body: JSON.stringify({ input: "x".repeat(300000) }),
        });
        const loaded = await loadRequestBody(request);
        retainRequestMemory(request, loaded.lease);
        expect(loaded.buffer.byteLength).toBeGreaterThan(300000);
        return new Response("OK");
      });
      expect(governor.snapshot().usedBytes).toBeGreaterThan(0);
      expect(await response.text()).toBe("OK");
      expect(governor.snapshot().usedBytes).toBe(0);
    }
  });

  it.each(["no-body", "throw", "read-error", "cancel"])("%s 路径只归还一次", async (mode) => {
    const governor = new MemoryGovernor({ limit: 100, remote: false, monitor: false });
    const lease = governor.tryLease(100)!;
    const release = vi.spyOn(lease, "release");
    const result = withRequestMemoryLifetime(async () => {
      expect(attachRequestMemory(lease)).toBe(true);
      if (mode === "throw") throw new Error("failure");
      if (mode === "no-body") return new Response(null, { status: 204 });
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (mode === "read-error") controller.error(new Error("read failed"));
          },
        })
      );
    });
    if (mode === "throw") await expect(result).rejects.toThrow("failure");
    else {
      const response = await result;
      if (mode === "read-error") await expect(response.text()).rejects.toThrow("read failed");
      if (mode === "cancel") await response.body!.cancel();
    }
    expect(release).toHaveBeenCalledOnce();
    expect(governor.snapshot().usedBytes).toBe(0);
  });

  it("取消响应后，后台消费者实际结束才释放；多个消费者不重复归还", async () => {
    const governor = new MemoryGovernor({ limit: 100, remote: false, monitor: false });
    const held = Promise.withResolvers<void>();
    let background!: Promise<void>;
    let releaseOther!: () => void;
    const response = await withRequestMemoryLifetime(async () => {
      attachRequestMemory(governor.tryLease(100)!);
      background = retainRequestMemoryUntil(held.promise);
      releaseOther = retainCurrentRequestMemory();
      return new Response(new ReadableStream());
    });
    await response.body!.cancel();
    expect(governor.snapshot().usedBytes).toBe(100);
    held.resolve();
    await background;
    expect(governor.snapshot().usedBytes).toBe(100);
    releaseOther();
    releaseOther();
    expect(governor.snapshot().usedBytes).toBe(0);
  });

  it("任务管理器取消不提前归还仍执行的消费者", async () => {
    vi.stubEnv("CI", "true");
    const governor = new MemoryGovernor({ limit: 100, remote: false, monitor: false });
    const held = Promise.withResolvers<void>();
    const response = await withRequestMemoryLifetime(async () => {
      attachRequestMemory(governor.tryLease(100)!);
      AsyncTaskManager.register("memory-lifetime-cancel", () => held.promise);
      return new Response("done");
    });
    await response.text();
    AsyncTaskManager.cancel("memory-lifetime-cancel");
    expect(governor.snapshot().usedBytes).toBe(100);
    held.resolve();
    await vi.waitFor(() => expect(governor.snapshot().usedBytes).toBe(0));
  });

  it("作用域外使用兜底，已结束作用域的元数据回调不重复释放", async () => {
    const governor = new MemoryGovernor({ limit: 1, remote: false, monitor: false });
    const lease = governor.tryLease(1)!;
    expect(attachRequestMemory(lease)).toBe(false);
    retainCurrentRequestMemory()();
    lease.release();
    let late!: () => void;
    const ready = Promise.withResolvers<void>();
    const response = await withRequestMemoryLifetime(async () => {
      void ready.promise.then(() => {
        late = retainCurrentRequestMemory();
      });
      return new Response(null);
    });
    expect(response.body).toBeNull();
    ready.resolve();
    await ready.promise;
    late();
  });
  it("永不结束的后台所有者在宽限到期后被强制归还，并丢弃正文引用", async () => {
    vi.useFakeTimers();
    const governor = new MemoryGovernor({ limit: 100, remote: false, monitor: false });
    const disposed = vi.fn();
    const forcedBefore = getRequestMemoryLifetimeStats().forcedTotal;
    const response = await withRequestMemoryLifetime(async () => {
      attachRequestMemory(governor.tryLease(100, "body_materialize")!);
      onRequestMemoryForcedEnd(disposed);
      void retainRequestMemoryUntil(new Promise<void>(() => {}), "stuck-redis");
      return new Response("done");
    });
    await response.text();
    expect(governor.snapshot().usedBytes).toBe(100);
    expect(getRequestMemoryLifetimeStats().drainingLabels["stuck-redis"]).toBe(1);

    await vi.advanceTimersByTimeAsync(149_000);
    expect(governor.snapshot().usedBytes).toBe(100);
    expect(disposed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(governor.snapshot().usedBytes).toBe(0);
    expect(governor.snapshot().leases.count).toBe(0);
    expect(disposed).toHaveBeenCalledTimes(1);
    const stats = getRequestMemoryLifetimeStats();
    expect(stats.forcedTotal).toBe(forcedBefore + 1);
    expect(stats.drainingLabels["stuck-redis"]).toBeUndefined();
  });

  it("仍在推进的后台消费者刷新宽限；响应未结束时不计时", async () => {
    vi.useFakeTimers();
    const governor = new MemoryGovernor({ limit: 100, remote: false, monitor: false });
    let retention!: ReturnType<typeof retainCurrentRequestMemory>;
    const body = new ReadableStream<Uint8Array>();
    const response = await withRequestMemoryLifetime(async () => {
      attachRequestMemory(governor.tryLease(100)!);
      retention = retainCurrentRequestMemory("detached-drain");
      return new Response(body);
    });
    // 响应仍在流式传输：无论多久都不强制归还。
    await vi.advanceTimersByTimeAsync(600_000);
    expect(governor.snapshot().usedBytes).toBe(100);

    await response.body!.cancel();
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(100_000);
      retention.touch();
    }
    expect(governor.snapshot().usedBytes).toBe(100);

    await vi.advanceTimersByTimeAsync(151_000);
    expect(governor.snapshot().usedBytes).toBe(0);
    retention();
    retention.touch();
    expect(governor.snapshot().usedBytes).toBe(0);
  });

  it("正常结束不触发强制路径，也不调用丢弃回调", async () => {
    vi.useFakeTimers();
    const governor = new MemoryGovernor({ limit: 100, remote: false, monitor: false });
    const disposed = vi.fn();
    const held = Promise.withResolvers<void>();
    const forcedBefore = getRequestMemoryLifetimeStats().forcedTotal;
    const response = await withRequestMemoryLifetime(async () => {
      attachRequestMemory(governor.tryLease(100)!);
      onRequestMemoryForcedEnd(disposed);
      void retainRequestMemoryUntil(held.promise, "slow-but-finishes");
      return new Response("done");
    });
    await response.text();
    held.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(governor.snapshot().usedBytes).toBe(0);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(disposed).not.toHaveBeenCalled();
    expect(getRequestMemoryLifetimeStats().forcedTotal).toBe(forcedBefore);
  });

  it("作用域结束后再挂载返回 false，由调用方走 GC 兜底而不是抛错", async () => {
    const governor = new MemoryGovernor({ limit: 10, remote: false, monitor: false });
    let attachLate!: () => boolean;
    const response = await withRequestMemoryLifetime(async () => {
      const lease = governor.tryLease(10)!;
      attachLate = () => attachRequestMemory(lease);
      // 捕获当前作用域，模拟继承 ALS 上下文的后台消费者。
      const { AsyncResource } = await import("node:async_hooks");
      attachLate = AsyncResource.bind(attachLate);
      return new Response(null);
    });
    expect(response.body).toBeNull();
    expect(attachLate()).toBe(false);
    expect(() => retainRequestMemory({}, governor.tryLease(0)!)).not.toThrow();
  });
});
