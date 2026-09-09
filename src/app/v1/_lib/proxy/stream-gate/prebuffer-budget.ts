import { getEnvConfig } from "@/lib/config/env.schema";
import {
  getMemoryGovernor,
  LocalCapacityError,
  type MemoryGovernor,
  type MemoryLease,
} from "@/lib/memory/governor";

const DEFAULT_STREAM_GATE_GLOBAL_PREBUFFER_BYTE_CAP = 256 * 1024 * 1024;

export interface StreamGatePrebufferLease {
  readonly reservedBytes: number;
  tryGrow(reservedBytes: number): boolean;
  readPrefix?: () => Promise<Uint8Array | null>;
  /** 提交后只保留实际仍被前缀占用的预算；不能扩大原始租约。 */
  shrinkTo(reservedBytes: number): void;
  release(): void;
}

type PendingAcquire = {
  reservedBytes: number;
  signal?: AbortSignal;
  onAbort?: () => void;
  resolve: (lease: StreamGatePrebufferLease) => void;
  reject: (error: unknown) => void;
  previous: PendingAcquire | null;
  next: PendingAcquire | null;
  queued: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

/**
 * 流门禁的进程级共享预算。
 *
 * 发起上游前预留小额工作集，前缀按实际占用增长。首次准入最多等待 20 秒，
 * 增长失败由调用方暂存到磁盘；本地压力不归因于供应商健康。
 */
export class StreamGatePrebufferBudget {
  private reservedBytes = 0;
  private waiterHead: PendingAcquire | null = null;
  private waiterTail: PendingAcquire | null = null;
  private waitingCount = 0;

  constructor(
    private readonly resolveLimit: () => number,
    private readonly governor?: MemoryGovernor
  ) {}

  async acquire(reservedBytes: number, signal?: AbortSignal): Promise<StreamGatePrebufferLease> {
    const started = performance.now();
    // 先等本地子限额，排队者不占用全局正文额度；两个阶段共用 20 秒期限。
    const local = await this.acquireLocal(reservedBytes, signal);
    let shared: MemoryLease | undefined;
    try {
      shared = await this.governor?.acquire(
        reservedBytes,
        signal,
        Math.max(0, 20000 - (performance.now() - started))
      );
    } catch (error) {
      local.release();
      throw error;
    }
    if (!shared) return local;
    return {
      get reservedBytes() {
        return local.reservedBytes;
      },
      tryGrow: (bytes) => {
        const before = local.reservedBytes;
        if (!local.tryGrow(bytes)) return false;
        if (shared.tryGrow(bytes)) return true;
        local.shrinkTo(before);
        return false;
      },
      shrinkTo: (bytes) => {
        local.shrinkTo(bytes);
        shared.shrinkTo(bytes);
      },
      release: () => {
        local.release();
        shared.release();
      },
    };
  }

  private acquireLocal(
    reservedBytes: number,
    signal?: AbortSignal,
    waitMs = 20000
  ): Promise<StreamGatePrebufferLease> {
    if (!Number.isSafeInteger(reservedBytes) || reservedBytes <= 0) {
      return Promise.reject(
        new RangeError("Stream gate reservation must be a positive safe integer")
      );
    }

    const limit = this.resolveLimit();
    if (!Number.isSafeInteger(limit) || limit <= 0 || reservedBytes > limit) {
      return Promise.reject(
        new RangeError("Stream gate reservation exceeds the global prebuffer budget")
      );
    }
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }
    if (this.waitingCount === 0 && this.reservedBytes + reservedBytes <= limit) {
      return Promise.resolve(this.createLease(reservedBytes));
    }

    if (this.waitingCount >= 1024) return Promise.reject(new LocalCapacityError());
    return new Promise<StreamGatePrebufferLease>((resolve, reject) => {
      const waiter: PendingAcquire = {
        reservedBytes,
        signal,
        resolve,
        reject,
        previous: null,
        next: null,
        queued: false,
      };
      waiter.timer = setTimeout(() => {
        if (!this.removeWaiter(waiter)) return;
        reject(new LocalCapacityError());
        this.drainWaiters();
      }, waitMs);
      if (signal) {
        waiter.onAbort = () => {
          if (!this.removeWaiter(waiter)) return;
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
          this.drainWaiters();
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.enqueueWaiter(waiter);
      this.drainWaiters();
    });
  }

  snapshot(): { reservedBytes: number; waiting: number; limit: number } {
    return {
      reservedBytes: this.reservedBytes,
      waiting: this.waitingCount,
      limit: this.resolveLimit(),
    };
  }

  private enqueueWaiter(waiter: PendingAcquire): void {
    waiter.queued = true;
    waiter.previous = this.waiterTail;
    if (this.waiterTail) this.waiterTail.next = waiter;
    else this.waiterHead = waiter;
    this.waiterTail = waiter;
    this.waitingCount += 1;
  }

  private removeWaiter(waiter: PendingAcquire): boolean {
    if (!waiter.queued) return false;
    clearTimeout(waiter.timer);
    if (waiter.onAbort) waiter.signal?.removeEventListener("abort", waiter.onAbort);
    if (waiter.previous) waiter.previous.next = waiter.next;
    else this.waiterHead = waiter.next;
    if (waiter.next) waiter.next.previous = waiter.previous;
    else this.waiterTail = waiter.previous;
    waiter.previous = null;
    waiter.next = null;
    waiter.queued = false;
    this.waitingCount -= 1;
    return true;
  }

  private createLease(reservedBytes: number): StreamGatePrebufferLease {
    this.reservedBytes += reservedBytes;
    let currentReservedBytes = reservedBytes;
    let released = false;
    return {
      get reservedBytes() {
        return currentReservedBytes;
      },
      tryGrow: (nextReservedBytes: number) => {
        if (!Number.isSafeInteger(nextReservedBytes) || nextReservedBytes < 0)
          throw new RangeError("Invalid lease size");
        if (released) return false;
        if (nextReservedBytes <= currentReservedBytes) return true;
        const delta = nextReservedBytes - currentReservedBytes;
        if (delta > this.resolveLimit() - this.reservedBytes) return false;
        this.reservedBytes += delta;
        currentReservedBytes = nextReservedBytes;
        return true;
      },
      shrinkTo: (nextReservedBytes: number) => {
        if (!Number.isSafeInteger(nextReservedBytes) || nextReservedBytes < 0) {
          throw new RangeError("Stream gate lease size must be a non-negative safe integer");
        }
        if (released || nextReservedBytes >= currentReservedBytes) return;
        this.reservedBytes -= currentReservedBytes - nextReservedBytes;
        currentReservedBytes = nextReservedBytes;
        this.drainWaiters();
      },
      release: () => {
        if (released) return;
        released = true;
        this.reservedBytes -= currentReservedBytes;
        currentReservedBytes = 0;
        this.drainWaiters();
      },
    };
  }

  private drainWaiters(): void {
    while (this.waiterHead) {
      const waiter = this.waiterHead;
      if (waiter.signal?.aborted) {
        this.removeWaiter(waiter);
        if (waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
        waiter.reject(waiter.signal.reason ?? new DOMException("Aborted", "AbortError"));
        continue;
      }

      const limit = this.resolveLimit();
      if (this.reservedBytes + waiter.reservedBytes > limit) return;
      this.removeWaiter(waiter);
      if (waiter.onAbort && waiter.signal) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
      }
      waiter.resolve(this.createLease(waiter.reservedBytes));
    }
  }
}

export function resolveStreamGateGlobalPrebufferByteCap(
  readEnv: () => ReturnType<typeof getEnvConfig> = getEnvConfig
): number {
  try {
    return (
      readEnv().STREAM_GATE_GLOBAL_PREBUFFER_BYTE_CAP ??
      DEFAULT_STREAM_GATE_GLOBAL_PREBUFFER_BYTE_CAP
    );
  } catch {
    return DEFAULT_STREAM_GATE_GLOBAL_PREBUFFER_BYTE_CAP;
  }
}

const STREAM_GATE_PREBUFFER_BUDGET_SYMBOL = Symbol.for("cch.streamGatePrebufferBudget");

export function getStreamGatePrebufferBudget(): StreamGatePrebufferBudget {
  const globalState = globalThis as typeof globalThis & {
    [STREAM_GATE_PREBUFFER_BUDGET_SYMBOL]?: StreamGatePrebufferBudget;
  };
  globalState[STREAM_GATE_PREBUFFER_BUDGET_SYMBOL] ??= new StreamGatePrebufferBudget(
    () =>
      process.env.STREAM_GATE_GLOBAL_PREBUFFER_BYTE_CAP
        ? resolveStreamGateGlobalPrebufferByteCap()
        : Number.MAX_SAFE_INTEGER,
    getMemoryGovernor()
  );
  return globalState[STREAM_GATE_PREBUFFER_BUDGET_SYMBOL];
}
