/**
 * server.js orchestrated shutdown: SIGTERM/SIGINT path.
 *
 * We exercise the exported `registerOrchestratedShutdown(server, wss)` against
 * fake server/wss objects and inspect:
 *  - server.close() and wss.close() are invoked
 *  - globalThis.__CCH_LIFECYCLE__.markShuttingDown / runApplicationCleanup are called
 *  - process.exit(0) is reached
 *  - drain timeout fires when server.close never finishes
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireFromHere = createRequire(import.meta.url);

type ServerJsModule = {
  registerOrchestratedShutdown: (
    server: { close: (cb: (err?: Error) => void) => void; on?: unknown },
    wss: { close: (cb?: (err?: Error) => void) => void } | null
  ) => void;
};

function loadServerModule(): ServerJsModule {
  return requireFromHere("../../server.js") as ServerJsModule;
}

describe.sequential("registerOrchestratedShutdown", () => {
  let prevExit: typeof process.exit;
  let originalSigterm: typeof process.on;
  let prevStdoutWrite: typeof process.stdout.write;

  beforeEach(() => {
    vi.resetModules();
    prevExit = process.exit;
    originalSigterm = process.on;
    prevStdoutWrite = process.stdout.write;
    delete (globalThis as unknown as { __CCH_LIFECYCLE__?: unknown }).__CCH_LIFECYCLE__;
  });

  afterEach(() => {
    process.exit = prevExit;
    process.on = originalSigterm;
    process.stdout.write = prevStdoutWrite;
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
    delete (globalThis as unknown as { __CCH_LIFECYCLE__?: unknown }).__CCH_LIFECYCLE__;
    delete process.env.SHUTDOWN_DRAIN_MS;
    delete process.env.SHUTDOWN_CLEANUP_MS;
    delete process.env.SHUTDOWN_HARD_EXIT_MS;
    vi.restoreAllMocks();
  });

  it("runs the full sequence: markShuttingDown -> server.close -> runApplicationCleanup -> exit(0)", async () => {
    process.env.SHUTDOWN_DRAIN_MS = "500";
    process.env.SHUTDOWN_CLEANUP_MS = "500";
    process.env.SHUTDOWN_HARD_EXIT_MS = "5000";

    const closeServer = vi.fn((cb: (err?: Error) => void) => {
      setTimeout(() => cb(), 5);
    });
    const closeWss = vi.fn();
    const server = { close: closeServer };
    const wss = { close: closeWss };

    const markShuttingDown = vi.fn();
    const isShuttingDown = vi.fn(() => true);
    const runApplicationCleanup = vi.fn(async () => {});
    (globalThis as unknown as { __CCH_LIFECYCLE__?: unknown }).__CCH_LIFECYCLE__ = {
      markShuttingDown,
      isShuttingDown,
      runApplicationCleanup,
    };

    const exitSpy = vi.fn() as unknown as typeof process.exit;
    process.exit = exitSpy;

    const { registerOrchestratedShutdown } = loadServerModule();
    registerOrchestratedShutdown(server, wss);

    // Trigger SIGTERM
    process.emit("SIGTERM");

    // Allow the async handler to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(markShuttingDown).toHaveBeenCalledTimes(1);
    expect(closeServer).toHaveBeenCalledTimes(1);
    expect(closeWss).toHaveBeenCalledTimes(1);
    expect(runApplicationCleanup).toHaveBeenCalledWith(
      "SIGTERM",
      expect.objectContaining({ totalTimeoutMs: 500 })
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("waits for WSS close callback before cleanup and successful exit on SIGTERM/SIGINT", async () => {
    process.env.SHUTDOWN_DRAIN_MS = "500";
    process.env.SHUTDOWN_CLEANUP_MS = "500";
    process.env.SHUTDOWN_HARD_EXIT_MS = "5000";

    const { registerOrchestratedShutdown } = loadServerModule();

    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.removeAllListeners("SIGTERM");
      process.removeAllListeners("SIGINT");

      const closeServer = vi.fn((callback: (err?: Error) => void) => callback());
      let finishWssClose: ((err?: Error) => void) | undefined;
      const closeWss = vi.fn((callback?: (err?: Error) => void) => {
        finishWssClose = callback;
      });
      const runApplicationCleanup = vi.fn(async () => {});
      (globalThis as unknown as { __CCH_LIFECYCLE__?: unknown }).__CCH_LIFECYCLE__ = {
        markShuttingDown: vi.fn(),
        isShuttingDown: vi.fn(() => true),
        runApplicationCleanup,
      };

      const output: string[] = [];
      process.stdout.write = ((chunk: string | Uint8Array) => {
        output.push(String(chunk));
        return true;
      }) as typeof process.stdout.write;
      const exitSpy = vi.fn() as unknown as typeof process.exit;
      process.exit = exitSpy;

      registerOrchestratedShutdown({ close: closeServer }, { close: closeWss });
      process.emit(signal);
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(closeServer).toHaveBeenCalledTimes(1);
      expect(closeWss).toHaveBeenCalledTimes(1);
      expect(runApplicationCleanup).not.toHaveBeenCalled();
      expect(output.join("")).not.toContain('"msg":"shutdown_complete"');
      expect(exitSpy).not.toHaveBeenCalled();
      expect(finishWssClose).toBeTypeOf("function");

      finishWssClose?.();
      await vi.waitFor(() => {
        expect(runApplicationCleanup).toHaveBeenCalledWith(signal, { totalTimeoutMs: 500 });
        expect(output.join("")).toContain('"msg":"shutdown_complete"');
        expect(exitSpy).toHaveBeenCalledWith(0);
      });
    }
  });

  it("drain timeout fires when server.close never resolves", async () => {
    process.env.SHUTDOWN_DRAIN_MS = "100";
    process.env.SHUTDOWN_CLEANUP_MS = "100";
    process.env.SHUTDOWN_HARD_EXIT_MS = "5000";

    const closeServer = vi.fn((_cb: (err?: Error) => void) => {
      // Never call the callback — simulating a stuck in-flight connection.
    });
    const server = { close: closeServer };

    const runApplicationCleanup = vi.fn(async () => {});
    (globalThis as unknown as { __CCH_LIFECYCLE__?: unknown }).__CCH_LIFECYCLE__ = {
      markShuttingDown: vi.fn(),
      isShuttingDown: vi.fn(() => true),
      runApplicationCleanup,
    };

    const exitSpy = vi.fn() as unknown as typeof process.exit;
    process.exit = exitSpy;

    const { registerOrchestratedShutdown } = loadServerModule();
    registerOrchestratedShutdown(server, null);

    const started = Date.now();
    process.emit("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const elapsed = Date.now() - started;

    expect(closeServer).toHaveBeenCalled();
    expect(runApplicationCleanup).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    // drain (100ms) + cleanup (~0) < 500ms total
    expect(elapsed).toBeLessThan(1_500);
  });

  it("ignores duplicate SIGTERM (idempotent)", async () => {
    process.env.SHUTDOWN_DRAIN_MS = "50";
    process.env.SHUTDOWN_CLEANUP_MS = "50";
    process.env.SHUTDOWN_HARD_EXIT_MS = "5000";

    const closeServer = vi.fn((cb: (err?: Error) => void) => setTimeout(cb, 1));
    const server = { close: closeServer };

    const runApplicationCleanup = vi.fn(async () => {});
    (globalThis as unknown as { __CCH_LIFECYCLE__?: unknown }).__CCH_LIFECYCLE__ = {
      markShuttingDown: vi.fn(),
      isShuttingDown: vi.fn(() => true),
      runApplicationCleanup,
    };

    const exitSpy = vi.fn() as unknown as typeof process.exit;
    process.exit = exitSpy;

    const { registerOrchestratedShutdown } = loadServerModule();
    registerOrchestratedShutdown(server, null);

    process.emit("SIGTERM");
    // process.once should remove the listener after first fire — second emit is a no-op
    process.emit("SIGTERM");

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(closeServer).toHaveBeenCalledTimes(1);
    expect(runApplicationCleanup).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("lifecycle globals 缺失时不得记录 shutdown_complete 或 exit(0)", async () => {
    process.env.SHUTDOWN_DRAIN_MS = "50";
    process.env.SHUTDOWN_CLEANUP_MS = "50";
    process.env.SHUTDOWN_HARD_EXIT_MS = "5000";

    const closeServer = vi.fn((cb: (err?: Error) => void) => setTimeout(cb, 1));
    const server = { close: closeServer };

    delete (globalThis as unknown as { __CCH_LIFECYCLE__?: unknown }).__CCH_LIFECYCLE__;

    const output: string[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    const exitSpy = vi.fn() as unknown as typeof process.exit;
    process.exit = exitSpy;

    const { registerOrchestratedShutdown } = loadServerModule();
    registerOrchestratedShutdown(server, null);

    process.emit("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(closeServer).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(exitSpy).not.toHaveBeenCalledWith(0);
    expect(output.join("")).toContain('"msg":"shutdown_cleanup_unavailable"');
    expect(output.join("")).not.toContain('"msg":"shutdown_complete"');
  });

  it("writer rejection 时不得记录 shutdown_complete 或 exit(0)", async () => {
    process.env.SHUTDOWN_DRAIN_MS = "50";
    process.env.SHUTDOWN_CLEANUP_MS = "500";
    process.env.SHUTDOWN_HARD_EXIT_MS = "1000";

    vi.doMock("@/lib/cache/session-cache", () => ({ stopCacheCleanup: () => {} }));
    vi.doMock("@/lib/provider-endpoints/probe-scheduler", () => ({
      stopEndpointProbeScheduler: () => {},
    }));
    vi.doMock("@/lib/public-status/scheduler", () => ({
      stopPublicStatusRebuildScheduler: async () => {},
    }));
    vi.doMock("@/lib/provider-endpoints/probe-log-cleanup", () => ({
      stopEndpointProbeLogCleanup: () => {},
    }));
    vi.doMock("@/lib/async-task-manager", () => ({ shutdownAllAsyncTasks: async () => {} }));
    vi.doMock("@/repository/message-write-buffer", () => ({
      stopMessageRequestWriteBuffer: async () => {
        throw new Error("writer rejected");
      },
    }));
    vi.doMock("@/drizzle/db", () => ({ closeDbPools: async () => {} }));
    vi.doMock("@/lib/langfuse", () => ({ shutdownLangfuse: async () => {} }));
    vi.doMock("@/lib/redis", () => ({ closeRedis: async () => {} }));

    const lifecycle = await import("@/lib/lifecycle/shutdown");
    lifecycle.__resetShutdownStateForTests();
    (globalThis as unknown as { __CCH_LIFECYCLE__?: unknown }).__CCH_LIFECYCLE__ = lifecycle;

    const output: string[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    const exitSpy = vi.fn() as unknown as typeof process.exit;
    process.exit = exitSpy;

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    const { registerOrchestratedShutdown } = loadServerModule();
    registerOrchestratedShutdown({ close: (callback) => callback() }, null);
    process.emit("SIGTERM");
    const hardExit = setTimeoutSpy.mock.results[0]?.value;

    try {
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(exitSpy).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(exitSpy).not.toHaveBeenCalledWith(0);
      expect(output.join("")).toContain('"msg":"shutdown_cleanup_error"');
      expect(output.join("")).not.toContain('"msg":"shutdown_complete"');
      expect(clearTimeoutSpy).not.toHaveBeenCalledWith(hardExit);
    } finally {
      clearTimeout(hardExit);
    }
  });

  it("无其他 ref handle 时 hard watchdog 仍以非零状态退出", () => {
    const serverPath = requireFromHere.resolve("../../server.js");
    const script = `
      process.env.SHUTDOWN_DRAIN_MS = "10";
      process.env.SHUTDOWN_CLEANUP_MS = "10";
      process.env.SHUTDOWN_HARD_EXIT_MS = "50";
      const { registerOrchestratedShutdown } = require(${JSON.stringify(serverPath)});
      globalThis.__CCH_LIFECYCLE__ = {
        markShuttingDown() {},
        isShuttingDown() { return true; },
        runApplicationCleanup() { return new Promise(() => {}); },
      };
      registerOrchestratedShutdown({ close(callback) { callback(); } }, null);
      process.emit("SIGTERM");
    `;

    const result = spawnSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      timeout: 2_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"msg":"shutdown_hard_exit_watchdog"');
    expect(result.stdout).not.toContain('"msg":"shutdown_complete"');
  });
});
