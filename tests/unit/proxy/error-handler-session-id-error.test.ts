import { describe, expect, test } from "vitest";
import { ProxyErrorHandler } from "@/app/v1/_lib/proxy/error-handler";

describe("ProxyErrorHandler.handle - session id on errors", () => {
  test("decorates error response with x-cch-session-id and message suffix", async () => {
    const session = {
      sessionId: "s_123",
      messageContext: null,
      startTime: Date.now(),
      getProviderChain: () => [],
      getCurrentModel: () => null,
      getContext1mApplied: () => false,
      provider: null,
    } as any;

    const res = await ProxyErrorHandler.handle(session, new Error("boom"));

    expect(res.status).toBe(500);
    expect(res.headers.get("x-cch-session-id")).toBe("s_123");

    const body = await res.json();
    expect(body.error.message).toBe("boom (cch_session_id: s_123)");
  });
});
