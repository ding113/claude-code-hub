import {
  getMemoryGovernor as getGovernor,
  isLocalCapacityError as isLocalError,
  LocalCapacityError,
} from "../../../server-lib/memory-governor";

export { LocalCapacityError };
export function isLocalCapacityError(
  error: unknown
): error is InstanceType<typeof LocalCapacityError> {
  return isLocalError(error);
}
export interface MemoryLease {
  readonly reservedBytes: number;
  tryGrow(bytes: number): boolean;
  tryGrowAsync?(bytes: number, signal?: AbortSignal, waitMs?: number): Promise<boolean>;
  shrinkTo(bytes: number): void;
  release(): void;
}
/** 租约标签只用于诊断台账，定位长期不归还的所有者。 */
export type MemoryLeaseTag = "body_read" | "body_decode" | "body_materialize" | "gate";
export interface MemoryLeaseLedger {
  count: number;
  oldestAgeMs: number;
  byTag: Record<string, { count: number; bytes: number; oldestAgeMs: number }>;
}
export interface MemoryGovernor {
  observe(
    stage: "admission" | "body_read" | "body_decode" | "body_materialize" | "gate",
    milliseconds: number,
    bytes?: number
  ): void;
  acquire(
    bytes: number,
    signal?: AbortSignal,
    waitMs?: number,
    tag?: MemoryLeaseTag
  ): Promise<MemoryLease>;
  tryLease(bytes: number, tag?: MemoryLeaseTag): MemoryLease | null;
  snapshot(): {
    usedBytes: number;
    limitBytes: number;
    waiting: number;
    peakBytes: number;
    rejected: number;
    source?: string;
    stages?: Record<string, { count: number; totalMs: number; maxMs: number; bytes: number }>;
    leases?: MemoryLeaseLedger;
  };
}
export const getMemoryGovernor: () => MemoryGovernor = getGovernor;
