import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryGovernor, LocalCapacityError } from "../../server-lib/memory-governor";
import {
  createMemoryCoordinator,
  MEMORY_CREDIT_MESSAGE,
} from "../../server-lib/memory-coordinator";

afterEach(() => vi.useRealTimers());
describe("内存租约与本地准入", () => {
  it("20 秒拒绝，并移除等待者", async () => {
    vi.useFakeTimers();
    const governor = new MemoryGovernor({ limit: 1024, remote: false, monitor: false });
    const occupied = await governor.acquire(1024);
    const waiting = governor.acquire(1);
    const assertion = expect(waiting).rejects.toBeInstanceOf(LocalCapacityError);
    await vi.advanceTimersByTimeAsync(20000);
    await assertion;
    expect(governor.snapshot()).toMatchObject({ waiting: 0, rejected: 1, usedBytes: 1024 });
    occupied.release();
    occupied.release();
    expect(governor.snapshot().usedBytes).toBe(0);
  });
  it("扩容失败立即返回，不能持有部分工作集进入等待", async () => {
    const governor = new MemoryGovernor({ limit: 1024, remote: false, monitor: false });
    const first = await governor.acquire(512);
    const second = await governor.acquire(512);
    expect(first.tryGrow(1024)).toBe(false);
    expect(governor.snapshot().waiting).toBe(0);
    second.release();
    expect(first.tryGrow(1024)).toBe(true);
    first.shrinkTo(100);
    first.release();
    expect(first.tryGrow(1)).toBe(false);
  });
  it("客户端断开立即移除准入等待", async () => {
    const governor = new MemoryGovernor({ limit: 0, remote: false, monitor: false });
    const abort = new AbortController();
    const promise = governor.acquire(1, abort.signal);
    abort.abort(new Error("closed"));
    await expect(promise).rejects.toThrow("closed");
    expect(governor.snapshot().waiting).toBe(0);
  });
  it("不平均分配，退出确认后才回收旧 worker 授权", () => {
    const coordinator = createMemoryCoordinator({
      env: { CCH_MEMORY_BUDGET_BYTES: "1048576" },
      readSnapshot: () => ({ availableRamBytes: 2 ** 30, availableSwapBytes: 0 }),
    });
    const worker = () => Object.assign(new EventEmitter(), { send: vi.fn() });
    const a = worker();
    const b = worker();
    coordinator.attach(a);
    coordinator.attach(b);
    a.emit("message", { type: MEMORY_CREDIT_MESSAGE, op: "acquire", id: 1, bytes: 1048576 });
    expect(a.send).toHaveBeenLastCalledWith(expect.objectContaining({ bytes: 1048576 }));
    b.emit("message", { type: MEMORY_CREDIT_MESSAGE, op: "acquire", id: 1, bytes: 1 });
    expect(b.send).toHaveBeenLastCalledWith(expect.objectContaining({ bytes: 0 }));
    a.emit("disconnect");
    expect(coordinator.snapshot().grantedBytes).toBe(1048576);
    a.emit("exit");
    expect(coordinator.snapshot().grantedBytes).toBe(0);
    a.emit("message", { type: MEMORY_CREDIT_MESSAGE, op: "acquire", id: 2, bytes: 1048576 });
    expect(coordinator.snapshot().grantedBytes).toBe(0);
  });
  it("worker 按小批量申请、归还和借用额度，旧回复不能重复授权", async () => {
    vi.useFakeTimers();
    const coordinator = createMemoryCoordinator({
      env: { CCH_MEMORY_BUDGET_BYTES: "1048576" },
      readSnapshot: () => ({ availableRamBytes: 2 ** 30, availableSwapBytes: 0 }),
    });
    const worker = Object.assign(new EventEmitter(), {
      send: (message: unknown) => child.emit("message", message),
    });
    const child = Object.assign(new EventEmitter(), {
      env: {},
      connected: true,
      send: (message: unknown, callback: (error?: Error) => void) => {
        worker.emit("message", message);
        callback?.();
      },
    });
    coordinator.attach(worker);
    const governor = new MemoryGovernor({ processRef: child, remote: true, monitor: false });
    const acquiring = governor.acquire(128 * 1024);
    await vi.advanceTimersByTimeAsync(50);
    const lease = await acquiring;
    expect(coordinator.snapshot().grantedBytes).toBe(1048576);
    expect(lease.tryGrow(256 * 1024)).toBe(true);
    child.emit("message", { type: MEMORY_CREDIT_MESSAGE, id: 999, bytes: 1048576 });
    expect(governor.snapshot().limitBytes).toBe(1048576);
    lease.release();
    governor.sample();
    expect(coordinator.snapshot().grantedBytes).toBe(0);
    expect(governor.snapshot().limitBytes).toBe(0);
    worker.emit("exit");
  });
  it("IPC 发送失败或断开时停止取得新授权", async () => {
    const child = Object.assign(new EventEmitter(), {
      env: {},
      connected: true,
      send: vi.fn(() => {
        throw new Error("closed");
      }),
    });
    const governor = new MemoryGovernor({ processRef: child, remote: true, monitor: false });
    await governor.requestCredits(100);
    expect(governor.snapshot().limitBytes).toBe(0);
    child.send.mockImplementation((_message: unknown, callback: (error?: Error) => void) =>
      callback(new Error("send failed"))
    );
    await governor.requestCredits(100);
    child.connected = false;
    child.emit("disconnect");
    await expect(governor.acquire(1, undefined, 0)).rejects.toBeInstanceOf(LocalCapacityError);
  });
  it("运行时缩容不会撤销在用租约，恢复不得超过固定启动上限", async () => {
    let ram = 2 ** 30;
    let pressure = 0;
    const governor = new MemoryGovernor({
      remote: false,
      monitor: false,
      readSnapshot: () => ({
        availableRamBytes: ram,
        availableSwapBytes: 0,
        memoryPressure: pressure,
      }),
    });
    const ceiling = governor.snapshot().limitBytes;
    const lease = await governor.acquire(1024);
    pressure = 5;
    ram = 1024;
    governor.sample();
    expect(governor.snapshot().limitBytes).toBeLessThan(ceiling);
    expect(governor.snapshot().usedBytes).toBe(1024);
    lease.release();
    pressure = 0;
    ram = 16 * 2 ** 30;
    for (let i = 0; i < 2000; i++) governor.sample();
    expect(governor.snapshot().limitBytes).toBe(ceiling);
    expect(() => governor.tryLease(-1)).toThrow();
  });
  it("主进程压缩目标有滞回，启动基线只能更新一次", () => {
    let ram = 2 ** 30;
    let pressure = 0;
    const coordinator = createMemoryCoordinator({
      env: {},
      readSnapshot: () => ({
        availableRamBytes: ram,
        availableSwapBytes: 0,
        memoryPressure: pressure,
      }),
    });
    coordinator.resetBaseline();
    const ceiling = coordinator.snapshot().targetBytes;
    pressure = 5;
    coordinator.sample();
    expect(coordinator.snapshot().targetBytes).toBeLessThan(ceiling);
    pressure = 0;
    ram = 16 * 2 ** 30;
    coordinator.resetBaseline();
    for (let i = 0; i < 2000; i++) coordinator.sample();
    expect(coordinator.snapshot().targetBytes).toBe(ceiling);
  });
});
