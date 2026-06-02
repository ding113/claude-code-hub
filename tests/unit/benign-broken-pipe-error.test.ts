/**
 * Benign broken-pipe error detection tests (issue #1234)
 *
 * 验证进程级崩溃处理器使用的判定：仅把写侧、来源明确的 EPIPE 视为良性断管，
 * 而 ECONNRESET / ERR_STREAM_PREMATURE_CLOSE 等来源不明的码必须保持 fail-fast，
 * 避免在进程级（无请求上下文）误吞上游基础设施故障。
 */
import { describe, expect, it } from "vitest";
import { getBenignBrokenPipeCode, isBenignBrokenPipeError } from "@/lib/lifecycle/benign-errors";

describe("isBenignBrokenPipeError", () => {
  describe("benign (EPIPE only — write-side, unambiguous downstream disconnect)", () => {
    it("detects EPIPE (the issue #1234 write EPIPE case)", () => {
      const err = new Error("write EPIPE");
      (err as NodeJS.ErrnoException).code = "EPIPE";
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

    it("detects EPIPE nested two levels deep", () => {
      const root = new Error("write EPIPE");
      (root as NodeJS.ErrnoException).code = "EPIPE";
      const mid = new Error("socket write failed");
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

  describe("ambiguous codes are deliberately NOT benign (preserve fail-fast)", () => {
    it("does NOT treat ECONNRESET as benign (may originate upstream: DB/Redis/provider)", () => {
      const err = new Error("read ECONNRESET");
      (err as NodeJS.ErrnoException).code = "ECONNRESET";
      expect(isBenignBrokenPipeError(err)).toBe(false);
    });

    it("does NOT treat ERR_STREAM_PREMATURE_CLOSE as benign", () => {
      const err = new Error("Premature close");
      (err as NodeJS.ErrnoException).code = "ERR_STREAM_PREMATURE_CLOSE";
      expect(isBenignBrokenPipeError(err)).toBe(false);
    });

    it("does NOT treat an upstream-nested ECONNRESET as benign", () => {
      const root = new Error("read ECONNRESET");
      (root as NodeJS.ErrnoException).code = "ECONNRESET";
      const top = new Error("provider request failed");
      (top as Error & { cause: Error }).cause = root;
      expect(isBenignBrokenPipeError(top)).toBe(false);
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
      // 上游错误文案可能包含 "EPIPE" 字样，但没有真实的 code，
      // 必须按非良性处理，确保真正的崩溃仍会退出。
      expect(isBenignBrokenPipeError(new Error("upstream said: write EPIPE"))).toBe(false);
    });

    it("handles non-Error values safely", () => {
      expect(isBenignBrokenPipeError(null)).toBe(false);
      expect(isBenignBrokenPipeError(undefined)).toBe(false);
      expect(isBenignBrokenPipeError("EPIPE")).toBe(false);
      expect(isBenignBrokenPipeError(42)).toBe(false);
    });

    it("matches a plain object carrying EPIPE but not other codes", () => {
      // 非 Error 但带 code 的对象（某些 stream 错误事件 / 非 Error 拒因）也应识别。
      expect(isBenignBrokenPipeError({ code: "EPIPE" })).toBe(true);
      expect(isBenignBrokenPipeError({ code: "ECONNRESET" })).toBe(false);
    });
  });
});

describe("getBenignBrokenPipeCode", () => {
  it("returns the matched code for a top-level EPIPE", () => {
    const err = new Error("write EPIPE");
    (err as NodeJS.ErrnoException).code = "EPIPE";
    expect(getBenignBrokenPipeCode(err)).toBe("EPIPE");
  });

  it("returns the nested code so logging is accurate even when wrapped", () => {
    const cause = new Error("write EPIPE");
    (cause as NodeJS.ErrnoException).code = "EPIPE";
    const err = new Error("request failed");
    (err as Error & { cause: Error }).cause = cause;
    expect(getBenignBrokenPipeCode(err)).toBe("EPIPE");
  });

  it("returns undefined for ambiguous and unrelated codes", () => {
    const econn = new Error("read ECONNRESET");
    (econn as NodeJS.ErrnoException).code = "ECONNRESET";
    expect(getBenignBrokenPipeCode(econn)).toBeUndefined();
    expect(getBenignBrokenPipeCode(new Error("no code"))).toBeUndefined();
    expect(getBenignBrokenPipeCode(null)).toBeUndefined();
  });
});
