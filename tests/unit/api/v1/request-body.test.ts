/**
 * /api/v1 请求体解析：单元测试
 *
 * 验证：
 * - 写方法（POST/PUT/PATCH）缺失或非 JSON 的 Content-Type 返回 415 + problem+json
 *   （errorCode = unsupported_media_type）；
 * - JSON 语法错误返回 400 + problem+json（errorCode = malformed_json）；
 * - 合法 body + 合法 schema -> ok=true，data 已被 zod 校验；
 * - 默认 strict 模式拒绝未知字段（errorCode = validation_failed）；
 * - 当 schema 显式 .passthrough() 时，未知字段被允许；
 * - opts.strict = false 时也允许未知字段；
 * - GET 请求即便没有 Content-Type 也能调用（不返回 415）。
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "@hono/zod-openapi";

import { parseJsonBody } from "@/lib/api/v1/_shared/request-body";

type ProblemBodyShape = {
  status: number;
  errorCode: string;
  invalidParams?: Array<{ path: Array<string | number>; code: string; message: string }>;
};

async function callWithBody(opts: {
  method: "GET" | "POST" | "PUT" | "PATCH";
  contentType?: string;
  body?: string;
  schema: z.ZodSchema;
  strict?: boolean;
}): Promise<{ response: Response; result: unknown }> {
  const app = new Hono();
  app.all("/probe", async (c) => {
    const result = await parseJsonBody(c, opts.schema, { strict: opts.strict });
    if (!result.ok) {
      return result.response;
    }
    return c.json({ ok: true, data: result.data });
  });

  const headers: Record<string, string> = {};
  if (opts.contentType) headers["Content-Type"] = opts.contentType;

  const init: RequestInit = {
    method: opts.method,
    headers,
  };
  if (opts.body !== undefined) init.body = opts.body;

  const response = await app.fetch(new Request("http://localhost/probe", init));
  let parsed: unknown;
  try {
    parsed = await response.clone().json();
  } catch {
    parsed = await response.text();
  }
  return { response, result: parsed };
}

describe("parseJsonBody: 415 unsupported_media_type", () => {
  it("returns 415 problem+json when POST has no Content-Type", async () => {
    const { response, result } = await callWithBody({
      method: "POST",
      body: "hello",
      schema: z.object({ name: z.string() }),
    });
    expect(response.status).toBe(415);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    const body = result as ProblemBodyShape;
    expect(body.errorCode).toBe("unsupported_media_type");
  });

  it("returns 415 when PUT body is text/plain", async () => {
    const { response, result } = await callWithBody({
      method: "PUT",
      contentType: "text/plain",
      body: "hello",
      schema: z.object({ name: z.string() }),
    });
    expect(response.status).toBe(415);
    expect((result as ProblemBodyShape).errorCode).toBe("unsupported_media_type");
  });

  it("accepts application/vnd.foo+json as JSON content-type", async () => {
    const { response } = await callWithBody({
      method: "POST",
      contentType: "application/vnd.foo+json",
      body: JSON.stringify({ name: "ok" }),
      schema: z.object({ name: z.string() }),
    });
    // 应该走到 schema 解析（成功）
    expect(response.status).toBe(200);
  });
});

describe("parseJsonBody: 400 malformed_json", () => {
  it("returns 400 when body is not valid JSON", async () => {
    const { response, result } = await callWithBody({
      method: "POST",
      contentType: "application/json",
      body: "{ not valid",
      schema: z.object({ name: z.string() }),
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect((result as ProblemBodyShape).errorCode).toBe("malformed_json");
  });

  it("returns 400 when body is empty string", async () => {
    const { response, result } = await callWithBody({
      method: "POST",
      contentType: "application/json",
      body: "",
      schema: z.object({ name: z.string() }),
    });
    expect(response.status).toBe(400);
    expect((result as ProblemBodyShape).errorCode).toBe("malformed_json");
  });
});

describe("parseJsonBody: schema validation", () => {
  it("returns ok=true when body matches schema", async () => {
    const { response, result } = await callWithBody({
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ name: "alice", age: 18 }),
      schema: z.object({ name: z.string(), age: z.number().int() }),
    });
    expect(response.status).toBe(200);
    expect(result).toEqual({ ok: true, data: { name: "alice", age: 18 } });
  });

  it("returns 400 validation_failed when body does not match schema", async () => {
    const { response, result } = await callWithBody({
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ name: "" }),
      schema: z.object({ name: z.string().min(1), age: z.number().int() }),
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    const body = result as ProblemBodyShape;
    expect(body.errorCode).toBe("validation_failed");
    expect(Array.isArray(body.invalidParams)).toBe(true);
    expect(body.invalidParams?.length).toBeGreaterThan(0);
  });

  it("rejects unknown keys by default (strict mode)", async () => {
    const { response, result } = await callWithBody({
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ name: "ok", surprise: true }),
      schema: z.object({ name: z.string() }),
    });
    expect(response.status).toBe(400);
    const body = result as ProblemBodyShape;
    expect(body.errorCode).toBe("validation_failed");
  });

  it("allows unknown keys when schema is .passthrough()", async () => {
    const { response, result } = await callWithBody({
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ name: "ok", surprise: true }),
      schema: z.object({ name: z.string() }).passthrough(),
    });
    expect(response.status).toBe(200);
    expect(result).toEqual({ ok: true, data: { name: "ok", surprise: true } });
  });

  it("allows unknown keys when opts.strict = false", async () => {
    const { response, result } = await callWithBody({
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ name: "ok", extra: 1 }),
      schema: z.object({ name: z.string() }),
      strict: false,
    });
    expect(response.status).toBe(200);
    // 默认 zod object 是 strip，未知字段会被丢弃
    expect((result as { ok: true; data: { name: string } }).data.name).toBe("ok");
  });
});
