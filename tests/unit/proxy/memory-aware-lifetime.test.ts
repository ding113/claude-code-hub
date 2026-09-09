// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { AsyncTaskManager } from "@/lib/async-task-manager";
import { loadRequestBody, retainRequestMemory } from "@/lib/body-store/request-body-store";
import { getMemoryGovernor } from "@/lib/memory/governor";
import {
  attachRequestMemory,
  retainCurrentRequestMemory,
  retainRequestMemoryUntil,
  withRequestMemoryLifetime,
} from "@/lib/memory/request-lifetime";
import { MemoryGovernor } from "../../../server-lib/memory-governor";

afterEach(() => vi.unstubAllEnvs());

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
});
