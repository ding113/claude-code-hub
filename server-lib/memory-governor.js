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

/** 小额本地记账，跨进程按 MiB 授权。增长只等待 IPC 协商，不持有部分内存排队等容量。 */
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
    this.releasedTotal = 0;
    this.pending = null;
    this.healthy = 0;
    this.lastSwapIO = this.plan.swapIO || 0;
    this.remote = options.remote ?? (this.processRef.env.CCH_MEMORY_COORDINATED === "1" && typeof this.processRef.send === "function");
    if (this.remote) {
      this.processRef.on("message", (message) => {
        if (message?.type !== MEMORY_CREDIT_MESSAGE || message.id !== this.pending?.id) return;
        if (!Number.isSafeInteger(message.bytes) || message.bytes < 0) return;
        this.credits += message.bytes;
        const pending = this.pending;
        clearTimeout(pending.timer);
        this.pending = null;
        pending.resolve({ requested: pending.requested, bytes: message.bytes });
      });
      this.processRef.on("disconnect", () => {
        const pending = this.pending;
        clearTimeout(pending?.timer);
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
      const excess = this.used === 0 ? this.credits : Math.floor((this.credits - this.used) / CREDIT_BYTES) * CREDIT_BYTES;
      if (this.processRef.connected) {
        if (excess > 0) { this.credits -= excess; this.releasedTotal += excess; }
        // 幂等心跳也修复空闲 worker 丢失归还消息的情况，不依赖下一次流量。
        if (this.releasedTotal > 0) {
          try { this.processRef.send({ type: MEMORY_CREDIT_MESSAGE, op: "release", bytes: excess, releasedTotal: this.releasedTotal }, () => {}); } catch {}
        }
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
    const requested = Math.ceil(Math.max(bytes, CREDIT_BYTES) / CREDIT_BYTES) * CREDIT_BYTES;
    const pending = { id, promise, resolve, requested, sending: false, timer: null };
    this.pending = pending;
    const send = () => {
      if (this.pending !== pending) return;
      if (!this.processRef.connected) { this.pending = null; resolve(); return; }
      if (!pending.sending) {
        pending.sending = true;
        try {
          this.processRef.send({ type: MEMORY_CREDIT_MESSAGE, op: "acquire", id, bytes: requested, releasedTotal: this.releasedTotal }, (error) => {
            pending.sending = false;
            if (error) resolve();
          });
        } catch { pending.sending = false; resolve(); }
      }
      // 回复丢失时重试相同 ID；IPC 写入尚未完成时不再堆积发送。
      if (this.pending === pending) { pending.timer = setTimeout(send, 1000); pending.timer.unref?.(); }
    };
    send();
    return promise;
  }

  async waitForCredits(bytes, signal, waitMs) {
    if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
    if (waitMs <= 0) throw new LocalCapacityError();
    let timer;
    let onAbort;
    try {
      return await Promise.race([
        this.requestCredits(bytes),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new LocalCapacityError()), waitMs);
          onAbort = () => reject(signal.reason || new DOMException("Aborted", "AbortError"));
          signal?.addEventListener("abort", onAbort, { once: true });
          if (signal?.aborted) onAbort();
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
  }

  tryLease(bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError("Invalid memory lease size");
    const limit = this.remote ? this.credits : this.limit;
    if (bytes > limit - this.used) return null;
    this.used += bytes;
    this.peak = Math.max(this.peak, this.used);
    let size = bytes;
    let released = false;
    const grow = (target, requestCredits) => {
      if (!Number.isSafeInteger(target) || target < 0) throw new RangeError("Invalid memory lease size");
      if (released) return false;
      if (target <= size) return true;
      const delta = target - size;
      if (delta > (this.remote ? this.credits : this.limit) - this.used) {
        if (requestCredits) void this.requestCredits(delta);
        return false;
      }
      this.used += delta;
      size = target;
      this.peak = Math.max(this.peak, this.used);
      return true;
    };
    return {
      get reservedBytes() { return size; },
      tryGrow: (target) => grow(target, true),
      tryGrowAsync: async (target, signal, waitMs = ADMISSION_WAIT_MS) => {
        const deadline = performance.now() + Math.min(ADMISSION_WAIT_MS, Math.max(0, waitMs));
        while (true) {
          if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
          if (grow(target, false)) return true;
          if (released || !this.remote || !this.processRef.connected) return false;
          const delta = target - size;
          const reply = await this.waitForCredits(delta, signal, deadline - performance.now());
          if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
          if (grow(target, false)) return true;
          // A smaller already-pending request may have been shared. Negotiate the
          // remaining amount once it completes; an actual denial never queues.
          if (!reply || reply.bytes < reply.requested) return false;
        }
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
