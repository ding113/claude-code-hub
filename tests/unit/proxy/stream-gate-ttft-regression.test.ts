// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamGatePrebufferBudget } from "@/app/v1/_lib/proxy/stream-gate/prebuffer-budget";
import {
  prepareGateResponse,
  takePreparedGateLease,
} from "@/app/v1/_lib/proxy/stream-gate/prepared-gate";
import { runStreamContentGate } from "@/app/v1/_lib/proxy/stream-gate/stream-content-gate";
import { MemoryGovernor } from "../../../server-lib/memory-governor";

const content = new TextEncoder().encode(
  'data: {"type":"response.output_text.delta","delta":"ok"}\n\n'
);
const options = {
  family: "openai-responses" as const,
  providerId: 1,
  providerName: "test",
  prebufferEventCap: 64,
  prebufferByteCap: 10 * 1024 * 1024,
};
afterEach(() => vi.useRealTimers());
describe("TTFT 固定预占回归", () => {
  it("等待门控子限额的请求不占用全局正文额度", async () => {
    const governor = new MemoryGovernor({ limit: 2 * 1024 ** 2, remote: false, monitor: false });
    const budget = new StreamGatePrebufferBudget(() => 128 * 1024, governor);
    const first = await budget.acquire(128 * 1024);
    const controllers = Array.from({ length: 24 }, () => new AbortController());
    const waiting = controllers.map((controller) =>
      budget.acquire(128 * 1024, controller.signal).catch((error) => error)
    );
    await Promise.resolve();
    expect(budget.snapshot().waiting).toBe(24);
    expect(governor.snapshot().usedBytes).toBe(128 * 1024);
    const body = governor.tryLease(1536 * 1024);
    expect(body).not.toBeNull();
    for (const controller of controllers) controller.abort();
    await Promise.all(waiting);
    body!.release();
    first.release();
    expect(governor.snapshot().usedBytes).toBe(0);
  });

  it("本地与全局等待共用 20 秒期限，失败后归还本地子额度", async () => {
    vi.useFakeTimers();
    const governor = new MemoryGovernor({ limit: 256, remote: false, monitor: false });
    const budget = new StreamGatePrebufferBudget(() => 128, governor);
    const first = await budget.acquire(128);
    const occupied = governor.tryLease(128)!;
    const waiting = budget.acquire(128);
    const rejected = expect(waiting).rejects.toMatchObject({ statusCode: 429 });
    await vi.advanceTimersByTimeAsync(10000);
    first.release();
    const replacement = governor.tryLease(128)!;
    await vi.advanceTimersByTimeAsync(0);
    expect(governor.snapshot().waiting).toBe(1);
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(budget.snapshot()).toMatchObject({ reservedBytes: 0, waiting: 0 });
    occupied.release();
    replacement.release();
    expect(governor.snapshot().usedBytes).toBe(0);
  });
  it("同一 64 MiB worker 的 60 秒慢请求不能阻塞 100 个快速请求", async () => {
    vi.useFakeTimers();
    const budget = new StreamGatePrebufferBudget(() => 64 * 1024 * 1024);
    const slow = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(content);
          controller.close();
        }, 60000);
      },
    });
    const waiting = runStreamContentGate(slow.getReader(), { ...options, prebufferBudget: budget });
    const fast = await Promise.all(
      Array.from({ length: 100 }, () =>
        runStreamContentGate(new Response(content).body!.getReader(), {
          ...options,
          prebufferBudget: budget,
        })
      )
    );
    expect(fast.every((result) => result.committed)).toBe(true);
    expect(budget.snapshot()).toMatchObject({ waiting: 0 });
    expect(budget.snapshot().reservedBytes).toBeLessThan(8 * 1024 * 1024);
    for (const result of fast) if (result.committed) result.prebufferLease?.release();
    await vi.advanceTimersByTimeAsync(60000);
    const slowResult = await waiting;
    expect(slowResult.committed).toBe(true);
    if (slowResult.committed) slowResult.prebufferLease?.release();
    expect(budget.snapshot().reservedBytes).toBe(0);
  });
  it("预先准入的响应只转移一次租约，EOF 不提前释放仍待回放的前缀", async () => {
    const budget = new StreamGatePrebufferBudget(() => 1024 * 1024);
    const lease = await budget.acquire(128 * 1024);
    const response = prepareGateResponse(new Response(content), lease);
    const prepared = takePreparedGateLease(response);
    expect(takePreparedGateLease(response)).toBeUndefined();
    const result = await runStreamContentGate(response.body!.getReader(), {
      ...options,
      prebufferLease: prepared,
    });
    expect(result.committed).toBe(true);
    expect(budget.snapshot().reservedBytes).toBeGreaterThan(0);
    if (result.committed) result.prebufferLease?.release();
    expect(budget.snapshot().reservedBytes).toBe(0);
  });
  it("非 SSE 响应取消也释放预先准入工作集", async () => {
    const budget = new StreamGatePrebufferBudget(() => 1024 * 1024);
    const response = prepareGateResponse(new Response("error"), await budget.acquire(128 * 1024));
    await response.body!.cancel();
    expect(budget.snapshot().reservedBytes).toBe(0);
  });
});
