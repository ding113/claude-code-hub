/**
 * /api/v1 fetcher 行为单元测试。
 *
 * 覆盖：
 * - 4xx + application/problem+json -> 抛出结构化 ApiError；
 * - 200 OK -> resolve Response；
 * - AbortError -> 透传（不被吞掉）；
 * - cookie 鉴权 + 突变动词 + /auth/csrf 返回 404 -> 优雅降级（不带 X-CCH-CSRF）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetCsrfTokenCacheForTests, ApiError, fetchApi } from "@/lib/api-client/v1/client";

const ORIGINAL_FETCH = globalThis.fetch;

function buildProblemJsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/problem+json",
    },
  });
}

beforeEach(() => {
  __resetCsrfTokenCacheForTests();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe("fetchApi", () => {
  it("throws ApiError when response is application/problem+json with non-2xx status", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      buildProblemJsonResponse(400, {
        type: "https://example.com/errors/validation",
        title: "Validation failed",
        status: 400,
        detail: "Field name is required",
        instance: "/api/v1/widgets",
        errorCode: "VALIDATION_FAILED",
        errorParams: { field: "name" },
        invalidParams: [{ path: "body.name", message: "Required", code: "required" }],
        traceId: "trace-abc",
      })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(fetchApi("/api/v1/widgets", { method: "GET" })).rejects.toMatchObject({
      status: 400,
      errorCode: "VALIDATION_FAILED",
      title: "Validation failed",
      detail: "Field name is required",
      traceId: "trace-abc",
      instance: "/api/v1/widgets",
    });

    const captured = fetchMock.mock.calls[0];
    expect(captured?.[0]).toBe("/api/v1/widgets");
  });

  it("resolves the original Response on 200 OK", async () => {
    const okBody = JSON.stringify({ ok: true });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(okBody, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await fetchApi("/api/v1/widgets", { method: "GET" });
    expect(result.status).toBe(200);
    expect(await result.text()).toBe(okBody);
  });

  it("rethrows AbortError unchanged", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const fetchMock = vi.fn().mockRejectedValueOnce(abortError);
    globalThis.fetch = fetchMock as typeof fetch;

    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchApi("/api/v1/widgets", { method: "GET", signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("for cookie-auth POST, gracefully proceeds without CSRF when /auth/csrf returns 404", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });
      if (url.endsWith("/api/v1/auth/csrf")) {
        return new Response("Not Found", { status: 404 });
      }
      // POST /api/v1/widgets returns 201
      return new Response(JSON.stringify({ id: 1 }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await fetchApi("/api/v1/widgets", {
      method: "POST",
      body: JSON.stringify({ name: "x" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(201);
    // 校验 POST 请求上没有 X-CCH-CSRF（CSRF 端点 404 时降级）
    const postCall = calls.find((c) => c.url.endsWith("/api/v1/widgets"));
    expect(postCall).toBeDefined();
    const headers = new Headers(postCall?.init?.headers);
    expect(headers.has("x-cch-csrf")).toBe(false);
    // 同时校验 POST 调用使用 credentials: include
    expect((postCall?.init as RequestInit | undefined)?.credentials).toBe("include");
  });

  it("decodes problem+json with minimal fields (status fallback to response.status)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(buildProblemJsonResponse(500, { title: "Internal Error" }));
    globalThis.fetch = fetchMock as typeof fetch;

    let caught: unknown = null;
    try {
      await fetchApi("/api/v1/widgets");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({
      status: 500,
      title: "Internal Error",
      errorCode: "UNKNOWN_ERROR",
    });
  });
});
