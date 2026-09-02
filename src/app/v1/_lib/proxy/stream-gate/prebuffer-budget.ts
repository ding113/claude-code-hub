import { getEnvConfig } from "@/lib/config/env.schema";

const DEFAULT_STREAM_GATE_GLOBAL_PREBUFFER_BYTE_CAP = 256 * 1024 * 1024;

export interface StreamGatePrebufferLease {
  readonly reservedBytes: number;
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
};

/**
 * 流门禁的进程级共享预算。
 *
 * 每个门禁在读取上游前预留自身最坏缓冲量；预算不足时排队，让上游
 * ReadableStream 的背压接管，而不是关闭门禁或把本地资源压力误报成供应商故障。
 */
export class StreamGatePrebufferBudget {
  private reservedBytes = 0;
  private waiterHead: PendingAcquire | null = null;
  private waiterTail: PendingAcquire | null = null;
  private waitingCount = 0;

  constructor(private readonly resolveLimit: () => number) {}

  acquire(reservedBytes: number, signal?: AbortSignal): Promise<StreamGatePrebufferLease> {
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
    resolveStreamGateGlobalPrebufferByteCap
  );
  return globalState[STREAM_GATE_PREBUFFER_BUDGET_SYMBOL];
}
