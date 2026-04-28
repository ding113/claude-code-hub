import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { combineAbortSignals } from "@/app/v1/_lib/proxy/combine-abort-signals";

type MutableAbortSignal = { any?: unknown };

describe("combineAbortSignals", () => {
  describe("native AbortSignal.any path", () => {
    it("delegates to AbortSignal.any when available and cleanup is noop", () => {
      const c1 = new AbortController();
      const c2 = new AbortController();

      const { signal, cleanup } = combineAbortSignals([c1.signal, c2.signal]);

      expect(signal.aborted).toBe(false);
      c1.abort();
      expect(signal.aborted).toBe(true);

      // cleanup should be safe to call (noop) — no listeners owned by us.
      expect(() => cleanup()).not.toThrow();
    });
  });

  describe("polyfill path (AbortSignal.any unavailable)", () => {
    let originalAny: unknown;

    beforeEach(() => {
      originalAny = (AbortSignal as MutableAbortSignal).any;
      // 赋 undefined 让 helper 的 `typeof ... === "function"` check 走 polyfill；
      // delete 在部分 V8 版本上对 static 不生效，赋值更可靠。
      (AbortSignal as MutableAbortSignal).any = undefined;
    });

    afterEach(() => {
      (AbortSignal as MutableAbortSignal).any = originalAny;
    });

    it("aborts combined signal when any source aborts", () => {
      const c1 = new AbortController();
      const c2 = new AbortController();

      const { signal } = combineAbortSignals([c1.signal, c2.signal]);
      expect(signal.aborted).toBe(false);
      c2.abort();
      expect(signal.aborted).toBe(true);
    });

    it("source-side abort listeners are detached after cleanup is invoked", () => {
      const c1 = new AbortController();
      const c2 = new AbortController();

      const { signal, cleanup } = combineAbortSignals([c1.signal, c2.signal]);
      expect(signal.aborted).toBe(false);

      // 模拟请求正常完成：调用方在 finally 中触发 cleanup。
      cleanup();

      // 源信号此后再 abort，不应再传播到组合信号（listener 已解绑）。
      c1.abort();
      c2.abort();
      expect(signal.aborted).toBe(false);
    });

    it("auto-cleans listeners when a source aborts (does not require explicit cleanup)", () => {
      const c1 = new AbortController();
      const c2 = new AbortController();

      const { signal, cleanup } = combineAbortSignals([c1.signal, c2.signal]);
      c1.abort();
      expect(signal.aborted).toBe(true);

      // 二次 cleanup 必须幂等（请求结束的 finally 仍会调）。
      expect(() => cleanup()).not.toThrow();
      expect(() => cleanup()).not.toThrow();
    });

    it("immediately aborts and cleans up when a source signal is already aborted", () => {
      const c1 = new AbortController();
      c1.abort();
      const c2 = new AbortController();

      const { signal, cleanup } = combineAbortSignals([c1.signal, c2.signal]);
      expect(signal.aborted).toBe(true);

      // 后到的源 abort 不应再触发任何路径（已 cleanup）。
      c2.abort();
      expect(signal.aborted).toBe(true);
      expect(() => cleanup()).not.toThrow();
    });
  });
});
