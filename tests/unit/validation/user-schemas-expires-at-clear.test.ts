import { describe, expect, test } from "vitest";
import { CreateUserSchema, UpdateUserSchema } from "@/lib/validation/schemas";

describe("UpdateUserSchema: expiresAt 清除语义", () => {
  test("expiresAt=null 应解析为 null（显式清除）", () => {
    const parsed = UpdateUserSchema.parse({ expiresAt: null });
    expect(parsed.expiresAt).toBeNull();
  });

  test("expiresAt='' 应解析为 null（显式清除）", () => {
    const parsed = UpdateUserSchema.parse({ expiresAt: "" });
    expect(parsed.expiresAt).toBeNull();
  });

  test("expiresAt 缺省应保持 undefined（不更新字段）", () => {
    const parsed = UpdateUserSchema.parse({});
    expect(parsed.expiresAt).toBeUndefined();
  });

  test("expiresAt=ISO 字符串应解析为 Date", () => {
    const parsed = UpdateUserSchema.parse({ expiresAt: "2026-01-04T23:59:59.999Z" });
    expect(parsed.expiresAt).toBeInstanceOf(Date);
  });

  test("expiresAt=非法字符串应校验失败", () => {
    const result = UpdateUserSchema.safeParse({ expiresAt: "not-a-date" });
    expect(result.success).toBe(false);
  });

  test("expiresAt=非法 Date 应校验失败", () => {
    const bad = new Date("not-a-date");
    const result = UpdateUserSchema.safeParse({ expiresAt: bad });
    expect(result.success).toBe(false);
  });

  test("expiresAt=非字符串/非 Date 类型应校验失败", () => {
    const result = UpdateUserSchema.safeParse({ expiresAt: 123 });
    expect(result.success).toBe(false);
  });

  test("expiresAt 超过 10 年应被拒绝", () => {
    const tooFar = new Date();
    tooFar.setFullYear(tooFar.getFullYear() + 11);

    const result = UpdateUserSchema.safeParse({ expiresAt: tooFar });
    expect(result.success).toBe(false);
  });
});

describe("CreateUserSchema: expiresAt 兼容性", () => {
  test("CreateUserSchema 仍将 expiresAt=null 视为未设置", () => {
    const parsed = CreateUserSchema.parse({ name: "test-user", expiresAt: null });
    expect(parsed.expiresAt).toBeUndefined();
  });

  test("CreateUserSchema 支持 expiresAt=Date（未来时间）", () => {
    const future = new Date();
    future.setDate(future.getDate() + 1);
    const parsed = CreateUserSchema.parse({ name: "test-user", expiresAt: future });
    expect(parsed.expiresAt).toBeInstanceOf(Date);
  });

  test("CreateUserSchema 支持 expiresAt=ISO 字符串（未来时间）", () => {
    const future = new Date();
    future.setDate(future.getDate() + 1);
    const parsed = CreateUserSchema.parse({ name: "test-user", expiresAt: future.toISOString() });
    expect(parsed.expiresAt).toBeInstanceOf(Date);
  });

  test("CreateUserSchema: expiresAt=过去时间应被拒绝", () => {
    const past = new Date();
    past.setDate(past.getDate() - 1);
    const result = CreateUserSchema.safeParse({ name: "test-user", expiresAt: past });
    expect(result.success).toBe(false);
  });

  test("CreateUserSchema: expiresAt 超过 10 年应被拒绝", () => {
    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 11);
    const result = CreateUserSchema.safeParse({ name: "test-user", expiresAt: farFuture });
    expect(result.success).toBe(false);
  });

  test("CreateUserSchema: expiresAt=非法 Date 应校验失败", () => {
    const bad = new Date("not-a-date");
    const result = CreateUserSchema.safeParse({ name: "test-user", expiresAt: bad });
    expect(result.success).toBe(false);
  });

  test("CreateUserSchema: expiresAt=非法字符串应校验失败", () => {
    const result = CreateUserSchema.safeParse({ name: "test-user", expiresAt: "not-a-date" });
    expect(result.success).toBe(false);
  });
});
