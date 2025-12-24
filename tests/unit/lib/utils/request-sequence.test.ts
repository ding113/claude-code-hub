import { describe, expect, test } from "vitest";
import { normalizeRequestSequence } from "@/lib/utils/request-sequence";

describe("normalizeRequestSequence", () => {
  test("正常情况：正整数应原样返回", () => {
    expect(normalizeRequestSequence(1)).toBe(1);
    expect(normalizeRequestSequence(100)).toBe(100);
    expect(normalizeRequestSequence(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("边界情况：无效数字应返回 null", () => {
    expect(normalizeRequestSequence(undefined)).toBe(null);
    expect(normalizeRequestSequence(0)).toBe(null);
    expect(normalizeRequestSequence(-1)).toBe(null);
    expect(normalizeRequestSequence(1.1)).toBe(null);
    expect(normalizeRequestSequence(Number.NaN)).toBe(null);
    expect(normalizeRequestSequence(Number.POSITIVE_INFINITY)).toBe(null);
    expect(normalizeRequestSequence(Number.NEGATIVE_INFINITY)).toBe(null);
    expect(normalizeRequestSequence(Number.MAX_SAFE_INTEGER + 1)).toBe(null);
  });

  test("类型错误：非数字类型应返回 null", () => {
    expect(normalizeRequestSequence("1" as unknown as number)).toBe(null);
    expect(normalizeRequestSequence(null as unknown as number)).toBe(null);
    expect(normalizeRequestSequence({} as unknown as number)).toBe(null);
    expect(normalizeRequestSequence([] as unknown as number)).toBe(null);
  });
});
