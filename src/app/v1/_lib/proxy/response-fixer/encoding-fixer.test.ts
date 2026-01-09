import { describe, expect, test } from "vitest";

import { EncodingFixer } from "./encoding-fixer";

describe("EncodingFixer", () => {
  test("有效 UTF-8 应原样通过（不标记 applied）", () => {
    const encoder = new TextEncoder();
    const input = encoder.encode("Hello 世界");

    const fixer = new EncodingFixer();
    const { data, applied } = fixer.fix(input);

    expect(applied).toBe(false);
    expect(Array.from(data)).toEqual(Array.from(input));
  });

  test("应移除 UTF-8 BOM", () => {
    const encoder = new TextEncoder();
    const input = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode("Hello")]);

    const fixer = new EncodingFixer();
    const { data, applied } = fixer.fix(input);

    expect(applied).toBe(true);
    expect(new TextDecoder().decode(data)).toBe("Hello");
  });

  test("应移除 UTF-16 BOM", () => {
    // UTF-16LE BOM + "A"（0x41 0x00）
    const input = new Uint8Array([0xff, 0xfe, 0x41, 0x00]);

    const fixer = new EncodingFixer();
    const { data, applied } = fixer.fix(input);

    expect(applied).toBe(true);
    expect(new TextDecoder().decode(data)).toBe("A");
  });

  test("应移除空字节", () => {
    const input = new Uint8Array([0x48, 0x65, 0x00, 0x6c, 0x6c, 0x6f]); // He\0llo

    const fixer = new EncodingFixer();
    const { data, applied } = fixer.fix(input);

    expect(applied).toBe(true);
    expect(new TextDecoder().decode(data)).toBe("Hello");
  });

  test("无效 UTF-8 应被有损修复为可解码 UTF-8", () => {
    // 0xC3 0x28 是无效 UTF-8 序列
    const input = new Uint8Array([0xc3, 0x28, 0x61]);

    const fixer = new EncodingFixer();
    const { data, applied } = fixer.fix(input);

    expect(applied).toBe(true);
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(data)).not.toThrow();
  });
});
