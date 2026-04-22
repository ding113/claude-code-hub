import { describe, expect, test } from "vitest";
import { ProxyErrorHandler } from "@/app/v1/_lib/proxy/error-handler";
import { RateLimitError } from "@/app/v1/_lib/proxy/errors";

describe("ProxyErrorHandler.handle - session id on errors", () => {
  test("decorates error response with message suffix only", async () => {
    const session = {
      sessionId: "s_123",
      messageContext: null,
      startTime: Date.now(),
      getProviderChain: () => [],
      getCurrentModel: () => null,
      getContext1mApplied: () => false,
      getGroupCostMultiplier: () => 1,
      provider: null,
    } as any;

    const res = await ProxyErrorHandler.handle(session, new Error("boom"));

    expect(res.status).toBe(500);
    expect(res.headers.get("x-cch-session-id")).toBeNull();

    const body = await res.json();
    expect(body.error.message).toBe("boom (cch_session_id: s_123)");
  });

  test("keeps fixed-window rate-limit headers while removing X-RateLimit-Type", async () => {
    const session = {
      sessionId: "s_123",
      messageContext: null,
      startTime: Date.now(),
      getProviderChain: () => [],
      getCurrentModel: () => null,
      getContext1mApplied: () => false,
      getGroupCostMultiplier: () => 1,
      provider: null,
    } as any;

    const res = await ProxyErrorHandler.handle(
      session,
      new RateLimitError(
        "rate_limit_error",
        "limit exceeded",
        "daily_quota",
        12,
        20,
        "2026-04-22T13:30:00.000Z"
      )
    );

    expect(res.status).toBe(402);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("20");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("8");
    expect(res.headers.get("X-RateLimit-Reset")).toBe("1776864600");
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(res.headers.get("X-RateLimit-Type")).toBeNull();

    const body = await res.json();
    expect(body.error.message).toBe("limit exceeded (cch_session_id: s_123)");
    expect(body.error.limit_type).toBe("daily_quota");
  });

  test("keeps rolling-window rate-limit headers while removing X-RateLimit-Type", async () => {
    const session = {
      sessionId: "s_123",
      messageContext: null,
      startTime: Date.now(),
      getProviderChain: () => [],
      getCurrentModel: () => null,
      getContext1mApplied: () => false,
      getGroupCostMultiplier: () => 1,
      provider: null,
    } as any;

    const res = await ProxyErrorHandler.handle(
      session,
      new RateLimitError("rate_limit_error", "too many requests", "rpm", 21, 25, null)
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("25");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("4");
    expect(res.headers.get("X-RateLimit-Reset")).toBeNull();
    expect(res.headers.get("Retry-After")).toBeNull();
    expect(res.headers.get("X-RateLimit-Type")).toBeNull();

    const body = await res.json();
    expect(body.error.message).toBe("too many requests (cch_session_id: s_123)");
    expect(body.error.limit_type).toBe("rpm");
  });
});
