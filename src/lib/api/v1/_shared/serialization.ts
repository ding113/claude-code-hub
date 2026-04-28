/**
 * /api/v1 序列化辅助
 *
 * 约束：
 * - 所有响应中的日期/时间字段必须是 ISO 8601 字符串（带时区偏移），
 *   不允许使用 z.date()。本模块同时提供运行时校验工具
 *   `assertNoZodDateInSchema` 用于回归测试。
 * - 所有 JSON 转换工具都遵守「null safe」语义，便于在 handler 中直接组装响应体。
 */

import { z } from "@hono/zod-openapi";

/**
 * ISO 8601 / RFC 3339 日期时间，必须带时区偏移。
 *
 * 例如 `2025-04-28T13:45:00.123Z` 或 `2025-04-28T13:45:00+08:00`。
 *
 * 直接使用 `z.string().datetime({ offset: true })`（这是 zod 4 支持的写法），
 * 而不是 `z.iso.datetime`，以便保持 schema 在 OpenAPI 中输出 `format: date-time`。
 */
export const IsoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .describe("ISO 8601 with timezone offset")
  .openapi({
    example: "2025-04-28T13:45:00.000Z",
    format: "date-time",
  });

/**
 * 将 Date / null / undefined 统一序列化为 ISO 字符串或 null。
 *
 * - `null` / `undefined` -> `null`
 * - `Date`（且时间合法） -> `toISOString()`
 * - `Date`（NaN/Invalid） -> 抛出，避免静默写出 "Invalid Date"
 */
export function dateToIso(date: Date | null | undefined): string | null {
  if (date === null || date === undefined) {
    return null;
  }
  if (!(date instanceof Date)) {
    throw new TypeError("dateToIso received a non-Date value");
  }
  const time = date.getTime();
  if (Number.isNaN(time)) {
    throw new RangeError("dateToIso received an invalid Date");
  }
  return date.toISOString();
}

/**
 * 把对象上的若干字段从 Date 替换成 ISO 字符串，返回一个新对象。
 *
 * 设计目标：
 * - 用于 handler 在把仓储/Drizzle 行对象（含 Date）转换成 JSON 响应的场景；
 * - 仅对显式声明的字段进行处理，不对未声明字段做任何改动；
 * - 顶层处理；如果字段值是 Date 对象则替换为 ISO，
 *   如果是 null/undefined 则保持原值（不强制转换为 null）。
 */
export function serializeRecord<T extends Record<string, unknown>>(
  input: T,
  dateFields: ReadonlyArray<keyof T>
): T {
  const out: Record<string, unknown> = { ...input };
  for (const field of dateFields) {
    const value = out[field as string];
    if (value instanceof Date) {
      out[field as string] = dateToIso(value);
    }
  }
  return out as T;
}

/**
 * 检查给定 Zod schema 是否（在任意层级上）使用了 `z.date()`。
 *
 * 用于回归测试：所有 v1 API 的 JSON 输入/输出 schema 都不允许 `z.date()`。
 *
 * 实现注意：
 * - 我们检查 `_def.typeName` 或 zod 4 的 `_def.type === "date"`；
 * - 递归遍历常见的复合形态（object.shape / array.element / union.options /
 *   intersection.left|right / optional.innerType / nullable.innerType /
 *   tuple.items / record.valueType）。如果遇到未识别形态则跳过——这意味着
 *   该工具是「best-effort」的，但已足以阻止意外回归。
 */
export function assertNoZodDateInSchema(schema: unknown, path: ReadonlyArray<string> = []): void {
  if (schema === null || typeof schema !== "object") return;
  const def = (schema as { _def?: Record<string, unknown> })._def;
  if (!def || typeof def !== "object") return;

  const typeName = (def as { typeName?: string }).typeName;
  const typeTag = (def as { type?: string }).type;
  if (typeName === "ZodDate" || typeTag === "date") {
    throw new Error(
      `assertNoZodDateInSchema: encountered z.date() at path=${path.join(".") || "<root>"}`
    );
  }

  // 遍历对象 shape
  const shape = (def as { shape?: () => Record<string, unknown> | Record<string, unknown> }).shape;
  if (shape) {
    const resolved = typeof shape === "function" ? shape() : shape;
    for (const [k, v] of Object.entries(resolved as Record<string, unknown>)) {
      assertNoZodDateInSchema(v, [...path, k]);
    }
  }

  // 遍历数组 / set element
  const element = (def as { element?: unknown }).element;
  if (element) assertNoZodDateInSchema(element, [...path, "[]"]);
  const valueType = (def as { valueType?: unknown }).valueType;
  if (valueType) assertNoZodDateInSchema(valueType, [...path, "value"]);
  const keyType = (def as { keyType?: unknown }).keyType;
  if (keyType) assertNoZodDateInSchema(keyType, [...path, "key"]);
  const innerType = (def as { innerType?: unknown }).innerType;
  if (innerType) assertNoZodDateInSchema(innerType, path);

  const options = (def as { options?: unknown }).options;
  if (Array.isArray(options)) {
    for (const opt of options) assertNoZodDateInSchema(opt, path);
  }

  const items = (def as { items?: unknown }).items;
  if (Array.isArray(items)) {
    for (const item of items) assertNoZodDateInSchema(item, path);
  }

  const left = (def as { left?: unknown }).left;
  const right = (def as { right?: unknown }).right;
  if (left) assertNoZodDateInSchema(left, path);
  if (right) assertNoZodDateInSchema(right, path);
}
