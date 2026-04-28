/**
 * /api/v1 序列化辅助：单元测试
 *
 * 验证：
 * - IsoDateTimeSchema 接受带时区偏移的字符串，拒绝非法格式；
 * - dateToIso 处理 null / undefined / Date / Invalid Date；
 * - serializeRecord 将 Date 字段替换为 ISO 字符串，不动其他字段；
 * - assertNoZodDateInSchema 在 schema 中存在 z.date() 时抛错，
 *   在仅有 IsoDateTimeSchema 的 schema 中通过。
 */

import { describe, expect, it } from "vitest";
import { z } from "@hono/zod-openapi";

import {
  assertNoZodDateInSchema,
  dateToIso,
  IsoDateTimeSchema,
  serializeRecord,
} from "@/lib/api/v1/_shared/serialization";

describe("IsoDateTimeSchema", () => {
  it("accepts ISO 8601 strings with timezone offset", () => {
    expect(IsoDateTimeSchema.parse("2025-04-28T13:45:00.000Z")).toBe("2025-04-28T13:45:00.000Z");
    expect(IsoDateTimeSchema.parse("2025-04-28T13:45:00+08:00")).toBe("2025-04-28T13:45:00+08:00");
  });

  it("rejects non-ISO strings and non-strings", () => {
    expect(() => IsoDateTimeSchema.parse("not-a-date")).toThrow();
    expect(() => IsoDateTimeSchema.parse("2025-04-28")).toThrow();
    expect(() => IsoDateTimeSchema.parse(123)).toThrow();
  });
});

describe("dateToIso", () => {
  it("returns null for null/undefined", () => {
    expect(dateToIso(null)).toBeNull();
    expect(dateToIso(undefined)).toBeNull();
  });

  it("returns ISO string for valid Date", () => {
    const d = new Date("2025-04-28T13:45:00.000Z");
    expect(dateToIso(d)).toBe("2025-04-28T13:45:00.000Z");
  });

  it("throws for invalid Date", () => {
    expect(() => dateToIso(new Date("not-a-date"))).toThrow();
  });

  it("throws for non-Date inputs", () => {
    expect(() => dateToIso("2025-04-28T13:45:00.000Z" as unknown as Date)).toThrow();
  });
});

describe("serializeRecord", () => {
  it("replaces only declared Date fields, leaves others untouched", () => {
    const input = {
      id: 1,
      name: "alice",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: null,
      meta: { nested: new Date("2025-02-01T00:00:00.000Z") }, // not declared, should not change
    };
    const out = serializeRecord(input, ["createdAt", "updatedAt"]);
    expect(out.id).toBe(1);
    expect(out.name).toBe("alice");
    expect(out.createdAt).toBe("2025-01-01T00:00:00.000Z");
    expect(out.updatedAt).toBeNull();
    // 嵌套 Date 不在声明字段内，应保持原样
    expect(out.meta.nested).toBeInstanceOf(Date);
  });

  it("does not mutate original input", () => {
    const original = { createdAt: new Date("2025-01-01T00:00:00.000Z") };
    const out = serializeRecord(original, ["createdAt"]);
    expect(original.createdAt).toBeInstanceOf(Date);
    expect(out.createdAt).toBe("2025-01-01T00:00:00.000Z");
  });
});

describe("assertNoZodDateInSchema", () => {
  it("throws when z.date() is present at top level", () => {
    expect(() => assertNoZodDateInSchema(z.date())).toThrow(/z\.date\(\)/);
  });

  it("throws when z.date() is nested inside an object", () => {
    const bad = z.object({
      id: z.number(),
      createdAt: z.date(),
    });
    expect(() => assertNoZodDateInSchema(bad)).toThrow(/createdAt/);
  });

  it("throws when z.date() is nested inside an array", () => {
    const bad = z.array(z.date());
    expect(() => assertNoZodDateInSchema(bad)).toThrow(/z\.date\(\)/);
  });

  it("throws when z.date() is wrapped in optional/nullable", () => {
    const bad = z.object({ at: z.date().optional() });
    expect(() => assertNoZodDateInSchema(bad)).toThrow(/at/);
  });

  it("passes for schemas using IsoDateTimeSchema only", () => {
    const ok = z.object({
      id: z.number(),
      createdAt: IsoDateTimeSchema,
      tags: z.array(z.string()),
    });
    expect(() => assertNoZodDateInSchema(ok)).not.toThrow();
  });
});
