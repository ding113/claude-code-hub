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

import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireFromHere = createRequire(import.meta.url);

type ServerJsModule = {
  registerOrchestratedShutdown: (
    server: { close: (cb: (err?: Error) => void) => void; on?: unknown },
    wss: { close: () => void } | null
  ) => void;
};

function loadServerModule(): ServerJsModule {
  return requireFromHere("../../server.js") as ServerJsModule;
}

describe.sequential("registerOrchestratedShutdown", () => {
  let prevExit: typeof process.exit;
  let originalSigterm: typeof process.on;

  beforeEach(() => {
    prevExit = process.exit;
    originalSigterm = process.on;
    delete (globalThis as unknown as { __CCH_LIFECYCLE__?: unknown }).__CCH_LIFECYCLE__;
  });

  afterEach(() => {
    process.exit = prevExit;
    process.on = originalSigterm;
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
    delete (globalThis as unknown as { __CCH_LIFECYCLE__?: unknown }).__CCH_LIFECYCLE__;
    delete process.env.SHUTDOWN_DRAIN_MS;
    delete process.env.SHUTDOWN_CLEANUP_MS;
    delete process.env.SHUTDOWN_HARD_EXIT_MS;
  });

  it("runs the full sequence: markShuttingDown -> server.close -> runApplicationCleanup -> exit(0)", async () => {
    process.env.SHUTDOWN_DRAIN_MS = "500";
    process.env.SHUTDOWN_CLEANUP_MS = "500";
    process.env.SHUTDOWN_HARD_EXIT_MS = "5000";

    const closeServer = vi.fn((cb: (err?: Error) => void) => {
      setTimeout(() => cb(), 5);
    });
    const closeWss = vi.fn((cb: (err?: Error) => void) => {
      setTimeout(() => cb(), 5);
    });
    const wsClient = { close: vi.fn() };
    const server = { close: closeServer };
    const wss = { close: closeWss, clients: new Set([wsClient]) };

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
    expect(wsClient.close).toHaveBeenCalledWith(1001, "server_shutdown");
    expect(runApplicationCleanup).toHaveBeenCalledWith(
      "SIGTERM",
      expect.objectContaining({ totalTimeoutMs: 500 })
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
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

  it("survives missing lifecycle globals (logs warning, still exits)", async () => {
    process.env.SHUTDOWN_DRAIN_MS = "50";
    process.env.SHUTDOWN_CLEANUP_MS = "50";
    process.env.SHUTDOWN_HARD_EXIT_MS = "5000";

    const closeServer = vi.fn((cb: (err?: Error) => void) => setTimeout(cb, 1));
    const server = { close: closeServer };

    delete (globalThis as unknown as { __CCH_LIFECYCLE__?: unknown }).__CCH_LIFECYCLE__;

    const exitSpy = vi.fn() as unknown as typeof process.exit;
    process.exit = exitSpy;

    const { registerOrchestratedShutdown } = loadServerModule();
    registerOrchestratedShutdown(server, null);

    process.emit("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(closeServer).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("hard-exit watchdog fires process.exit(1) when the whole sequence hangs", async () => {
    process.env.SHUTDOWN_DRAIN_MS = "10000";
    process.env.SHUTDOWN_CLEANUP_MS = "10000";
    process.env.SHUTDOWN_HARD_EXIT_MS = "100";

    // Both server.close() and runApplicationCleanup never resolve — only the
    // watchdog can rescue the process.
    const closeServer = vi.fn((_cb: (err?: Error) => void) => {
      // never calls back
    });
    const server = { close: closeServer };

    (globalThis as unknown as { __CCH_LIFECYCLE__?: unknown }).__CCH_LIFECYCLE__ = {
      markShuttingDown: vi.fn(),
      isShuttingDown: vi.fn(() => true),
      runApplicationCleanup: vi.fn(() => new Promise(() => {})),
    };

    const exitSpy = vi.fn() as unknown as typeof process.exit;
    process.exit = exitSpy;

    const { registerOrchestratedShutdown } = loadServerModule();
    registerOrchestratedShutdown(server, null);

    process.emit("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("still calls process.exit(0) when runApplicationCleanup throws", async () => {
    process.env.SHUTDOWN_DRAIN_MS = "50";
    process.env.SHUTDOWN_CLEANUP_MS = "50";
    process.env.SHUTDOWN_HARD_EXIT_MS = "5000";

    const closeServer = vi.fn((cb: (err?: Error) => void) => setTimeout(cb, 1));
    const server = { close: closeServer };

    const runApplicationCleanup = vi.fn(() => Promise.reject(new Error("simulated cleanup throw")));
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
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(runApplicationCleanup).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
