// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DiscoveryPrebuffer } from "@/app/v1/_lib/proxy/discovery-prebuffer";
import { DiscoveryValidityParser } from "@/app/v1/_lib/proxy/discovery-validity";
import { StreamGatePrebufferBudget } from "@/app/v1/_lib/proxy/stream-gate/prebuffer-budget";
import {
  prepareGateResponse,
  takePreparedGateLease,
} from "@/app/v1/_lib/proxy/stream-gate/prepared-gate";
import { MemoryGovernor } from "../../../server-lib/memory-governor";

const encoder = new TextEncoder();
const frame = (payload: object) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

describe("Discovery 前缀与解析容量", () => {
  it("中性帧实际增长、EOF 不提前归还，赢家回放后释放", async () => {
    const governor = new MemoryGovernor({ limit: 8 * 1024 ** 2, remote: false, monitor: false });
    const budget = new StreamGatePrebufferBudget(() => 8 * 1024 ** 2, governor);
    const neutral = frame({
      type: "response.created",
      response: { status: "in_progress", instructions: "x".repeat(300000) },
    });
    const content = frame({ type: "response.output_text.delta", delta: "ready" });
    const response = prepareGateResponse(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(neutral);
            controller.enqueue(content);
            controller.close();
          },
        })
      ),
      await budget.acquire(128 * 1024)
    );
    const buffer = new DiscoveryPrebuffer();
    buffer.attachLease(takePreparedGateLease(response));
    const reader = response.body!.getReader();
    let parser: DiscoveryValidityParser | null = new DiscoveryValidityParser("openai-responses");
    for (let index = 0; index < 2; index++) {
      const chunk = (await reader.read()).value!;
      await buffer.reserveForParse(chunk);
      expect(governor.snapshot().usedBytes).toBeGreaterThan(chunk.byteLength);
      expect(parser!.push(chunk).ready).toBe(index === 1);
      buffer.append(chunk);
    }
    expect((await reader.read()).done).toBe(true);
    expect(governor.snapshot().usedBytes).toBeGreaterThan(neutral.byteLength * 8);
    parser = null;
    buffer.finishParsing();
    const retained = buffer.retainedByteLength;
    expect(governor.snapshot().usedBytes).toBe(retained);
    const prefix = buffer.takeOwned();
    buffer.clear();
    expect(governor.snapshot().usedBytes).toBe(retained);
    expect(Buffer.compare(Buffer.concat(prefix.chunks), Buffer.concat([neutral, content]))).toBe(0);
    prefix.lease!.release();
    expect(governor.snapshot().usedBytes).toBe(0);
  });

  it("增长不足在解析与复制前返回本地 429，取消后两级额度归零", async () => {
    const governor = new MemoryGovernor({ limit: 256 * 1024, remote: false, monitor: false });
    const budget = new StreamGatePrebufferBudget(() => 256 * 1024, governor);
    const buffer = new DiscoveryPrebuffer();
    buffer.attachLease(await budget.acquire(128 * 1024));
    await expect(buffer.reserveForParse(encoder.encode("x".repeat(40000)))).rejects.toThrow(
      expect.objectContaining({ statusCode: 429 })
    );
    expect(buffer.retainedByteLength).toBe(0);
    expect(governor.snapshot().usedBytes).toBe(128 * 1024);
    buffer.clear();
    buffer.clear();
    expect(governor.snapshot().usedBytes).toBe(0);
    expect(budget.snapshot().reservedBytes).toBe(0);
  });

  it("旁路不产生租约，重复转交被拒绝", async () => {
    const buffer = new DiscoveryPrebuffer();
    buffer.attachLease(undefined);
    await buffer.reserveForParse(encoder.encode("data"));
    buffer.append(encoder.encode("data"));
    buffer.finishParsing();
    expect(buffer.takeOwned().lease).toBeNull();
    const budget = new StreamGatePrebufferBudget(() => 1024);
    const lease = await budget.acquire(128);
    buffer.attachLease(lease);
    expect(buffer.hasLease).toBe(true);
    expect(() => buffer.attachLease(lease)).toThrow("already owns");
    buffer.clear();
    expect(buffer.hasLease).toBe(false);
  });
});
