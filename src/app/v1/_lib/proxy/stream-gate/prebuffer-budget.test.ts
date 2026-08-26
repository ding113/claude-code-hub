import { describe, expect, it } from "vitest";
import { StreamGatePrebufferBudget } from "./prebuffer-budget";

describe("StreamGatePrebufferBudget", () => {
  it("按 FIFO 等待并在前一份前缀释放后转交预算", async () => {
    const budget = new StreamGatePrebufferBudget(() => 64);
    const first = await budget.acquire(64);
    let secondResolved = false;
    const secondPromise = budget.acquire(32).then((lease) => {
      secondResolved = true;
      return lease;
    });

    await Promise.resolve();
    expect(secondResolved).toBe(false);
    expect(budget.snapshot()).toMatchObject({ reservedBytes: 64, waiting: 1 });

    first.release();
    const second = await secondPromise;
    expect(budget.snapshot()).toMatchObject({ reservedBytes: 32, waiting: 0 });
    second.release();
    expect(budget.snapshot().reservedBytes).toBe(0);
  });

  it("取消等待者时立即移出队列且不占用预算", async () => {
    const budget = new StreamGatePrebufferBudget(() => 64);
    const first = await budget.acquire(64);
    const controller = new AbortController();
    const waiting = budget.acquire(32, controller.signal);
    const following = budget.acquire(32);

    controller.abort(new Error("request aborted"));
    await expect(waiting).rejects.toThrow("request aborted");
    expect(budget.snapshot()).toMatchObject({ reservedBytes: 64, waiting: 1 });
    first.release();
    const admitted = await following;
    expect(budget.snapshot()).toMatchObject({ reservedBytes: 32, waiting: 0 });
    admitted.release();
  });

  it("提交后收缩租约并唤醒等待者", async () => {
    const budget = new StreamGatePrebufferBudget(() => 64);
    const first = await budget.acquire(64);
    const waiting = budget.acquire(32);

    first.shrinkTo(16);
    expect(first.reservedBytes).toBe(16);
    expect(budget.snapshot()).toMatchObject({ reservedBytes: 48, waiting: 0 });

    const second = await waiting;
    expect(budget.snapshot()).toMatchObject({ reservedBytes: 48, waiting: 0 });
    first.shrinkTo(8);
    expect(budget.snapshot().reservedBytes).toBe(40);
    first.shrinkTo(64);
    expect(budget.snapshot().reservedBytes).toBe(40);

    first.release();
    second.release();
    expect(budget.snapshot().reservedBytes).toBe(0);
  });
});
