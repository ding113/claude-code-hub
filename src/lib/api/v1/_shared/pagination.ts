/**
 * /api/v1 通用分页：page/pageSize 与 cursor。
 *
 * 设计要点：
 * - 输入 schema 用于解析 query string，因此对字符串数字提供 transform，
 *   但不使用 `z.coerce.boolean()`（该项目禁止）。
 * - 输出 schema 是泛型工厂（接收 itemSchema），便于在每个资源处复用：
 *     PageResponseSchema(UserSchema)
 *     CursorResponseSchema(UsageLogSchema)
 * - cursor 编码使用 base64url（`createdAt|id`），decode 时严格校验。
 */

import { z } from "@hono/zod-openapi";
import { IsoDateTimeSchema } from "./serialization";

// ==================== 默认值 ====================

const DEFAULT_PAGE = 1;
const MIN_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

// ==================== Page schema ====================

/** 把字符串/数字 -> 整数；非法值在 z.int 报错前抛 NaN */
const optionalIntFromQuery = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === "") return undefined;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      ctx.addIssue({
        code: "custom",
        message: "must be an integer",
      });
      return z.NEVER;
    }
    return n;
  });

export const PageQuerySchema = z
  .object({
    page: optionalIntFromQuery
      .pipe(z.number().int().min(MIN_PAGE).optional())
      .describe("Page number (1-based)"),
    pageSize: optionalIntFromQuery
      .pipe(z.number().int().min(MIN_LIMIT).max(MAX_LIMIT).optional())
      .describe("Items per page (1-100)"),
  })
  .describe("Page-based list query")
  .openapi({
    example: { page: 1, pageSize: 20 },
  });

export type PageQuery = {
  page: number;
  pageSize: number;
};

/**
 * 解析 page-based 查询参数（支持来自 query string 的字符串）。
 * 返回值带默认值并保证范围合法。
 */
export function parsePageQuery(input: unknown): PageQuery {
  const parsed = PageQuerySchema.parse(input ?? {});
  return {
    page: parsed.page ?? DEFAULT_PAGE,
    pageSize: parsed.pageSize ?? DEFAULT_LIMIT,
  };
}

// ==================== Cursor schema ====================

export const CursorQuerySchema = z
  .object({
    cursor: z.string().min(1).optional().describe("Opaque cursor token"),
    limit: optionalIntFromQuery
      .pipe(z.number().int().min(MIN_LIMIT).max(MAX_LIMIT).optional())
      .describe("Items per page (1-100)"),
  })
  .describe("Cursor-based list query")
  .openapi({
    example: { cursor: undefined, limit: 20 },
  });

export type CursorQuery = {
  cursor: string | undefined;
  limit: number;
};

export function parseCursorQuery(input: unknown): CursorQuery {
  const parsed = CursorQuerySchema.parse(input ?? {});
  return {
    cursor: parsed.cursor,
    limit: parsed.limit ?? DEFAULT_LIMIT,
  };
}

// ==================== Cursor encoding ====================

export type CursorPayload = {
  createdAt: string;
  id: number;
};

/** 把 createdAt+id 编码成 base64url 不透明 token */
export function encodeCursor(payload: CursorPayload): string {
  if (!payload.createdAt || !Number.isInteger(payload.id) || payload.id < 0) {
    throw new TypeError(
      "encodeCursor requires a non-empty createdAt and a non-negative integer id"
    );
  }
  const raw = `${payload.createdAt}|${payload.id}`;
  // base64url, 兼容 Node 与浏览器。
  const buf = Buffer.from(raw, "utf8");
  return buf.toString("base64url");
}

/** 解码 cursor token；非法时抛错 */
export function decodeCursor(token: string): CursorPayload {
  if (typeof token !== "string" || token.length === 0) {
    throw new TypeError("decodeCursor requires a non-empty string");
  }
  let raw: string;
  try {
    raw = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    throw new TypeError("decodeCursor: invalid base64url token");
  }
  if (!raw.includes("|")) {
    throw new TypeError("decodeCursor: malformed payload");
  }
  const [createdAt, idStr] = raw.split("|", 2);
  if (!createdAt || !idStr) {
    throw new TypeError("decodeCursor: missing createdAt or id");
  }
  const id = Number(idStr);
  if (!Number.isFinite(id) || !Number.isInteger(id) || id < 0) {
    throw new TypeError("decodeCursor: id is not a non-negative integer");
  }
  // 校验 createdAt 是合法 ISO 时间。
  // 不能用 `Date.parse`：它接受很多非严格 ISO 形态（例如 "Apr 28 2025"），
  // 与本模块对外承诺的「严格 ISO datetime cursor」契约不一致；攻击者
  // 完全可以构造一个 Date.parse 接受、但不符合 OpenAPI schema 的 token。
  if (!IsoDateTimeSchema.safeParse(createdAt).success) {
    throw new TypeError("decodeCursor: createdAt is not a valid ISO timestamp");
  }
  return { createdAt, id };
}

// ==================== Response schemas ====================

const PageInfoSchema = z
  .object({
    page: z.number().int().min(0).describe("Current page (1-based)"),
    pageSize: z.number().int().min(0).describe("Items per page"),
    total: z.number().int().min(0).describe("Total item count across all pages"),
    totalPages: z.number().int().min(0).describe("Total page count"),
  })
  .describe("Page-based pagination metadata");

const CursorInfoSchema = z
  .object({
    nextCursor: z.string().nullable().describe("Token for next page; null when no more"),
    hasMore: z.boolean().describe("True when next page exists"),
    limit: z.number().int().min(MIN_LIMIT).max(MAX_LIMIT).describe("Items per page"),
  })
  .describe("Cursor-based pagination metadata");

/** 工厂：page-based 响应 */
export function PageResponseSchema<T extends z.ZodType>(itemSchema: T) {
  return z
    .object({
      items: z.array(itemSchema).describe("Items on this page"),
      pageInfo: PageInfoSchema,
    })
    .describe("Page-based list response");
}

/** 工厂：cursor-based 响应 */
export function CursorResponseSchema<T extends z.ZodType>(itemSchema: T) {
  return z
    .object({
      items: z.array(itemSchema).describe("Items in this batch"),
      pageInfo: CursorInfoSchema,
    })
    .describe("Cursor-based list response");
}

export const PAGINATION_DEFAULTS = {
  PAGE: DEFAULT_PAGE,
  LIMIT: DEFAULT_LIMIT,
  MIN_PAGE,
  MIN_LIMIT,
  MAX_LIMIT,
} as const;

// 让 IsoDateTimeSchema 能从 _common.ts 处一并 re-export。
export { IsoDateTimeSchema };
