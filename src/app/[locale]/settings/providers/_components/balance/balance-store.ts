// 供应商余额的前端批量加载存储
//
// 行内组件进入视口后调用 request() 登记自己，存储把短时间内登记的供应商
// 合并成一批请求，按固定批量大小顺序发出，避免一次性打出几十个请求。
// 存储与 React 无关，可以直接单元测试。

import type { ProviderBalanceMap, ProviderBalanceSnapshot } from "@/types/provider-balance";

export type ProviderBalanceEntryStatus = "idle" | "loading" | "ready";

export interface ProviderBalanceEntry {
  snapshot: ProviderBalanceSnapshot | null;
  status: ProviderBalanceEntryStatus;
}

export type FetchProviderBalances = (
  providerIds: number[],
  options: { refresh: boolean }
) => Promise<ProviderBalanceMap>;

export interface ProviderBalanceStoreOptions {
  fetchBalances: FetchProviderBalances;
  /** 单批请求携带的供应商数量 */
  batchSize?: number;
  /** 登记后等待合并的时间（毫秒） */
  batchDelayMs?: number;
  /** 定时器注入点，测试中替换为可控实现 */
  scheduleFlush?: (run: () => void, delayMs: number) => () => void;
}

export const DEFAULT_BALANCE_BATCH_SIZE = 20;
export const DEFAULT_BALANCE_BATCH_DELAY_MS = 120;

const IDLE_ENTRY: ProviderBalanceEntry = Object.freeze({ snapshot: null, status: "idle" });

function defaultScheduleFlush(run: () => void, delayMs: number): () => void {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
}

export class ProviderBalanceStore {
  private readonly fetchBalances: FetchProviderBalances;
  private readonly batchSize: number;
  private readonly batchDelayMs: number;
  private readonly scheduleFlush: (run: () => void, delayMs: number) => () => void;

  private readonly entries = new Map<number, ProviderBalanceEntry>();
  private readonly listeners = new Map<number, Set<() => void>>();
  private readonly globalListeners = new Set<() => void>();

  /** 已登记过的供应商，重复登记不会重复请求 */
  private readonly tracked = new Set<number>();
  /** 等待发出的供应商，按登记顺序排队 */
  private queue: number[] = [];

  private cancelScheduledFlush: (() => void) | null = null;
  private flushScheduled = false;
  private flushing = false;
  private refreshingAll = false;
  private disposed = false;

  constructor(options: ProviderBalanceStoreOptions) {
    this.fetchBalances = options.fetchBalances;
    this.batchSize = Math.max(1, options.batchSize ?? DEFAULT_BALANCE_BATCH_SIZE);
    this.batchDelayMs = Math.max(0, options.batchDelayMs ?? DEFAULT_BALANCE_BATCH_DELAY_MS);
    this.scheduleFlush = options.scheduleFlush ?? defaultScheduleFlush;
  }

  subscribe(providerId: number, listener: () => void): () => void {
    const existing = this.listeners.get(providerId);
    if (existing) {
      existing.add(listener);
    } else {
      this.listeners.set(providerId, new Set([listener]));
    }

    return () => {
      const listeners = this.listeners.get(providerId);
      if (!listeners) return;
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(providerId);
    };
  }

  subscribeGlobal(listener: () => void): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  getEntry(providerId: number): ProviderBalanceEntry {
    return this.entries.get(providerId) ?? IDLE_ENTRY;
  }

  isRefreshingAll(): boolean {
    return this.refreshingAll;
  }

  getTrackedIds(): number[] {
    return Array.from(this.tracked);
  }

  /** 登记一个供应商，等待下一批请求把它带上 */
  request(providerId: number): void {
    if (this.disposed || this.tracked.has(providerId)) return;
    this.tracked.add(providerId);
    this.queue.push(providerId);
    this.scheduleNextFlush(this.batchDelayMs);
  }

  /** 强制刷新一个供应商，跳过服务端缓存 */
  async refresh(providerId: number): Promise<void> {
    if (this.disposed) return;
    this.tracked.add(providerId);
    this.queue = this.queue.filter((id) => id !== providerId);
    await this.load([providerId], true);
  }

  /** 强制刷新所有已登记的供应商 */
  async refreshAll(): Promise<void> {
    if (this.disposed || this.refreshingAll) return;
    const ids = this.getTrackedIds();
    if (ids.length === 0) return;

    this.refreshingAll = true;
    this.notifyGlobal();
    try {
      for (let index = 0; index < ids.length; index += this.batchSize) {
        await this.load(ids.slice(index, index + this.batchSize), true);
      }
    } finally {
      this.refreshingAll = false;
      this.notifyGlobal();
    }
  }

  /** 按服务端缓存策略重新读取已登记的供应商，用于定时自动更新 */
  async revalidateTracked(): Promise<void> {
    if (this.disposed) return;
    const ids = this.getTrackedIds().filter((id) => !this.queue.includes(id));
    for (let index = 0; index < ids.length; index += this.batchSize) {
      await this.load(ids.slice(index, index + this.batchSize), false);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancelScheduledFlush?.();
    this.cancelScheduledFlush = null;
    this.flushScheduled = false;
    this.queue = [];
  }

  private scheduleNextFlush(delayMs: number): void {
    if (this.flushing || this.flushScheduled || this.queue.length === 0) return;

    this.flushScheduled = true;
    const cancel = this.scheduleFlush(() => {
      this.flushScheduled = false;
      this.cancelScheduledFlush = null;
      void this.flush();
    }, delayMs);

    // 调度器同步执行回调时，上面的回调已经跑完，这个句柄已经过期，留下它会挡住后续批次
    if (this.flushScheduled) {
      this.cancelScheduledFlush = cancel;
    }
  }

  private async flush(): Promise<void> {
    if (this.disposed || this.flushing) return;
    const batch = this.queue.splice(0, this.batchSize);
    if (batch.length === 0) return;

    this.flushing = true;
    try {
      await this.load(batch, false);
    } catch {
      // 队列驱动的加载没有调用方接手失败；条目已回到就绪状态，继续处理后续批次
    } finally {
      this.flushing = false;
    }

    this.scheduleNextFlush(0);
  }

  private async load(providerIds: number[], refresh: boolean): Promise<void> {
    if (providerIds.length === 0) return;

    for (const providerId of providerIds) {
      this.setEntry(providerId, {
        snapshot: this.getEntry(providerId).snapshot,
        status: "loading",
      });
    }

    let balances: ProviderBalanceMap = {};
    try {
      balances = await this.fetchBalances(providerIds, { refresh });
    } finally {
      for (const providerId of providerIds) {
        const snapshot = balances[providerId] ?? this.getEntry(providerId).snapshot;
        this.setEntry(providerId, { snapshot, status: "ready" });
      }
    }
  }

  private setEntry(providerId: number, entry: ProviderBalanceEntry): void {
    const previous = this.getEntry(providerId);
    if (previous.snapshot === entry.snapshot && previous.status === entry.status) return;
    this.entries.set(providerId, entry);
    this.notify(providerId);
  }

  private notify(providerId: number): void {
    const listeners = this.listeners.get(providerId);
    if (!listeners) return;
    for (const listener of Array.from(listeners)) listener();
  }

  private notifyGlobal(): void {
    for (const listener of Array.from(this.globalListeners)) listener();
  }
}
