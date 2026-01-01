import { describe, expect, test } from "vitest";
import {
  DEFAULT_SCENARIO,
  resolveScenario,
} from "../../../load-tests/mock-provider/config/scenarios";
import {
  createUsage,
  estimateInputTokens,
  generateOutputText,
} from "../../../load-tests/mock-provider/generators/response";
import {
  formatSSE,
  streamTextChunks,
} from "../../../load-tests/mock-provider/generators/streaming";

describe("mock-provider generators", () => {
  test("formatSSE 带 event 前缀", () => {
    const s = formatSSE("message_start", { ok: true });
    expect(s.startsWith("event: message_start\n")).toBe(true);
    expect(s.includes("data:")).toBe(true);
    expect(s.endsWith("\n\n")).toBe(true);
  });

  test("formatSSE data-only（用于 OpenAI）", () => {
    const s = formatSSE(undefined, { ok: true });
    expect(s.startsWith("data: ")).toBe(true);
    expect(s.includes("event:")).toBe(false);
  });

  test("formatSSE 支持 raw string（用于 [DONE]）", () => {
    const s = formatSSE(undefined, "[DONE]");
    expect(s).toBe("data: [DONE]\n\n");
  });

  test("streamTextChunks 可以完整拼回原文", async () => {
    const text = "hello world";
    const chunks: string[] = [];
    for await (const chunk of streamTextChunks(text, { chunkDelayMs: 0, chunkCount: 4 })) {
      chunks.push(chunk);
    }
    expect(chunks.join("")).toBe(text);
  });

  test("estimateInputTokens 至少为 1，且随文本增长", () => {
    expect(estimateInputTokens("a")).toBeGreaterThanOrEqual(1);
    expect(estimateInputTokens("a".repeat(100))).toBeGreaterThan(estimateInputTokens("a"));
  });

  test("generateOutputText 输出稳定且非空", () => {
    expect(generateOutputText(1).length).toBeGreaterThan(0);
    expect(generateOutputText(10).length).toBeGreaterThan(generateOutputText(1).length);
  });

  test("createUsage 计算 total_tokens 并兼容 OpenAI 字段", () => {
    const usage = createUsage(12, 34);
    expect(usage.total_tokens).toBe(46);
    expect(usage.prompt_tokens).toBe(12);
    expect(usage.completion_tokens).toBe(34);
  });

  test("resolveScenario 未知名称回落到默认场景", () => {
    expect(resolveScenario("unknown").name).toBe(DEFAULT_SCENARIO.name);
    expect(resolveScenario(null).name).toBe(DEFAULT_SCENARIO.name);
  });
});
