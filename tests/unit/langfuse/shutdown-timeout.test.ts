import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe.sequential("shutdownLangfuse", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("is a no-op when not initialized", async () => {
    const { shutdownLangfuse } = await import("@/lib/langfuse");
    const started = Date.now();
    await shutdownLangfuse();
    expect(Date.now() - started).toBeLessThan(200);
  });

  it("times out when forceFlush hangs and still calls sdk.shutdown afterward", async () => {
    // We construct fake spanProcessor + sdk objects and inject them into the
    // module's private state via a doMock that returns wrapper functions. The
    // public shutdownLangfuse() is then called and must complete within bounded
    // time even though forceFlush() never resolves.
    vi.stubEnv("LANGFUSE_SHUTDOWN_TIMEOUT_MS", "100");

    let forceFlushCalled = false;
    let sdkShutdownCalled = false;

    const fakeSpanProcessor = {
      forceFlush: () => {
        forceFlushCalled = true;
        return new Promise(() => {}); // hang
      },
      onStart: () => {},
      onEnd: () => {},
      shutdown: () => Promise.resolve(),
    };
    const fakeSdk = {
      start: () => {},
      shutdown: () => {
        sdkShutdownCalled = true;
        return Promise.resolve();
      },
    };

    vi.doMock("@langfuse/otel", () => ({
      LangfuseSpanProcessor: class {
        constructor() {
          Object.assign(this, fakeSpanProcessor);
        }
      },
    }));
    vi.doMock("@opentelemetry/sdk-node", () => ({
      NodeSDK: class {
        constructor() {
          Object.assign(this, fakeSdk);
        }
      },
    }));
    vi.doMock("@opentelemetry/sdk-trace-base", () => ({
      TraceIdRatioBasedSampler: class {},
    }));

    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");

    const { initLangfuse, shutdownLangfuse } = await import("@/lib/langfuse");
    await initLangfuse();

    const started = Date.now();
    await shutdownLangfuse();
    const elapsed = Date.now() - started;

    expect(forceFlushCalled).toBe(true);
    expect(sdkShutdownCalled).toBe(true);
    // 100ms forceFlush timeout + ~0ms sdk.shutdown — must complete promptly.
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(1_000);
  });

  it("LANGFUSE_SHUTDOWN_TIMEOUT_MS is honored (50ms cap)", async () => {
    vi.stubEnv("LANGFUSE_SHUTDOWN_TIMEOUT_MS", "50");

    const fakeSpanProcessor = {
      forceFlush: () => new Promise(() => {}), // hang
      onStart: () => {},
      onEnd: () => {},
      shutdown: () => Promise.resolve(),
    };
    const fakeSdk = {
      start: () => {},
      shutdown: () => Promise.resolve(),
    };

    vi.doMock("@langfuse/otel", () => ({
      LangfuseSpanProcessor: class {
        constructor() {
          Object.assign(this, fakeSpanProcessor);
        }
      },
    }));
    vi.doMock("@opentelemetry/sdk-node", () => ({
      NodeSDK: class {
        constructor() {
          Object.assign(this, fakeSdk);
        }
      },
    }));

    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");

    const { initLangfuse, shutdownLangfuse } = await import("@/lib/langfuse");
    await initLangfuse();

    const started = Date.now();
    await shutdownLangfuse();
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(500);
  });
});
