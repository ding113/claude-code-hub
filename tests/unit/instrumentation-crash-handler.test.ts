/**
 * Instrumentation crash-handler behavior tests (issue #1234)
 *
 * 锁定核心回归：进程级 uncaughtException / unhandledRejection 处理器在遇到良性断管
 * （EPIPE/ECONNRESET/ERR_STREAM_PREMATURE_CLOSE）时必须仅记录 warn 而不调用
 * process.exit(1)；遇到真正的错误时仍必须 fail-fast 退出。
 *
 * 谓词 isBenignBrokenPipeError 已单独单测，这里验证 registerCrashDiagnostics 的实际接线，
 * 防止未来重构（删掉早返回、反转判断、移动谓词调用）在谓词测试全绿的情况下重新引入崩溃。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

import { logger } from "@/lib/logger";
import { registerCrashDiagnostics } from "@/instrumentation";

type CrashHandler = (arg: unknown) => void;

/**
 * 通过 spy process.on 捕获 registerCrashDiagnostics 实际注册的处理器，
 * 避免用 process.emit 触发真实进程事件（会干扰 vitest 自身的监听器）。
 */
function captureHandlers(): { uncaughtException: CrashHandler; unhandledRejection: CrashHandler } {
  const handlers: Record<string, CrashHandler> = {};
  const onSpy = vi.spyOn(process, "on").mockImplementation(((
    event: string,
    handler: CrashHandler
  ) => {
    if (event === "uncaughtException" || event === "unhandledRejection") {
      handlers[event] = handler;
    }
    return process;
  }) as never);

  // 重置去重标志，确保本次调用真正执行 process.on 注册
  (
    globalThis as { __CCH_CRASH_HANDLERS_REGISTERED__?: boolean }
  ).__CCH_CRASH_HANDLERS_REGISTERED__ = false;
  registerCrashDiagnostics();
  onSpy.mockRestore();

  if (!handlers.uncaughtException || !handlers.unhandledRejection) {
    throw new Error("crash handlers were not registered");
  }
  return {
    uncaughtException: handlers.uncaughtException,
    unhandledRejection: handlers.unhandledRejection,
  };
}

function makeError(code: string, message = code): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe("registerCrashDiagnostics", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number) => undefined) as never);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // 避免在 fatal 路径写出 Node 诊断报告文件
    if (process.report && typeof process.report.writeReport === "function") {
      vi.spyOn(process.report, "writeReport").mockReturnValue("");
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("benign broken-pipe errors (must NOT exit)", () => {
    it("uncaughtException: EPIPE is logged at warn and does not exit", () => {
      const { uncaughtException } = captureHandlers();
      uncaughtException(makeError("EPIPE", "write EPIPE"));

      expect(exitSpy).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.fatal).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it.each([
      "ECONNRESET",
      "ERR_STREAM_PREMATURE_CLOSE",
    ])("uncaughtException: %s does not exit", (code) => {
      const { uncaughtException } = captureHandlers();
      uncaughtException(makeError(code));
      expect(exitSpy).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("unhandledRejection: rejected Error with EPIPE does not exit", () => {
      const { unhandledRejection } = captureHandlers();
      unhandledRejection(makeError("EPIPE", "write EPIPE"));

      expect(exitSpy).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.fatal).not.toHaveBeenCalled();
    });

    it("unhandledRejection: non-Error rejection { code: EPIPE } does not exit", () => {
      // 回归：reason 在 wrap 成 Error 之前判定，否则 code 会丢失（review 低危发现）
      const { unhandledRejection } = captureHandlers();
      unhandledRejection({ code: "EPIPE" });

      expect(exitSpy).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe("genuine errors (must still fail-fast)", () => {
    it("uncaughtException: a generic Error exits with code 1", () => {
      const { uncaughtException } = captureHandlers();
      uncaughtException(new Error("real bug"));

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(logger.fatal).toHaveBeenCalledTimes(1);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("uncaughtException: a non-benign transport code (ECONNREFUSED) exits with code 1", () => {
      const { uncaughtException } = captureHandlers();
      uncaughtException(makeError("ECONNREFUSED", "connect ECONNREFUSED"));

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(logger.fatal).toHaveBeenCalledTimes(1);
    });

    it("unhandledRejection: a generic rejection exits with code 1", () => {
      const { unhandledRejection } = captureHandlers();
      unhandledRejection(new Error("real rejection"));

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(logger.fatal).toHaveBeenCalledTimes(1);
    });
  });
});
