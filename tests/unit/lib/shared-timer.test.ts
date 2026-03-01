import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { _getListenerCount, _isRunning, _reset, subscribeToTick } from "@/lib/shared-timer";

beforeEach(() => {
  vi.useFakeTimers();
  _reset();
});

afterEach(() => {
  _reset();
  vi.useRealTimers();
});

describe("shared-timer", () => {
  test("timer starts on first subscriber and stops when last unsubscribes", () => {
    expect(_isRunning()).toBe(false);
    expect(_getListenerCount()).toBe(0);

    const unsub1 = subscribeToTick(() => {});
    expect(_isRunning()).toBe(true);
    expect(_getListenerCount()).toBe(1);

    const unsub2 = subscribeToTick(() => {});
    expect(_getListenerCount()).toBe(2);

    unsub1();
    expect(_isRunning()).toBe(true);
    expect(_getListenerCount()).toBe(1);

    unsub2();
    expect(_isRunning()).toBe(false);
    expect(_getListenerCount()).toBe(0);
  });

  test("tick fires every 10 seconds and calls all listeners", () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    subscribeToTick(fn1);
    subscribeToTick(fn2);

    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000);
    expect(fn1).toHaveBeenCalledTimes(2);
    expect(fn2).toHaveBeenCalledTimes(2);
  });

  test("unsubscribed listener is no longer called", () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    const unsub1 = subscribeToTick(fn1);
    subscribeToTick(fn2);

    vi.advanceTimersByTime(10_000);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);

    unsub1();

    vi.advanceTimersByTime(10_000);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(2);
  });

  test("_reset clears all state", () => {
    subscribeToTick(() => {});
    subscribeToTick(() => {});
    expect(_isRunning()).toBe(true);
    expect(_getListenerCount()).toBe(2);

    _reset();
    expect(_isRunning()).toBe(false);
    expect(_getListenerCount()).toBe(0);
  });

  test("double unsubscribe is safe", () => {
    const unsub = subscribeToTick(() => {});
    unsub();
    expect(() => unsub()).not.toThrow();
    expect(_getListenerCount()).toBe(0);
  });

  test("a throwing listener does not prevent other listeners from firing", () => {
    const fn1 = vi.fn(() => {
      throw new Error("boom");
    });
    const fn2 = vi.fn();

    subscribeToTick(fn1);
    subscribeToTick(fn2);

    vi.advanceTimersByTime(10_000);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });
});
