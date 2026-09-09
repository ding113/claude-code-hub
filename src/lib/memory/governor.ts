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
  shrinkTo(bytes: number): void;
  release(): void;
}
export interface MemoryGovernor {
  observe(
    stage: "admission" | "body_read" | "body_decode" | "body_materialize" | "gate",
    milliseconds: number,
    bytes?: number
  ): void;
  acquire(bytes: number, signal?: AbortSignal, waitMs?: number): Promise<MemoryLease>;
  tryLease(bytes: number): MemoryLease | null;
  snapshot(): {
    usedBytes: number;
    limitBytes: number;
    waiting: number;
    peakBytes: number;
    rejected: number;
  };
}
export const getMemoryGovernor: () => MemoryGovernor = getGovernor;
