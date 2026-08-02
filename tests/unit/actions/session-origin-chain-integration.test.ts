import { describe, expect, test, vi } from "vitest";
import type { ProviderChainItem } from "../../../src/types/message";

describe("getSessionOriginChain", () => {
  test("returns the first request origin chain for a multi-request session", async () => {
    vi.resetModules();

    const firstRequestChain: ProviderChainItem[] = [
      {
        id: 101,
        name: "provider-a",
        reason: "initial_selection",
        selectionMethod: "weighted_random",
      },
    ];

    const aggregateMultipleSessionStatsMock = vi
      .fn()
      .mockResolvedValue([{ sessionId: "test-session", userId: 1 }]);
    const findSessionRequestLocatorMock = vi.fn().mockResolvedValue({
      identityKind: "direct",
      sourceSessionId: "test-session",
      requestSequence: 1,
      keyId: 1,
    });
    const findSessionOriginChainMock = vi.fn().mockResolvedValue(firstRequestChain);

    vi.doMock("@/repository/message", () => ({
      aggregateMultipleSessionStats: aggregateMultipleSessionStatsMock,
      findSessionOriginChain: findSessionOriginChainMock,
      findSessionRequestLocator: findSessionRequestLocatorMock,
    }));

    vi.doMock("@/lib/auth", () => ({
      getSession: vi.fn().mockResolvedValue({ user: { id: 1, role: "admin" } }),
    }));

    vi.doMock("@/repository/key", () => ({
      findKeyList: vi.fn(),
    }));

    vi.doMock("@/lib/logger", () => ({
      logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
      },
    }));

    const { getSessionOriginChain } = await import("../../../src/actions/session-origin-chain");
    const result = await getSessionOriginChain("test-session");

    expect(result).toEqual({ ok: true, data: firstRequestChain });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) {
      throw new Error("Expected action to return origin chain data");
    }

    expect(result.data[0]?.reason).toBe("initial_selection");
    expect(findSessionRequestLocatorMock).toHaveBeenCalledWith("test-session", {}, 1);
    expect(findSessionOriginChainMock).toHaveBeenCalledWith("test-session", 1);
  });
});
