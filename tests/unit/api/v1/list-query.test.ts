/**
 * /api/v1 分页：单元测试
 *
 * 验证：
 * - parsePageQuery 默认值（page=1, pageSize=20），上下界（min=1, max=100）；
 * - parseCursorQuery 默认 limit=20，cursor 是可选字符串；
 * - 来自 query string 的字符串数字会被正确解析；
 * - encode/decodeCursor 往返一致；非法 cursor token 抛错；
 * - PageResponseSchema / CursorResponseSchema 结构正确（含 items 与 pageInfo）。
 */

import { describe, expect, it } from "vitest";
import { z } from "@hono/zod-openapi";

import {
  CursorResponseSchema,
  decodeCursor,
  encodeCursor,
  PageResponseSchema,
  parseCursorQuery,
  parsePageQuery,
} from "@/lib/api/v1/_shared/pagination";

describe("parsePageQuery", () => {
  it("returns defaults when input is empty", () => {
    expect(parsePageQuery({})).toEqual({ page: 1, pageSize: 20 });
    expect(parsePageQuery(undefined)).toEqual({ page: 1, pageSize: 20 });
  });

  it("accepts numbers and string-encoded numbers from query strings", () => {
    expect(parsePageQuery({ page: 3, pageSize: 50 })).toEqual({ page: 3, pageSize: 50 });
    expect(parsePageQuery({ page: "2", pageSize: "10" })).toEqual({ page: 2, pageSize: 10 });
  });

  it("rejects non-integer / out-of-range values", () => {
    expect(() => parsePageQuery({ page: 0 })).toThrow();
    expect(() => parsePageQuery({ pageSize: 0 })).toThrow();
    expect(() => parsePageQuery({ pageSize: 1000 })).toThrow();
    expect(() => parsePageQuery({ page: "x" })).toThrow();
    expect(() => parsePageQuery({ page: 1.5 })).toThrow();
  });
});

describe("parseCursorQuery", () => {
  it("returns defaults when input is empty", () => {
    expect(parseCursorQuery({})).toEqual({ cursor: undefined, limit: 20 });
  });

  it("preserves the cursor string and parses limit", () => {
    const out = parseCursorQuery({ cursor: "abc", limit: "5" });
    expect(out).toEqual({ cursor: "abc", limit: 5 });
  });

  it("rejects out-of-range or non-integer limit", () => {
    expect(() => parseCursorQuery({ limit: 0 })).toThrow();
    expect(() => parseCursorQuery({ limit: 1000 })).toThrow();
    expect(() => parseCursorQuery({ limit: "1.5" })).toThrow();
  });
});

describe("encode/decode cursor", () => {
  it("round-trips createdAt+id", () => {
    const payload = { createdAt: "2025-04-28T13:45:00.000Z", id: 42 };
    const token = encodeCursor(payload);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
    expect(decodeCursor(token)).toEqual(payload);
  });

  it("rejects malformed tokens", () => {
    expect(() => decodeCursor("not-a-valid-token")).toThrow();
    expect(() => decodeCursor("")).toThrow();
    // 缺少 | 分隔符
    expect(() => decodeCursor(Buffer.from("nopipe", "utf8").toString("base64url"))).toThrow();
    // 非法 id
    expect(() =>
      decodeCursor(Buffer.from("2025-04-28T13:45:00.000Z|abc", "utf8").toString("base64url"))
    ).toThrow();
    // 非法 createdAt
    expect(() => decodeCursor(Buffer.from("not-iso|1", "utf8").toString("base64url"))).toThrow();
  });

  it("rejects invalid encode input", () => {
    expect(() => encodeCursor({ createdAt: "", id: 1 })).toThrow();
    expect(() => encodeCursor({ createdAt: "2025-01-01T00:00:00Z", id: -1 })).toThrow();
    expect(() => encodeCursor({ createdAt: "2025-01-01T00:00:00Z", id: 1.5 })).toThrow();
  });
});

describe("list response schemas", () => {
  const userSchema = z.object({ id: z.number(), name: z.string() }).describe("User");

  it("PageResponseSchema parses a well-formed page", () => {
    const schema = PageResponseSchema(userSchema);
    const ok = schema.parse({
      items: [{ id: 1, name: "a" }],
      pageInfo: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    expect(ok.items.length).toBe(1);
    expect(ok.pageInfo.totalPages).toBe(1);
  });

  it("PageResponseSchema rejects negative totals", () => {
    const schema = PageResponseSchema(userSchema);
    expect(() =>
      schema.parse({
        items: [],
        pageInfo: { page: 1, pageSize: 20, total: -1, totalPages: 0 },
      })
    ).toThrow();
  });

  it("CursorResponseSchema accepts null nextCursor", () => {
    const schema = CursorResponseSchema(userSchema);
    const ok = schema.parse({
      items: [{ id: 1, name: "a" }],
      pageInfo: { nextCursor: null, hasMore: false, limit: 20 },
    });
    expect(ok.pageInfo.nextCursor).toBeNull();
    expect(ok.pageInfo.hasMore).toBe(false);
  });

  it("CursorResponseSchema rejects non-boolean hasMore", () => {
    const schema = CursorResponseSchema(userSchema);
    expect(() =>
      schema.parse({
        items: [],
        pageInfo: { nextCursor: null, hasMore: "yes", limit: 20 },
      })
    ).toThrow();
  });
});
