// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalAdmissionClock } from "@/app/v1/_lib/proxy/local-admission-clock";

describe("local admission clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves remaining provider budget across overlapping waits", async () => {
    const clock = new LocalAdmissionClock();
    const expired = vi.fn();
    clock.schedule(expired, 100);
    await vi.advanceTimersByTimeAsync(30);
    const resumeFirst = clock.pause();
    await vi.advanceTimersByTimeAsync(40);
    const resumeSecond = clock.pause();
    await vi.advanceTimersByTimeAsync(100);
    resumeFirst();
    resumeFirst();
    await vi.advanceTimersByTimeAsync(100);
    expect(clock.now()).toBe(30);
    expect(expired).not.toHaveBeenCalled();
    resumeSecond();
    await vi.advanceTimersByTimeAsync(69);
    expect(expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(clock.now()).toBe(100);
    clock.dispose();
  });

  it("can schedule and cancel deadlines while paused", async () => {
    const clock = new LocalAdmissionClock();
    const resume = clock.pause();
    const expired = vi.fn();
    const cancelled = vi.fn();
    clock.schedule(expired, 50);
    clock.schedule(cancelled, 10)();
    await vi.advanceTimersByTimeAsync(1000);
    resume();
    await vi.advanceTimersByTimeAsync(50);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
    clock.dispose();
  });

  it("does not restart timers when cancelled attempts resume after disposal", async () => {
    const clock = new LocalAdmissionClock();
    const expired = vi.fn();
    clock.schedule(expired, 10);
    const resume = clock.pause();
    clock.dispose();
    resume();
    clock.schedule(expired, 10);
    await vi.advanceTimersByTimeAsync(1000);
    expect(expired).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
