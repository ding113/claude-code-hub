// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamGatePrebufferBudget } from "@/app/v1/_lib/proxy/stream-gate/prebuffer-budget";
import {
  prepareGateResponse,
  takePreparedGateLease,
} from "@/app/v1/_lib/proxy/stream-gate/prepared-gate";
import { runStreamContentGate } from "@/app/v1/_lib/proxy/stream-gate/stream-content-gate";

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
