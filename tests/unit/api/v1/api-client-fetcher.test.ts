import { afterEach, describe, expect, test, vi } from "vitest";
import type { ApiError } from "@/lib/api-client/v1/errors";
import { apiFetch, clearCsrfTokenCache } from "@/lib/api-client/v1/fetcher";

describe("v1 api fetcher", () => {
  afterEach(() => {
    clearCsrfTokenCache();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("sends JSON requests with credentials", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiFetch("/api/v1/test", { method: "POST", body: { name: "x" }, apiKey: "sk" })
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/test",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ name: "x" }),
      })
    );
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Api-Key")).toBe("sk");
  });

  test("decodes problem+json errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { status: 403, detail: "Forbidden", errorCode: "auth.forbidden" },
          { status: 403, headers: { "Content-Type": "application/problem+json" } }
        )
      )
    );

    await expect(apiFetch("/api/v1/test")).rejects.toMatchObject<ApiError>({
      status: 403,
      errorCode: "auth.forbidden",
      detail: "Forbidden",
    });
  });

  test("preserves diagnostic context for malformed JSON error bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{not-json", {
            status: 502,
            statusText: "Bad Gateway",
            headers: { "Content-Type": "application/problem+json" },
          })
      )
    );

    await expect(apiFetch("/api/v1/test")).rejects.toMatchObject<ApiError>({
      status: 502,
      errorCode: "api.malformed_error_body",
      detail: "{not-json",
    });
  });

  test("does not permanently cache failed CSRF token lookups", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: "temporary" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ csrfToken: "csrf-next" }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiFetch("/api/v1/test", { method: "POST", body: { name: "a" } })
    ).resolves.toEqual({ ok: true });
    await expect(
      apiFetch("/api/v1/test", { method: "POST", body: { name: "b" } })
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/auth/csrf",
      expect.objectContaining({ credentials: "include" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/auth/csrf",
      expect.objectContaining({ credentials: "include" })
    );
    const retryHeaders = fetchMock.mock.calls[3][1].headers as Headers;
    expect(retryHeaders.get("X-CCH-CSRF")).toBe("csrf-next");
  });

  test("refreshes cached CSRF tokens before the server window expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T00:00:00.000Z"));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ csrfToken: "csrf-old" }))
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ csrfToken: "csrf-new" }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiFetch("/api/v1/test", { method: "POST", body: { name: "a" } })
    ).resolves.toEqual({ ok: true });
    vi.advanceTimersByTime(26 * 60 * 1000);
    await expect(
      apiFetch("/api/v1/test", { method: "POST", body: { name: "b" } })
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/auth/csrf",
      expect.objectContaining({ credentials: "include" })
    );
    const firstHeaders = fetchMock.mock.calls[1][1].headers as Headers;
    const secondHeaders = fetchMock.mock.calls[3][1].headers as Headers;
    expect(firstHeaders.get("X-CCH-CSRF")).toBe("csrf-old");
    expect(secondHeaders.get("X-CCH-CSRF")).toBe("csrf-new");
  });
});
