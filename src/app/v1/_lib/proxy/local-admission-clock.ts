type ScheduledDeadline = {
  at: number;
  callback: () => void;
  timer: ReturnType<typeof setTimeout> | null;
};

/** Provider deadlines exclude the union of concurrent local admission waits. */
export class LocalAdmissionClock {
  private pausedAt: number | null = null;
  private pausedMs = 0;
  private waiters = 0;
  private disposed = false;
  private readonly deadlines = new Set<ScheduledDeadline>();

  now(): number {
    return (this.pausedAt ?? Date.now()) - this.pausedMs;
  }

  pause(): () => void {
    if (this.disposed) return () => {};
    this.waiters += 1;
    if (this.waiters === 1) {
      this.pausedAt = Date.now();
      for (const deadline of this.deadlines) {
        if (deadline.timer) clearTimeout(deadline.timer);
        deadline.timer = null;
      }
    }
    let resumed = false;
    return () => {
      if (resumed || this.disposed) return;
      resumed = true;
      this.waiters -= 1;
      if (this.waiters !== 0) return;
      this.pausedMs += Date.now() - this.pausedAt!;
      this.pausedAt = null;
      for (const deadline of this.deadlines) this.arm(deadline);
    };
  }

  schedule(callback: () => void, delayMs: number): () => void {
    if (this.disposed) return () => {};
    const deadline: ScheduledDeadline = {
      at: this.now() + Math.max(0, delayMs),
      callback,
      timer: null,
    };
    this.deadlines.add(deadline);
    if (this.waiters === 0) this.arm(deadline);
    return () => {
      this.deadlines.delete(deadline);
      if (deadline.timer) clearTimeout(deadline.timer);
      deadline.timer = null;
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const deadline of this.deadlines) {
      if (deadline.timer) clearTimeout(deadline.timer);
    }
    this.deadlines.clear();
  }

  private arm(deadline: ScheduledDeadline): void {
    deadline.timer = setTimeout(
      () => {
        deadline.timer = null;
        if (this.disposed || this.waiters > 0 || !this.deadlines.delete(deadline)) return;
        deadline.callback();
      },
      Math.max(0, deadline.at - this.now())
    );
  }
}
