/**
 * /api/v1 缓存控制：单元测试
 *
 * 验证：
 * - setNoStore 把 Cache-Control / Pragma 写到响应头；
 * - setShortCache 接受非负整数秒，写出 private, max-age=N；
 * - 非法秒数（负数 / 浮点 / NaN）抛错；
 * - 常量 CACHE_NONE / CACHE_PRIVATE_SHORT 与默认值对齐；
 * - respondJson 拒绝非 2xx 状态码；
 * - respondJson 的 noStore 选项把缓存头写到返回的 Response 上（避免 setNoStore(c) 被丢弃）。
 *
 * 通过把 helper 套在一个 Hono handler 内部、对该 app 发一次 fetch 来观察响应头。
 */

import type { Context } from "hono";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import {
  CACHE_NONE,
  CACHE_PRIVATE_SHORT,
  setNoStore,
  setShortCache,
} from "@/lib/api/v1/_shared/cache-control";
import { respondJson } from "@/lib/api/v1/_shared/response-helpers";

async function runHandler(handler: (c: import("hono").Context) => Response): Promise<Response> {
  const app = new Hono();
  app.get("/probe", (c) => handler(c));
  return app.fetch(new Request("http://localhost/probe"));
}

describe("setNoStore", () => {
  it("writes Cache-Control: no-store, no-cache, must-revalidate and Pragma: no-cache", async () => {
    const response = await runHandler((c) => {
      setNoStore(c);
      return c.json({ ok: true });
    });

    expect(response.headers.get("cache-control")).toBe("no-store, no-cache, must-revalidate");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  it("CACHE_NONE constant equals what setNoStore writes", () => {
    expect(CACHE_NONE).toBe("no-store, no-cache, must-revalidate");
  });
});

describe("setShortCache", () => {
  it("writes Cache-Control: private, max-age=N", async () => {
    const response = await runHandler((c) => {
      setShortCache(c, 60);
      return c.json({ ok: true });
    });
    expect(response.headers.get("cache-control")).toBe("private, max-age=60");
  });

  it("supports max-age=0", async () => {
    const response = await runHandler((c) => {
      setShortCache(c, 0);
      return c.json({ ok: true });
    });
    expect(response.headers.get("cache-control")).toBe("private, max-age=0");
  });

  it("rejects negative / non-integer / non-finite seconds", () => {
    const dummyCtx = { header: () => undefined } as unknown as import("hono").Context;
    expect(() => setShortCache(dummyCtx, -1)).toThrow();
    expect(() => setShortCache(dummyCtx, 1.5)).toThrow();
    expect(() => setShortCache(dummyCtx, Number.NaN)).toThrow();
    expect(() => setShortCache(dummyCtx, Number.POSITIVE_INFINITY)).toThrow();
  });

  it("CACHE_PRIVATE_SHORT constant matches private, max-age=60", () => {
    expect(CACHE_PRIVATE_SHORT).toBe("private, max-age=60");
  });
});

describe("respondJson - status range guard + noStore option", () => {
  function dummyContext(): Context {
    return { req: { path: "/probe" } } as unknown as Context;
  }

  it("rejects non-2xx status (use problem(...) for errors)", () => {
    expect(() => respondJson(dummyContext(), { x: 1 }, 400)).toThrow(/2xx/);
    expect(() => respondJson(dummyContext(), { x: 1 }, 500)).toThrow(/2xx/);
  });

  it("accepts common 2xx statuses (200 / 201 / 202 / 207)", () => {
    expect(respondJson(dummyContext(), { x: 1 }, 200).status).toBe(200);
    expect(respondJson(dummyContext(), { x: 1 }, 201).status).toBe(201);
    expect(respondJson(dummyContext(), { x: 1 }, 202).status).toBe(202);
    expect(respondJson(dummyContext(), { x: 1 }, 207).status).toBe(207);
  });

  it("does not write Cache-Control / Pragma by default", () => {
    const response = respondJson(dummyContext(), { x: 1 }, 200);
    expect(response.headers.get("Cache-Control")).toBeNull();
    expect(response.headers.get("Pragma")).toBeNull();
  });

  it("noStore: true writes Cache-Control and Pragma onto the returned Response", () => {
    // 这是修复 setNoStore(c) 被丢弃问题的关键路径：
    // handler 直接 return 一个 fresh Response 时，c.res 上的缓存头会被丢弃，
    // 必须把缓存头写到这个最终返回的 Response 上。
    const response = respondJson(dummyContext(), { x: 1 }, 200, { noStore: true });
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate");
    expect(response.headers.get("Pragma")).toBe("no-cache");
  });
});
