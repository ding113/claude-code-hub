/**
 * /api/v1 缓存控制辅助
 *
 * 设计要点：
 * - 默认所有响应应该是 `no-store`（管理 API 涉及敏感数据），handler 通过 setNoStore 显式声明；
 * - 少数读端点（例如 me/today 这种近实时只读）可允许短期 private cache；
 * - 这些 helper 直接修改 c.res.headers，不构造新 Response，便于在 handler 末尾调用。
 */

import type { Context } from "hono";
import { HEADER_NAMES } from "./constants";

/** 默认缓存值常量（导出后给 handler / 单测使用） */
export const CACHE_NONE = "no-store, no-cache, must-revalidate";
export const CACHE_PRIVATE_SHORT = "private, max-age=60";

/**
 * 把响应标记为不可缓存。
 *
 * 同时设置 Pragma:no-cache，兼容老 HTTP/1.0 缓存层。
 */
export function setNoStore(c: Context): void {
  c.header(HEADER_NAMES.CacheControl, CACHE_NONE);
  c.header(HEADER_NAMES.Pragma, "no-cache");
}

/**
 * 把响应标记为短期 private 缓存。
 *
 * @param seconds 必须是非负整数
 */
export function setShortCache(c: Context, seconds: number): void {
  if (!Number.isFinite(seconds) || !Number.isInteger(seconds) || seconds < 0) {
    throw new TypeError("setShortCache requires a non-negative integer seconds");
  }
  c.header(HEADER_NAMES.CacheControl, `private, max-age=${seconds}`);
}
