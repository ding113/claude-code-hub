import { describe, expect, test } from "vitest";

import { SseFixer } from "./sse-fixer";

function fix(input: string): string {
  const fixer = new SseFixer();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return decoder.decode(fixer.fix(encoder.encode(input)).data);
}

describe("SseFixer", () => {
  test("有效 SSE 应原样通过", () => {
    expect(fix('data: {"test": true}\n')).toBe('data: {"test": true}\n');
  });

  test("有效 SSE 不应产生额外字节拷贝（applied=false 时复用输入）", () => {
    const fixer = new SseFixer();
    const encoder = new TextEncoder();
    const input = encoder.encode('data: {"test": true}\n');

    const res = fixer.fix(input);
    expect(res.applied).toBe(false);
    expect(res.data).toBe(input);
  });

  test("data: 后缺失空格应补齐", () => {
    expect(fix('data:{"test": true}\n')).toBe('data: {"test": true}\n');
  });

  test("超长 data 行应可处理（避免参数过多导致异常）", () => {
    const payload = "a".repeat(100_000);
    const input = `data:${payload}\n`;
    const output = fix(input);
    expect(output).toBe(`data: ${payload}\n`);
  });

  test("缺失 data: 前缀的 JSON 行应被包装", () => {
    expect(fix('{"content": "hello"}\n')).toBe('data: {"content": "hello"}\n');
  });

  test("数组 JSON 行也应被包装", () => {
    expect(fix('[{"delta": {}}]\n')).toBe('data: [{"delta": {}}]\n');
  });

  test("[DONE] 终止标记应被包装", () => {
    expect(fix("[DONE]\n")).toBe("data: [DONE]\n");
  });

  test("注释行应保留", () => {
    expect(fix(": this is a comment\ndata: test\n")).toBe(": this is a comment\ndata: test\n");
  });

  test("event/id/retry 字段应修复空格", () => {
    expect(fix("event:message\ndata: test\n")).toBe("event: message\ndata: test\n");
    expect(fix("id:123\ndata: test\n")).toBe("id: 123\ndata: test\n");
    expect(fix("retry:1000\ndata: test\n")).toBe("retry: 1000\ndata: test\n");
  });

  test("应统一 CRLF/CR 为 LF", () => {
    expect(fix("data: test\r\ndata: test2\r\n")).toBe("data: test\ndata: test2\n");
    expect(fix("data: test\rdata: test2\r")).toBe("data: test\ndata: test2\n");
  });

  test("data: 大小写错误应修复为小写", () => {
    expect(fix('Data:{"test": true}\n')).toBe('data: {"test": true}\n');
    expect(fix('DATA:{"test": true}\n')).toBe('data: {"test": true}\n');
  });

  test("data : 变体应修复（移除冒号前空格）", () => {
    expect(fix('data :{"test": true}\n')).toBe('data: {"test": true}\n');
  });

  test("连续空行应合并", () => {
    expect(fix("data: test\n\n\n\ndata: test2\n")).toBe("data: test\n\ndata: test2\n");
  });

  test("多行 data: 应保持", () => {
    expect(fix("data: line1\ndata: line2\n\n")).toBe("data: line1\ndata: line2\n\n");
  });
});
