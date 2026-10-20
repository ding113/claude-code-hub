import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getAllSessions: vi.fn() }));

vi.mock("@/lib/api-client/v1/actions/active-sessions", () => ({
  getAllSessions: api.getAllSessions,
}));
vi.mock("@/actions/active-sessions", () => ({
  getAllSessions: api.getAllSessions,
}));

import { fetchAllSessionsPage } from "./active-sessions-query";

describe("fetchAllSessionsPage", () => {
  afterEach(() => {
    vi.useRealTimers();
    api.getAllSessions.mockReset();
  });

  it("fails with a stable timeout error after 15 seconds", async () => {
    vi.useFakeTimers();
    api.getAllSessions.mockImplementation(
      (_active: number, _inactive: number, _size: number, options: RequestInit) =>
        new Promise((resolve) => {
          options.signal?.addEventListener("abort", () => resolve({ ok: false, error: "aborted" }));
        })
    );
    const request = fetchAllSessionsPage({
      activePage: 1,
      inactivePage: 1,
      pageSize: 20,
      signal: new AbortController().signal,
    });
    const rejection = expect(request).rejects.toThrow("FETCH_SESSIONS_TIMEOUT");

    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
  });

  it("propagates caller cancellation to the browser request", async () => {
    let requestSignal: AbortSignal | null | undefined;
    api.getAllSessions.mockImplementation(
      (_active: number, _inactive: number, _size: number, options: RequestInit) => {
        requestSignal = options.signal;
        return new Promise((resolve) => {
          options.signal?.addEventListener("abort", () => resolve({ ok: false, error: "aborted" }));
        });
      }
    );
    const controller = new AbortController();
    const request = fetchAllSessionsPage({
      activePage: 1,
      inactivePage: 1,
      pageSize: 20,
      signal: controller.signal,
    });
    const rejection = expect(request).rejects.toThrow("FETCH_SESSIONS_CANCELLED");

    controller.abort();
    await rejection;
    expect(requestSignal?.aborted).toBe(true);
  });

  it("normalizes a rejected browser abort to the stable caller cancellation error", async () => {
    api.getAllSessions.mockImplementation(
      (_active: number, _inactive: number, _size: number, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        })
    );
    const controller = new AbortController();
    const request = fetchAllSessionsPage({
      activePage: 1,
      inactivePage: 1,
      pageSize: 20,
      signal: controller.signal,
    });

    controller.abort();

    await expect(request).rejects.toThrow("FETCH_SESSIONS_CANCELLED");
  });

  it("normalizes transport failures instead of exposing browser error text", async () => {
    api.getAllSessions.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      fetchAllSessionsPage({
        activePage: 1,
        inactivePage: 1,
        pageSize: 20,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow("FETCH_SESSIONS_FAILED");
  });

  it("normalizes structured backend failures", async () => {
    api.getAllSessions.mockResolvedValue({
      ok: false,
      error: "Bad request",
      errorCode: "INVALID_FORMAT",
    });

    await expect(
      fetchAllSessionsPage({
        activePage: 1,
        inactivePage: 1,
        pageSize: 20,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow("FETCH_SESSIONS_FAILED");
  });
});
