/**
 * /api/v1 problem+json 错误信封：单元测试
 *
 * 验证：
 * - problem(...) 返回 application/problem+json 内容类型；
 * - 必填字段（type/title/status/instance/errorCode/traceId）齐备；
 * - errorParams / detail / invalidParams 在传入时透传；
 * - fromZodError 把 zod issues 转换为 invalidParams，并固定 status=400, errorCode="validation_failed"；
 * - fromActionError 把 ActionResult.error 包装为 problem，errorCode 优先取自 err.errorCode；
 * - withProblemContentType 把 application/json 改写为 application/problem+json，
 *   对其它 content-type 不动手。
 *
 * 这些 helper 不依赖 Hono 路由匹配，因此用一个最简单的 Hono app + test handler
 * 来构造一个真正的 Context（`c.req.path` 可读）。
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "@hono/zod-openapi";

import {
  fromActionError,
  fromZodError,
  problem,
  withProblemContentType,
} from "@/lib/api/v1/_shared/error-envelope";

type ProblemBodyShape = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errorCode: string;
  errorParams?: Record<string, string | number>;
  traceId: string;
  invalidParams?: Array<{ path: Array<string | number>; code: string; message: string }>;
};

async function runHelper(
  pathname: string,
  build: (c: import("hono").Context) => Response
): Promise<{ response: Response; body: ProblemBodyShape }> {
  const app = new Hono();
  app.all("*", (c) => build(c));
  const response = await app.fetch(new Request(`http://localhost${pathname}`));
  const body = (await response.json()) as ProblemBodyShape;
  return { response, body };
}

describe("error-envelope: problem(...)", () => {
  it("returns RFC 9457-shaped body with required fields and problem+json content-type", async () => {
    const { response, body } = await runHelper("/api/v1/anything", (c) =>
      problem(c, {
        status: 400,
        errorCode: "provider.validation_failed",
        title: "Validation failed",
        detail: "One or more fields are invalid.",
        errorParams: { field: "name" },
      })
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/problem+json");

    expect(body.status).toBe(400);
    expect(body.title).toBe("Validation failed");
    expect(body.detail).toBe("One or more fields are invalid.");
    expect(body.type).toBe("about:blank");
    expect(body.instance).toBe("/api/v1/anything");
    expect(body.errorCode).toBe("provider.validation_failed");
    expect(body.errorParams).toEqual({ field: "name" });
    expect(typeof body.traceId).toBe("string");
    expect(body.traceId.length).toBeGreaterThan(0);
    // 当未传 validation 时不应该出现 invalidParams 字段
    expect(body.invalidParams).toBeUndefined();
  });

  it("falls back to a default title when not provided", async () => {
    const { body } = await runHelper("/api/v1/x", (c) =>
      problem(c, { status: 404, errorCode: "user.not_found" })
    );
    expect(body.title).toBe("Not Found");
    expect(body.errorCode).toBe("user.not_found");
  });

  it("uses custom instance when supplied", async () => {
    const { body } = await runHelper("/api/v1/users", (c) =>
      problem(c, {
        status: 409,
        errorCode: "user.duplicate",
        instance: "/api/v1/users/conflict",
      })
    );
    expect(body.instance).toBe("/api/v1/users/conflict");
  });
});

describe("error-envelope: fromZodError(...)", () => {
  it("translates zod issues into invalidParams with status 400", async () => {
    const schema = z.object({
      name: z.string().min(1),
      age: z.number().int().min(0),
    });
    const result = schema.safeParse({ name: "", age: -1 });
    expect(result.success).toBe(false);
    if (result.success) return;

    const { response, body } = await runHelper("/api/v1/users", (c) =>
      fromZodError(c, result.error)
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(body.errorCode).toBe("validation_failed");
    expect(body.title).toBe("Validation failed");
    expect(Array.isArray(body.invalidParams)).toBe(true);
    expect(body.invalidParams?.length).toBeGreaterThanOrEqual(2);
    const paths = body.invalidParams?.map((p) => p.path.join(".")) ?? [];
    expect(paths).toContain("name");
    expect(paths).toContain("age");
    for (const p of body.invalidParams ?? []) {
      expect(typeof p.code).toBe("string");
      expect(typeof p.message).toBe("string");
    }
  });
});

describe("error-envelope: fromActionError(...)", () => {
  it("uses err.errorCode and err.error fields when wrapping legacy ActionResult", async () => {
    const { response, body } = await runHelper("/api/v1/users", (c) =>
      fromActionError(c, 409, {
        ok: false,
        error: "Username already taken",
        errorCode: "user.duplicate",
        errorParams: { name: "tester" },
      })
    );

    expect(response.status).toBe(409);
    expect(body.status).toBe(409);
    expect(body.errorCode).toBe("user.duplicate");
    expect(body.detail).toBe("Username already taken");
    expect(body.errorParams).toEqual({ name: "tester" });
    expect(typeof body.traceId).toBe("string");
  });

  it("falls back to internal_error when err.errorCode is missing", async () => {
    const { body } = await runHelper("/api/v1/x", (c) =>
      fromActionError(c, 500, { ok: false, error: "boom" })
    );
    expect(body.errorCode).toBe("internal_error");
  });
});

describe("error-envelope: withProblemContentType(...)", () => {
  it("rewrites application/json to application/problem+json", () => {
    const original = new Response('{"ok": true}', {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
    const fixed = withProblemContentType(original);
    expect(fixed.headers.get("content-type")).toBe("application/problem+json");
    expect(fixed.status).toBe(400);
  });

  it("does not touch already-problem responses", () => {
    const original = new Response("{}", {
      status: 400,
      headers: { "Content-Type": "application/problem+json; charset=utf-8" },
    });
    const fixed = withProblemContentType(original);
    expect(fixed).toBe(original);
  });

  it("does not touch non-JSON responses", () => {
    const original = new Response("plain", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
    const fixed = withProblemContentType(original);
    expect(fixed.headers.get("content-type")).toBe("text/plain");
  });
});
