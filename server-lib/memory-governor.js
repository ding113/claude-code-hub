"use strict";

const { createMemoryPlan } = require("./memory-plan");
const { readResourceSnapshot } = require("./resource-snapshot");
const { MEMORY_CREDIT_MESSAGE } = require("./memory-coordinator");
const CREDIT_BYTES = 1024 * 1024;
const ADMISSION_WAIT_MS = 20_000;

class LocalCapacityError extends Error {
  constructor() {
    super("Local request capacity exhausted; retry later.");
    this.name = "LocalCapacityError";
    this.statusCode = 429;
    this[Symbol.for("cch.localCapacityError")] = true;
  }
}
function isLocalCapacityError(error) {
  return error instanceof Error && error[Symbol.for("cch.localCapacityError")] === true;
}

/** 小额本地记账，跨进程按 MiB 授权。增长必须立即成功，不能持有部分内存排队。 */
class MemoryGovernor {
  constructor(options = {}) {
    this.processRef = options.processRef || process;
    this.env = options.env || this.processRef.env || {};
    this.readSnapshot = options.readSnapshot || readResourceSnapshot;
    this.plan = createMemoryPlan({ env: this.env, snapshot: this.readSnapshot() });
    this.limit = options.limit ?? this.plan.hotBudgetBytes;
    this.ceiling = this.limit;
    this.used = 0;
    this.waiting = 0;
    this.peak = 0;
    this.rejected = 0;
    this.stages = {};
    this.credits = 0;
    this.nextId = 0;
    this.pending = null;
    this.healthy = 0;
    this.lastSwapIO = this.plan.swapIO || 0;
    this.remote = options.remote ?? (this.processRef.env.CCH_MEMORY_COORDINATED === "1" && typeof this.processRef.send === "function");
    if (this.remote) {
      this.processRef.on("message", (message) => {
        if (message?.type !== MEMORY_CREDIT_MESSAGE || message.id !== this.pending?.id) return;
        if (Number.isSafeInteger(message.bytes) && message.bytes >= 0) this.credits += message.bytes;
        const pending = this.pending;
        this.pending = null;
        pending.resolve();
      });
      this.processRef.on("disconnect", () => {
        const pending = this.pending;
        this.pending = null;
        pending?.resolve();
      });
    }
    if (options.monitor !== false) {
      this.timer = setInterval(() => this.sample(), 1000);
      this.timer.unref();
    }
  }

  sample() {
    if (this.remote) {
      const excess = Math.floor((this.credits - this.used) / CREDIT_BYTES) * CREDIT_BYTES;
      if (excess > 0 && this.processRef.connected) {
        this.credits -= excess;
        try { this.processRef.send({ type: MEMORY_CREDIT_MESSAGE, op: "release", bytes: excess }, () => {}); } catch {}
      }
      return;
    }
    const resource = this.readSnapshot();
    const plan = createMemoryPlan({ env: this.env, snapshot: resource });
    const safe = Math.min(this.ceiling, this.used + plan.hotBudgetBytes);
    const pressure = resource.memoryPressure >= 1 || (resource.swapIO || 0) > this.lastSwapIO;
    this.lastSwapIO = resource.swapIO || 0;
    if (pressure || safe < this.limit) {
      this.limit = pressure ? Math.min(safe, Math.floor(this.limit * 0.8)) : safe;
      this.healthy = 0;
    } else if (++this.healthy >= 10) {
      this.limit = Math.min(safe, this.limit + Math.max(CREDIT_BYTES, Math.floor(this.ceiling * 0.01)));
      this.healthy = 0;
    }
  }

  snapshot() {
    return { usedBytes: this.used, limitBytes: this.remote ? this.credits : this.limit, waiting: this.waiting, peakBytes: this.peak, rejected: this.rejected, source: this.plan.source, stages: this.stages };
  }

  observe(stage, milliseconds, bytes = 0) {
    if (!["admission", "body_read", "body_decode", "body_materialize", "gate"].includes(stage)) return;
    const current = this.stages[stage] || { count: 0, totalMs: 0, maxMs: 0, bytes: 0 };
    current.count++; current.totalMs += milliseconds; current.maxMs = Math.max(current.maxMs, milliseconds); current.bytes += bytes;
    this.stages[stage] = current;
  }

  requestCredits(bytes) {
    if (!this.remote || !this.processRef.connected) return Promise.resolve();
    if (this.pending) return this.pending.promise;
    const id = ++this.nextId;
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    this.pending = { id, promise, resolve };
    const requested = Math.ceil(Math.max(bytes, CREDIT_BYTES) / CREDIT_BYTES) * CREDIT_BYTES;
    try {
      this.processRef.send({ type: MEMORY_CREDIT_MESSAGE, op: "acquire", id, bytes: requested }, (error) => {
        if (error && this.pending?.id === id) { this.pending = null; resolve(); }
      });
    } catch { this.pending = null; resolve(); }
    return promise;
  }

  tryLease(bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError("Invalid memory lease size");
    const limit = this.remote ? this.credits : this.limit;
    if (bytes > limit - this.used) return null;
    this.used += bytes;
    this.peak = Math.max(this.peak, this.used);
    let size = bytes;
    let released = false;
    return {
      get reservedBytes() { return size; },
      tryGrow: (target) => {
        if (!Number.isSafeInteger(target) || target < 0) throw new RangeError("Invalid memory lease size");
        if (released) return false;
        if (target <= size) return true;
        const delta = target - size;
        if (delta > (this.remote ? this.credits : this.limit) - this.used) {
          void this.requestCredits(delta);
          return false;
        }
        this.used += delta;
        size = target;
        this.peak = Math.max(this.peak, this.used);
        return true;
      },
      shrinkTo: (target) => {
        if (!Number.isSafeInteger(target) || target < 0) throw new RangeError("Invalid memory lease size");
        if (released || target >= size) return;
        this.used -= size - target;
        size = target;
      },
      release: () => {
        if (released) return;
        released = true;
        this.used -= size;
        size = 0;
      },
    };
  }

  async acquire(bytes, signal, waitMs = ADMISSION_WAIT_MS) {
    if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
    let lease = this.tryLease(bytes);
    if (lease) return lease;
    if (this.waiting >= 1024) { this.rejected++; throw new LocalCapacityError(); }
    const started = performance.now();
    const deadline = started + Math.min(ADMISSION_WAIT_MS, Math.max(0, waitMs));
    this.waiting++;
    try {
      while (!lease) {
        if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
        const remaining = deadline - performance.now();
        if (remaining <= 0) { this.rejected++; throw new LocalCapacityError(); }
        void this.requestCredits(bytes);
        await new Promise((resolve, reject) => {
          const onAbort = () => { clearTimeout(timer); reject(signal.reason || new DOMException("Aborted", "AbortError")); };
          const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, Math.min(50, remaining));
          signal?.addEventListener("abort", onAbort, { once: true });
          if (signal?.aborted) onAbort();
        });
        if (performance.now() >= deadline) { this.rejected++; throw new LocalCapacityError(); }
        lease = this.tryLease(bytes);
      }
      return lease;
    } finally { this.waiting--; this.observe("admission", performance.now() - started, bytes); }
  }
}

const KEY = Symbol.for("cch.memoryGovernor");
function getMemoryGovernor() {
  globalThis[KEY] ||= new MemoryGovernor();
  return globalThis[KEY];
}

module.exports = { MemoryGovernor, LocalCapacityError, isLocalCapacityError, getMemoryGovernor, ADMISSION_WAIT_MS };
