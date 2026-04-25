import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearResponsesWsUnsupportedCache,
  isResponsesWsUnsupported,
  markResponsesWsUnsupported,
} from "../unsupported-cache";

describe("responses-ws unsupported-cache", () => {
  beforeEach(() => {
    clearResponsesWsUnsupportedCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    clearResponsesWsUnsupportedCache();
  });

  it("returns not unsupported by default", () => {
    expect(isResponsesWsUnsupported(1, null)).toEqual({ unsupported: false });
  });

  it("records and reads back unsupported flag per (provider, endpoint)", () => {
    markResponsesWsUnsupported(1, 10, "ws_upgrade_rejected");
    expect(isResponsesWsUnsupported(1, 10)).toEqual({
      unsupported: true,
      reason: "ws_upgrade_rejected",
    });
    // Same provider, different endpoint: not affected
    expect(isResponsesWsUnsupported(1, 11)).toEqual({ unsupported: false });
    // Different provider, same endpoint number: not affected
    expect(isResponsesWsUnsupported(2, 10)).toEqual({ unsupported: false });
  });

  it("expires after TTL", () => {
    markResponsesWsUnsupported(42, null, "ws_closed_before_first_event", 1000);
    expect(isResponsesWsUnsupported(42, null).unsupported).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(isResponsesWsUnsupported(42, null).unsupported).toBe(false);
  });

  it("treats null and undefined endpointId as the same 'default' bucket", () => {
    markResponsesWsUnsupported(7, null, "ws_upgrade_rejected");
    expect(isResponsesWsUnsupported(7, undefined).unsupported).toBe(true);
  });
});
