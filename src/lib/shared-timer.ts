import { logger } from "@/lib/logger";

type Listener = () => void;

const DEFAULT_INTERVAL_MS = 10_000;

let listeners = new Set<Listener>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function startIfNeeded(): void {
  if (intervalId !== null) return;
  intervalId = setInterval(() => {
    for (const listener of listeners) {
      try {
        listener();
      } catch (err) {
        logger.error("[shared-timer] subscriber threw", { error: err });
      }
    }
  }, DEFAULT_INTERVAL_MS);
}

function stopIfEmpty(): void {
  if (listeners.size > 0 || intervalId === null) return;
  clearInterval(intervalId);
  intervalId = null;
}

/**
 * Subscribe to the shared 10-second tick.
 * Auto-starts on first subscriber, auto-stops when the last unsubscribes.
 * Returns an unsubscribe function.
 */
export function subscribeToTick(listener: Listener): () => void {
  listeners.add(listener);
  startIfNeeded();
  return () => {
    listeners.delete(listener);
    stopIfEmpty();
  };
}

/** @internal Test-only: reset all state */
export function _reset(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  listeners = new Set();
}

/** @internal Test-only: get subscriber count */
export function _getListenerCount(): number {
  return listeners.size;
}

/** @internal Test-only: check if timer is running */
export function _isRunning(): boolean {
  return intervalId !== null;
}
