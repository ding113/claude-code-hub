import { describe, expect, it, vi } from "vitest";
import { ProviderBalanceStore } from "@/app/[locale]/settings/providers/_components/balance/balance-store";
import type { ProviderBalanceMap, ProviderBalanceSnapshot } from "@/types/provider-balance";

function snapshot(providerId: number, balance: number): ProviderBalanceSnapshot {
  return {
    providerId,
    status: "ok",
    source: "new-api-token-usage",
    balance,
    currency: "USD",
    totalGranted: null,
    totalUsed: null,
    unlimited: false,
    expiresAt: null,
    checkedAt: "2026-09-24T00:00:00.000Z",
    errorCode: null,
  };
}

function balanceMap(ids: number[]): ProviderBalanceMap {
  return Object.fromEntries(ids.map((id) => [id, snapshot(id, id)])) as ProviderBalanceMap;
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * 用真实定时器并把合并窗口设为 0：同步登记的供应商仍然会落到同一个宏任务里合并，
 * 与浏览器中的行为一致。
 */
function createStore(options?: {
  batchSize?: number;
  fetchBalances?: (ids: number[], options: { refresh: boolean }) => Promise<ProviderBalanceMap>;
}) {
  const fetchBalances = vi.fn(options?.fetchBalances ?? (async (ids: number[]) => balanceMap(ids)));
  const store = new ProviderBalanceStore({
    fetchBalances,
    batchDelayMs: 0,
    ...(options?.batchSize === undefined ? {} : { batchSize: options.batchSize }),
  });
  return { store, fetchBalances };
}

describe("ProviderBalanceStore 懒加载与批量合并", () => {
  it("把同一批登记合并成一次请求", async () => {
    const { store, fetchBalances } = createStore();

    store.request(1);
    store.request(2);
    store.request(3);

    await vi.waitFor(() => expect(store.getEntry(3).status).toBe("ready"));
    expect(fetchBalances).toHaveBeenCalledTimes(1);
    expect(fetchBalances).toHaveBeenCalledWith([1, 2, 3], { refresh: false });
  });

  it("超过批量大小时分批顺序发出", async () => {
    const { store, fetchBalances } = createStore({ batchSize: 2 });

    for (const id of [1, 2, 3, 4, 5]) store.request(id);

    await vi.waitFor(() => expect(store.getEntry(5).status).toBe("ready"));
    expect(fetchBalances.mock.calls.map((call) => call[0])).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("重复登记同一个供应商只请求一次", async () => {
    const { store, fetchBalances } = createStore();

    store.request(7);
    store.request(7);
    await vi.waitFor(() => expect(store.getEntry(7).status).toBe("ready"));

    store.request(7);
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(fetchBalances).toHaveBeenCalledTimes(1);
    expect(fetchBalances).toHaveBeenCalledWith([7], { refresh: false });
  });

  it("没有登记过的供应商保持 idle 状态", () => {
    const { store } = createStore();
    expect(store.getEntry(99)).toEqual({ snapshot: null, status: "idle" });
  });

  it("加载完成后通知订阅者并写入快照", async () => {
    const { store } = createStore();

    const listener = vi.fn();
    store.subscribe(4, listener);
    store.request(4);

    await vi.waitFor(() => expect(store.getEntry(4).status).toBe("ready"));
    expect(store.getEntry(4).snapshot?.balance).toBe(4);
    expect(listener).toHaveBeenCalled();
  });

  it("取消订阅后不再收到通知", async () => {
    const { store } = createStore();

    const listener = vi.fn();
    const unsubscribe = store.subscribe(2, listener);
    unsubscribe();

    store.request(2);
    await vi.waitFor(() => expect(store.getEntry(2).status).toBe("ready"));

    expect(listener).not.toHaveBeenCalled();
  });

  it("dispose 之后不再登记新的供应商", async () => {
    const { store, fetchBalances } = createStore();

    store.dispose();
    store.request(1);
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(fetchBalances).not.toHaveBeenCalled();
    expect(store.getTrackedIds()).toEqual([]);
  });

  it("队列中的请求失败时后续批次继续处理", async () => {
    const seen: number[][] = [];
    const { store } = createStore({
      batchSize: 1,
      fetchBalances: async (ids) => {
        seen.push(ids);
        if (ids[0] === 1) throw new Error("network down");
        return balanceMap(ids);
      },
    });

    store.request(1);
    store.request(2);

    await vi.waitFor(() => expect(store.getEntry(2).status).toBe("ready"));
    expect(seen).toEqual([[1], [2]]);
    expect(store.getEntry(1)).toEqual({ snapshot: null, status: "ready" });
    expect(store.getEntry(2).snapshot?.balance).toBe(2);
  });
});

describe("ProviderBalanceStore 手动与自动更新", () => {
  it("手动刷新单个供应商时跳过服务端缓存", async () => {
    const { store, fetchBalances } = createStore();

    await store.refresh(5);

    expect(fetchBalances).toHaveBeenCalledWith([5], { refresh: true });
    expect(store.getEntry(5).snapshot?.balance).toBe(5);
  });

  it("手动刷新会把该供应商从待发队列里移除，避免重复请求", async () => {
    const { store, fetchBalances } = createStore();

    store.request(6);
    await store.refresh(6);
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(fetchBalances).toHaveBeenCalledTimes(1);
    expect(fetchBalances).toHaveBeenCalledWith([6], { refresh: true });
  });

  it("刷新全部时按批量大小分批并带上强制刷新标记", async () => {
    const { store, fetchBalances } = createStore({ batchSize: 2 });

    for (const id of [1, 2, 3]) store.request(id);
    await vi.waitFor(() => expect(store.getEntry(3).status).toBe("ready"));
    fetchBalances.mockClear();

    await store.refreshAll();

    expect(fetchBalances.mock.calls).toEqual([
      [[1, 2], { refresh: true }],
      [[3], { refresh: true }],
    ]);
  });

  it("刷新全部期间对外暴露忙碌状态", async () => {
    const { store } = createStore();

    store.request(1);
    await vi.waitFor(() => expect(store.getEntry(1).status).toBe("ready"));

    const globalListener = vi.fn();
    store.subscribeGlobal(globalListener);

    const pending = store.refreshAll();
    expect(store.isRefreshingAll()).toBe(true);
    await pending;

    expect(store.isRefreshingAll()).toBe(false);
    expect(globalListener).toHaveBeenCalled();
  });

  it("没有任何登记时刷新全部不发请求", async () => {
    const { store, fetchBalances } = createStore();

    await store.refreshAll();
    expect(fetchBalances).not.toHaveBeenCalled();
  });

  it("自动更新按服务端缓存策略重新读取已登记的供应商", async () => {
    const { store, fetchBalances } = createStore({ batchSize: 2 });

    for (const id of [1, 2, 3]) store.request(id);
    await vi.waitFor(() => expect(store.getEntry(3).status).toBe("ready"));
    fetchBalances.mockClear();

    await store.revalidateTracked();

    expect(fetchBalances.mock.calls).toEqual([
      [[1, 2], { refresh: false }],
      [[3], { refresh: false }],
    ]);
  });

  it("手动刷新失败时保留上一次的快照并把失败交给调用方", async () => {
    let shouldFail = false;
    const { store } = createStore({
      fetchBalances: async (ids) => {
        if (shouldFail) throw new Error("network down");
        return balanceMap(ids);
      },
    });

    store.request(9);
    await vi.waitFor(() => expect(store.getEntry(9).snapshot?.balance).toBe(9));

    shouldFail = true;
    await expect(store.refresh(9)).rejects.toThrow("network down");

    expect(store.getEntry(9).status).toBe("ready");
    expect(store.getEntry(9).snapshot?.balance).toBe(9);
  });

  it("手动刷新先完成时，后完成的旧批次不会覆盖新快照", async () => {
    const staleBatch = deferred<void>();
    const { store } = createStore({
      fetchBalances: async (ids, options) => {
        if (!options.refresh) await staleBatch.promise;
        const balance = options.refresh ? 999 : 1;
        return Object.fromEntries(
          ids.map((id) => [id, snapshot(id, balance)])
        ) as ProviderBalanceMap;
      },
    });

    store.request(1);
    await vi.waitFor(() => expect(store.getEntry(1).status).toBe("loading"));

    await store.refresh(1);
    expect(store.getEntry(1).snapshot?.balance).toBe(999);

    staleBatch.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(store.getEntry(1).snapshot?.balance).toBe(999);
    expect(store.getEntry(1).status).toBe("ready");
  });

  it("自动更新中一批失败不会中断后续批次", async () => {
    const { store } = createStore({
      batchSize: 1,
      fetchBalances: async (ids) => {
        if (ids[0] === 1) throw new Error("network down");
        return balanceMap(ids);
      },
    });

    for (const id of [1, 2]) store.request(id);
    await vi.waitFor(() => expect(store.getEntry(2).snapshot?.balance).toBe(2));

    // 第 1 个供应商仍然失败，但第 2 个供应商必须照常刷新
    await expect(store.revalidateTracked()).resolves.toBeUndefined();
    expect(store.getEntry(2).snapshot?.balance).toBe(2);
  });

  it("刷新全部时一批失败仍处理其余批次并把失败交给调用方", async () => {
    let failFirst = false;
    const { store, fetchBalances } = createStore({
      batchSize: 1,
      fetchBalances: async (ids) => {
        if (failFirst && ids[0] === 1) throw new Error("network down");
        return balanceMap(ids);
      },
    });

    for (const id of [1, 2]) store.request(id);
    await vi.waitFor(() => expect(store.getEntry(2).status).toBe("ready"));

    failFirst = true;
    fetchBalances.mockClear();

    // 第 1 批失败后第 2 批仍然要发出，失败原因最后抛给调用方
    await expect(store.refreshAll()).rejects.toThrow("network down");

    expect(fetchBalances.mock.calls).toEqual([
      [[1], { refresh: true }],
      [[2], { refresh: true }],
    ]);
    expect(store.getEntry(2).snapshot?.balance).toBe(2);
    expect(store.isRefreshingAll()).toBe(false);
  });

  it("自动更新跳过正在强制刷新的供应商", async () => {
    const forced = deferred<void>();
    const { store, fetchBalances } = createStore({
      batchSize: 1,
      fetchBalances: async (ids, options) => {
        if (options.refresh) {
          await forced.promise;
          return Object.fromEntries(ids.map((id) => [id, snapshot(id, 999)])) as ProviderBalanceMap;
        }
        return balanceMap(ids);
      },
    });

    store.request(1);
    await vi.waitFor(() => expect(store.getEntry(1).status).toBe("ready"));
    fetchBalances.mockClear();

    const refreshing = store.refresh(1);
    // 强制刷新还在进行时，定时重读不能介入：它读到的是服务端旧快照
    await store.revalidateTracked();
    expect(fetchBalances.mock.calls).toEqual([[[1], { refresh: true }]]);

    forced.resolve();
    await refreshing;

    expect(store.getEntry(1).snapshot?.balance).toBe(999);
    expect(store.getEntry(1).status).toBe("ready");
  });

  it("强制刷新结束后自动更新恢复覆盖该供应商", async () => {
    const { store, fetchBalances } = createStore({ batchSize: 1 });

    store.request(1);
    await vi.waitFor(() => expect(store.getEntry(1).status).toBe("ready"));
    await store.refresh(1);

    fetchBalances.mockClear();
    await store.revalidateTracked();

    expect(fetchBalances.mock.calls).toEqual([[[1], { refresh: false }]]);
  });
});
