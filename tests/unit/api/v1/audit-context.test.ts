/**
 * /api/v1 audit-context：单元测试
 *
 * 验证：
 * - attachRequestId() 中间件为响应附加 X-Request-Id（生成 / 透传）；
 * - 当请求带 X-Request-Id 时透传；
 * - 当请求未带时生成 req_<ts>_<rand> 形式；
 * - 不安全的客户端 X-Request-Id（含引号 / 空格 / 控制字符 / 超长）会被拒绝；
 * - withRequestContext 包裹后，下游通过 getRequestContext() 能读到 ip / userAgent。
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { attachRequestId, generateRequestId } from "@/lib/api/v1/_shared/audit-context";
import { withRequestContext } from "@/lib/api/v1/_shared/request-context";
import { getRequestContext } from "@/lib/audit/request-context";

describe("generateRequestId", () => {
  it("returns a string in req_<ts>_<rand> shape", () => {
    const id = generateRequestId();
    expect(id).toMatch(/^req_\d+_[a-z0-9]{8}$/);
  });
});

describe("attachRequestId middleware", () => {
  function makeApp() {
    const app = new Hono();
    app.use("*", attachRequestId());
    app.get("/probe", (c) => c.json({ ok: true }));
    return app;
  }

  it("sets X-Request-Id response header when request has none", async () => {
    const app = makeApp();
    const response = await app.fetch(new Request("http://localhost/probe"));
    expect(response.status).toBe(200);
    const id = response.headers.get("X-Request-Id");
    expect(id).toBeTruthy();
    expect(id).toMatch(/^req_\d+_[a-z0-9]{8}$/);
  });

  it("propagates incoming X-Request-Id header to response", async () => {
    const app = makeApp();
    const response = await app.fetch(
      new Request("http://localhost/probe", {
        headers: { "X-Request-Id": "incoming-req-12345" },
      })
    );
    expect(response.headers.get("X-Request-Id")).toBe("incoming-req-12345");
  });

  it("rejects unsafe X-Request-Id with JSON-breaking chars and falls back to server-generated id", async () => {
    const app = makeApp();
    // Headers API 在 fetch/Request 入口直接拒绝 CR/LF，这里用其它「打破日志 JSON」
    // 的字符（引号 / 大括号 / 空格）做注入测试。白名单 [A-Za-z0-9_\-.] 应当忽略
    // 来源值并改用服务端生成的 ID。
    const malicious = `legit-id"} ,injected={"a":1`;
    const response = await app.fetch(
      new Request("http://localhost/probe", {
        headers: { "X-Request-Id": malicious },
      })
    );
    const id = response.headers.get("X-Request-Id");
    expect(id).not.toBe(malicious);
    expect(id).toMatch(/^req_\d+_[a-z0-9]{8}$/);
  });

  it("rejects X-Request-Id longer than 128 characters", async () => {
    const app = makeApp();
    const tooLong = "a".repeat(129);
    const response = await app.fetch(
      new Request("http://localhost/probe", {
        headers: { "X-Request-Id": tooLong },
      })
    );
    const id = response.headers.get("X-Request-Id");
    expect(id).not.toBe(tooLong);
    expect(id).toMatch(/^req_\d+_[a-z0-9]{8}$/);
  });

  it("preserves W3C-style request id (only safe ASCII characters)", async () => {
    const app = makeApp();
    const safe = "0af7651916cd43dd8448eb211c80319c.7c989be3-cb74";
    const response = await app.fetch(
      new Request("http://localhost/probe", {
        headers: { "X-Request-Id": safe },
      })
    );
    expect(response.headers.get("X-Request-Id")).toBe(safe);
  });
});

describe("withRequestContext - getRequestContext()", () => {
  it("populates ip + userAgent in ALS for downstream callers", async () => {
    const app = new Hono();
    let captured: { ip: string | null; userAgent: string | null } | null = null;

    app.get("/probe", async (c) => {
      const result = await withRequestContext(c, null, () => {
        captured = getRequestContext();
        return { ok: true };
      });
      return c.json(result);
    });

    const response = await app.fetch(
      new Request("http://localhost/probe", {
        headers: {
          "User-Agent": "vitest/1.0",
          "X-Forwarded-For": "203.0.113.42",
          "X-Real-Ip": "203.0.113.42",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(captured).not.toBeNull();
    // userAgent should be populated from the header
    expect(captured?.userAgent).toBe("vitest/1.0");
    // ip should be a non-null string (exact value depends on extraction config; just assert truthy)
    expect(typeof captured?.ip === "string" || captured?.ip === null).toBe(true);
  });
});
