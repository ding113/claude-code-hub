import { getEnvConfig } from "@/lib/config/env.schema";

const DEFAULT_DETACHED_STREAM_MAX_CONCURRENCY = 64;
const DEFAULT_DETACHED_STREAM_BUDGET_BYTES = 64 * 1024 * 1024;
const DEFAULT_DETACHED_STREAM_METERING_RESERVE_BYTES = 16 * 1024 * 1024;

export type DetachedStreamLeaseKind = "metering" | "replay";

export interface DetachedStreamBudgetLimits {
  maxConcurrency: number;
  maxReservedBytes: number;
  meteringReserveBytes: number;
}

export interface DetachedStreamBudgetSnapshot {
  activeStreams: number;
  reservedBytes: number;
  activeByKind: Record<DetachedStreamLeaseKind, number>;
  reservedByKind: Record<DetachedStreamLeaseKind, number>;
  limits: DetachedStreamBudgetLimits;
}

export interface DetachedStreamLease {
  readonly kind: DetachedStreamLeaseKind;
  readonly reservedBytes: number;
  release(): void;
}

export type DetachedStreamAcquireResult =
  | { acquired: true; lease: DetachedStreamLease }
  | {
      acquired: false;
      reason: "concurrency_exhausted" | "memory_budget_exhausted" | "metering_reserve";
    };

function createKindCounters(): Record<DetachedStreamLeaseKind, number> {
  return { metering: 0, replay: 0 };
}

export class DetachedStreamBudget {
  private activeStreams = 0;
  private reservedBytes = 0;
  private readonly activeByKind = createKindCounters();
  private readonly reservedByKind = createKindCounters();

  /** Creates a process-local weighted detached-stream budget. */
  constructor(private readonly resolveLimits: () => DetachedStreamBudgetLimits) {}

  /** Attempts to reserve capacity for a metering or Replay detached stream. */
  tryAcquire(kind: DetachedStreamLeaseKind, reservedBytes: number): DetachedStreamAcquireResult {
    if (!Number.isSafeInteger(reservedBytes) || reservedBytes <= 0) {
      throw new RangeError("Detached stream reservation must be a positive safe integer");
    }

    const limits = this.resolveLimits();
    if (this.activeStreams >= limits.maxConcurrency) {
      return { acquired: false, reason: "concurrency_exhausted" };
    }

    const nextReservedBytes = this.reservedBytes + reservedBytes;
    if (nextReservedBytes > limits.maxReservedBytes) {
      return { acquired: false, reason: "memory_budget_exhausted" };
    }

    const effectiveMeteringReserve = Math.min(
      limits.maxReservedBytes,
      Math.max(0, limits.meteringReserveBytes)
    );
    if (
      kind === "replay" &&
      nextReservedBytes > limits.maxReservedBytes - effectiveMeteringReserve
    ) {
      return { acquired: false, reason: "metering_reserve" };
    }

    this.activeStreams += 1;
    this.reservedBytes = nextReservedBytes;
    this.activeByKind[kind] += 1;
    this.reservedByKind[kind] += reservedBytes;
    let released = false;

    return {
      acquired: true,
      lease: {
        kind,
        reservedBytes,
        release: () => {
          if (released) return;
          released = true;
          this.activeStreams = Math.max(0, this.activeStreams - 1);
          this.reservedBytes = Math.max(0, this.reservedBytes - reservedBytes);
          this.activeByKind[kind] = Math.max(0, this.activeByKind[kind] - 1);
          this.reservedByKind[kind] = Math.max(0, this.reservedByKind[kind] - reservedBytes);
        },
      },
    };
  }

  /** Returns current usage and configured limits for diagnostics and tests. */
  snapshot(): DetachedStreamBudgetSnapshot {
    return {
      activeStreams: this.activeStreams,
      reservedBytes: this.reservedBytes,
      activeByKind: { ...this.activeByKind },
      reservedByKind: { ...this.reservedByKind },
      limits: { ...this.resolveLimits() },
    };
  }
}

const DETACHED_STREAM_BUDGET_SYMBOL = Symbol.for("cch.detachedStreamBudget");

/** Resolves configured detached-stream limits, falling back if env parsing fails. */
export function resolveDetachedStreamBudgetLimits(
  readEnv: () => ReturnType<typeof getEnvConfig> = getEnvConfig
): DetachedStreamBudgetLimits {
  try {
    const env = readEnv();
    return {
      maxConcurrency:
        env.DETACHED_STREAM_MAX_CONCURRENCY ?? DEFAULT_DETACHED_STREAM_MAX_CONCURRENCY,
      maxReservedBytes: env.DETACHED_STREAM_BUDGET_BYTES ?? DEFAULT_DETACHED_STREAM_BUDGET_BYTES,
      meteringReserveBytes:
        env.DETACHED_STREAM_METERING_RESERVE_BYTES ??
        DEFAULT_DETACHED_STREAM_METERING_RESERVE_BYTES,
    };
  } catch {
    return {
      maxConcurrency: DEFAULT_DETACHED_STREAM_MAX_CONCURRENCY,
      maxReservedBytes: DEFAULT_DETACHED_STREAM_BUDGET_BYTES,
      meteringReserveBytes: DEFAULT_DETACHED_STREAM_METERING_RESERVE_BYTES,
    };
  }
}

function getDetachedStreamBudget(): DetachedStreamBudget {
  const globalState = globalThis as typeof globalThis & {
    [DETACHED_STREAM_BUDGET_SYMBOL]?: DetachedStreamBudget;
  };
  globalState[DETACHED_STREAM_BUDGET_SYMBOL] ??= new DetachedStreamBudget(
    resolveDetachedStreamBudgetLimits
  );
  return globalState[DETACHED_STREAM_BUDGET_SYMBOL];
}

/** Acquires a weighted detached-stream lease from the process budget. */
export function acquireDetachedStreamLease(
  kind: DetachedStreamLeaseKind,
  reservedBytes: number
): DetachedStreamAcquireResult {
  return getDetachedStreamBudget().tryAcquire(kind, reservedBytes);
}

/** Returns the singleton detached-stream budget snapshot. */
export function getDetachedStreamBudgetSnapshot(): DetachedStreamBudgetSnapshot {
  return getDetachedStreamBudget().snapshot();
}
