/**
 * Benign broken-pipe error detection tests (issue #1234)
 *
 * 验证 isBenignBrokenPipeError 能识别由下游客户端断连引发的 socket/stream 错误，
 * 同时不把真正的逻辑错误误判为良性（否则进程级崩溃处理器会错误地抑制退出）。
 */
import { describe, expect, it } from "vitest";
import { isBenignBrokenPipeError } from "@/lib/lifecycle/benign-errors";

describe("isBenignBrokenPipeError", () => {
  describe("benign broken-pipe / disconnect codes", () => {
    it("detects EPIPE (the issue #1234 write EPIPE case)", () => {
      const err = new Error("write EPIPE");
      (err as NodeJS.ErrnoException).code = "EPIPE";
      expect(isBenignBrokenPipeError(err)).toBe(true);
    });

    it("detects ECONNRESET", () => {
      const err = new Error("read ECONNRESET");
      (err as NodeJS.ErrnoException).code = "ECONNRESET";
      expect(isBenignBrokenPipeError(err)).toBe(true);
    });

    it("detects ERR_STREAM_PREMATURE_CLOSE", () => {
      const err = new Error("Premature close");
      (err as NodeJS.ErrnoException).code = "ERR_STREAM_PREMATURE_CLOSE";
      expect(isBenignBrokenPipeError(err)).toBe(true);
    });
  });

  describe("cause chain", () => {
    it("detects EPIPE wrapped on cause", () => {
      const cause = new Error("write EPIPE");
      (cause as NodeJS.ErrnoException).code = "EPIPE";
      const err = new Error("request failed");
      (err as Error & { cause: Error }).cause = cause;
      expect(isBenignBrokenPipeError(err)).toBe(true);
    });

    it("detects ECONNRESET nested two levels deep", () => {
      const root = new Error("read ECONNRESET");
      (root as NodeJS.ErrnoException).code = "ECONNRESET";
      const mid = new Error("socket hang up");
      (mid as Error & { cause: Error }).cause = root;
      const top = new Error("stream error");
      (top as Error & { cause: Error }).cause = mid;
      expect(isBenignBrokenPipeError(top)).toBe(true);
    });

    it("does not loop forever on a cyclic cause chain", () => {
      const a = new Error("a");
      const b = new Error("b");
      (a as Error & { cause: Error }).cause = b;
      (b as Error & { cause: Error }).cause = a;
      expect(isBenignBrokenPipeError(a)).toBe(false);
    });
  });

  describe("non-benign errors (must still fail-fast)", () => {
    it("does not match a generic error without a code", () => {
      expect(isBenignBrokenPipeError(new Error("Something went wrong"))).toBe(false);
    });

    it("does not match unrelated transport codes", () => {
      const err = new Error("connect ECONNREFUSED");
      (err as NodeJS.ErrnoException).code = "ECONNREFUSED";
      expect(isBenignBrokenPipeError(err)).toBe(false);
    });

    it("does not match on message text alone (avoids false-benign suppression)", () => {
      // 上游错误文案可能包含 "EPIPE"/"ECONNRESET" 字样，但没有真实的 code，
      // 必须按非良性处理，确保真正的崩溃仍会退出。
      expect(isBenignBrokenPipeError(new Error("upstream said: write EPIPE"))).toBe(false);
    });

    it("handles non-Error values safely", () => {
      expect(isBenignBrokenPipeError(null)).toBe(false);
      expect(isBenignBrokenPipeError(undefined)).toBe(false);
      expect(isBenignBrokenPipeError("EPIPE")).toBe(false);
      expect(isBenignBrokenPipeError(42)).toBe(false);
    });

    it("handles a plain object carrying a benign code", () => {
      // 非 Error 但带 code 的对象（某些 stream 错误事件）也应识别。
      expect(isBenignBrokenPipeError({ code: "EPIPE" })).toBe(true);
    });
  });
});
