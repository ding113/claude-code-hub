import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
  },
}));

import { emitProxyLangfuseTrace } from "@/lib/langfuse/emit-proxy-trace";
import { logger } from "@/lib/logger";

describe("emitProxyLangfuseTrace", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("never lets a synchronous session snapshot failure escape", () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "test-public");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "test-secret");
    const session = {
      getProviderChain() {
        throw new Error("snapshot exploded");
      },
    } as unknown as ProxySession;

    expect(() =>
      emitProxyLangfuseTrace(session, {
        responseHeaders: new Headers(),
        responseText: "",
        usageMetrics: null,
        costUsd: undefined,
        statusCode: 500,
        durationMs: 1,
        isStreaming: false,
      })
    ).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith("[Langfuse] Proxy trace snapshot failed", {
      error: "snapshot exploded",
    });
  });
});
