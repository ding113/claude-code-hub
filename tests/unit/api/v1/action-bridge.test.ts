/**
 * action-bridge.ts unit tests.
 *
 * 验证：
 * - 成功 ActionResult 透传 data；
 * - 失败 ActionResult 翻译为 problem+json，errorCode 决定 HTTP 状态；
 * - action 抛错 → 500 problem+json，errorCode = internal_error；
 * - treatRawAsActionResult 模式把任意原值视为成功 data；
 * - 非 ActionResult 形态的返回值被视为错误。
 */

import "../../../server-only.mock";

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { attachRequestId, SESSION_CONTEXT_KEY } from "@/lib/api/v1/_shared/audit-context";

function makeApp() {
  const app = new Hono();
  app.use("*", attachRequestId());
  return app;
}

describe("callAction", () => {
  it("returns data on ActionResult success", async () => {
    const app = makeApp();
    app.get("/", async (c) => {
      c.set(SESSION_CONTEXT_KEY, null);
      const result = await callAction<{ x: number }>(
        c,
        async () => ({ ok: true, data: { x: 42 } }),
        []
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        return c.json(result.data);
      }
      return result.problem;
    });

    const res = await app.request("http://localhost/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { x: number };
    expect(body.x).toBe(42);
  });

  it("translates ActionResult error to problem+json with mapped status", async () => {
    const app = makeApp();
    app.get("/", async (c) => {
      c.set(SESSION_CONTEXT_KEY, null);
      const result = await callAction(
        c,
        async () => ({ ok: false, error: "not allowed", errorCode: "forbidden" }),
        []
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        return result.problem;
      }
      return c.json({ unreachable: true });
    });

    const res = await app.request("http://localhost/");
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = (await res.json()) as { errorCode: string; status: number };
    expect(body.errorCode).toBe("forbidden");
    expect(body.status).toBe(403);
  });

  it("returns 500 problem+json when action throws", async () => {
    const app = makeApp();
    app.get("/", async (c) => {
      c.set(SESSION_CONTEXT_KEY, null);
      const result = await callAction(c, async () => {
        throw new Error("kaboom");
      }, []);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        return result.problem;
      }
      return c.json({ unreachable: true });
    });

    const res = await app.request("http://localhost/");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = (await res.json()) as { errorCode: string };
    expect(body.errorCode).toBe("internal_error");
  });

  it("treatRawAsActionResult wraps a raw return value as success data", async () => {
    const app = makeApp();
    app.get("/", async (c) => {
      c.set(SESSION_CONTEXT_KEY, null);
      const result = await callAction<{ count: number }>(c, async () => ({ count: 7 }), [], {
        treatRawAsActionResult: true,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        return c.json(result.data);
      }
      return result.problem;
    });

    const res = await app.request("http://localhost/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(7);
  });

  it("rejects non-ActionResult shape with internal_error when treatRawAsActionResult is false", async () => {
    const app = makeApp();
    app.get("/", async (c) => {
      c.set(SESSION_CONTEXT_KEY, null);
      const result = await callAction(c, async () => "plain-string", []);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        return result.problem;
      }
      return c.json({ unreachable: true });
    });

    const res = await app.request("http://localhost/");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { errorCode: string };
    expect(body.errorCode).toBe("internal_error");
  });
});
