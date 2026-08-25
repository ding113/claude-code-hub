import { getEnvConfig } from "@/lib/config/env.schema";

const DEFAULT_STREAM_GATE_GLOBAL_PREBUFFER_BYTE_CAP = 256 * 1024 * 1024;

export interface StreamGatePrebufferLease {
  readonly reservedBytes: number;
  release(): void;
}

type PendingAcquire = {
  reservedBytes: number;
  signal?: AbortSignal;
  onAbort?: () => void;
  resolve: (lease: StreamGatePrebufferLease) => void;
  reject: (error: unknown) => void;
};

/**
 * 流门禁的进程级共享预算。
 *
 * 每个门禁在读取上游前预留自身最坏缓冲量；预算不足时排队，让上游
 * ReadableStream 的背压接管，而不是关闭门禁或把本地资源压力误报成供应商故障。
 */
export class StreamGatePrebufferBudget {
  private reservedBytes = 0;
  private readonly waiters: PendingAcquire[] = [];

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
    if (this.waiters.length === 0 && this.reservedBytes + reservedBytes <= limit) {
      return Promise.resolve(this.createLease(reservedBytes));
    }

    return new Promise<StreamGatePrebufferLease>((resolve, reject) => {
      const waiter: PendingAcquire = { reservedBytes, signal, resolve, reject };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
          this.drainWaiters();
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
      this.drainWaiters();
    });
  }

  snapshot(): { reservedBytes: number; waiting: number; limit: number } {
    return {
      reservedBytes: this.reservedBytes,
      waiting: this.waiters.length,
      limit: this.resolveLimit(),
    };
  }

  private createLease(reservedBytes: number): StreamGatePrebufferLease {
    this.reservedBytes += reservedBytes;
    let released = false;
    return {
      reservedBytes,
      release: () => {
        if (released) return;
        released = true;
        this.reservedBytes -= reservedBytes;
        this.drainWaiters();
      },
    };
  }

  private drainWaiters(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters[0];
      if (!waiter) return;
      if (waiter.signal?.aborted) {
        this.waiters.shift();
        if (waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
        waiter.reject(waiter.signal.reason ?? new DOMException("Aborted", "AbortError"));
        continue;
      }

      const limit = this.resolveLimit();
      if (this.reservedBytes + waiter.reservedBytes > limit) return;
      this.waiters.shift();
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
