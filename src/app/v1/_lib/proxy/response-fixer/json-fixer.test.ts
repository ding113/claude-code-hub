import { describe, expect, test } from "vitest";

import { JsonFixer } from "./json-fixer";

function decodeUtf8(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

describe("JsonFixer", () => {
  test("有效 JSON 应原样通过（不标记 applied）", () => {
    const input = new TextEncoder().encode('{"a":1}');
    const fixer = new JsonFixer({ maxDepth: 200, maxSize: 1024 * 1024 });

    const res = fixer.fix(input);

    expect(res.applied).toBe(false);
    expect(Array.from(res.data)).toEqual(Array.from(input));
  });

  test("未闭合对象应被补齐括号", () => {
    const input = new TextEncoder().encode('{"key":"value"');
    const fixer = new JsonFixer({ maxDepth: 200, maxSize: 1024 * 1024 });

    const res = fixer.fix(input);
    expect(() => JSON.parse(decodeUtf8(res.data))).not.toThrow();
  });

  test("未闭合数组应被补齐括号", () => {
    const input = new TextEncoder().encode("[1, 2, 3");
    const fixer = new JsonFixer({ maxDepth: 200, maxSize: 1024 * 1024 });

    const res = fixer.fix(input);
    expect(() => JSON.parse(decodeUtf8(res.data))).not.toThrow();
  });

  test("未闭合字符串应被补齐引号", () => {
    const input = new TextEncoder().encode('{"key":"val');
    const fixer = new JsonFixer({ maxDepth: 200, maxSize: 1024 * 1024 });

    const res = fixer.fix(input);
    expect(() => JSON.parse(decodeUtf8(res.data))).not.toThrow();
  });

  test("对象/数组尾随逗号应被移除", () => {
    const fixer = new JsonFixer({ maxDepth: 200, maxSize: 1024 * 1024 });
    const inputs = ['{"a": 1,}', "[1, 2,]"];

    for (const text of inputs) {
      const res = fixer.fix(new TextEncoder().encode(text));
      expect(() => JSON.parse(decodeUtf8(res.data))).not.toThrow();
    }
  });

  test("冒号后缺失值应补 null", () => {
    const input = new TextEncoder().encode('{"key":');
    const fixer = new JsonFixer({ maxDepth: 200, maxSize: 1024 * 1024 });

    const res = fixer.fix(input);
    expect(JSON.parse(decodeUtf8(res.data))).toEqual({ key: null });
  });

  test("嵌套未闭合结构应被补齐", () => {
    const input = new TextEncoder().encode('{"outer": {"inner": [1, 2');
    const fixer = new JsonFixer({ maxDepth: 200, maxSize: 1024 * 1024 });

    const res = fixer.fix(input);
    expect(() => JSON.parse(decodeUtf8(res.data))).not.toThrow();
  });

  test("超过最大深度应保持原样（保护性降级）", () => {
    const input = new TextEncoder().encode('{"a":{"b":{"c":{"d":');
    const fixer = new JsonFixer({ maxDepth: 3, maxSize: 1024 * 1024 });

    const res = fixer.fix(input);
    expect(res.applied).toBe(false);
    expect(decodeUtf8(res.data)).toBe(decodeUtf8(input));
  });

  test("超过最大大小应保持原样（保护性降级）", () => {
    const input = new TextEncoder().encode('{"key":"very long value"}');
    const fixer = new JsonFixer({ maxDepth: 200, maxSize: 10 });

    const res = fixer.fix(input);
    expect(res.applied).toBe(false);
    expect(decodeUtf8(res.data)).toBe(decodeUtf8(input));
  });
});
