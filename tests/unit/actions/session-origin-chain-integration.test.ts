import { describe, expect, test, vi } from "vitest";
import type { ProviderChainItem } from "../../../src/types/message";

type SessionRequestRow = {
  requestSequence: number;
  providerChain: ProviderChainItem[];
};

describe("getSessionOriginChain integration", () => {
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

    const secondRequestChain: ProviderChainItem[] = [
      {
        id: 101,
        name: "provider-a",
        reason: "session_reuse",
        selectionMethod: "session_reuse",
      },
    ];

    const sessionRequests: SessionRequestRow[] = [
      { requestSequence: 1, providerChain: firstRequestChain },
      { requestSequence: 2, providerChain: secondRequestChain },
    ];

    const limitMock = vi.fn((limit: number) =>
      Promise.resolve(
        [...sessionRequests]
          .sort((a, b) => a.requestSequence - b.requestSequence)
          .slice(0, limit)
          .map((row) => ({ providerChain: row.providerChain }))
      )
    );
    const orderByMock = vi.fn(() => ({ limit: limitMock }));
    const whereMock = vi.fn(() => ({ orderBy: orderByMock }));
    const fromMock = vi.fn(() => ({ where: whereMock }));
    const selectMock = vi.fn(() => ({ from: fromMock }));

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
      },
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
    expect(result.data).not.toEqual(secondRequestChain);
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(limitMock).toHaveBeenCalledWith(1);
  });
});
