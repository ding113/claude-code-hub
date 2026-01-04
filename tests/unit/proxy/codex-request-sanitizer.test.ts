import { describe, expect, it } from "vitest";
import { sanitizeCodexRequest } from "@/app/v1/_lib/codex/utils/request-sanitizer";

describe("Codex 请求清洗 - instructions 透传", () => {
  it("应忽略 force_official，始终透传 instructions", async () => {
    const originalInstructions = "用户自定义 instructions（必须原样透传）";
    const input: Record<string, unknown> = {
      instructions: originalInstructions,
      max_tokens: 123,
      temperature: 0.7,
    };

    const output = await sanitizeCodexRequest(input, "gpt-5-codex", "force_official", 1, {
      isOfficialClient: false,
    });

    expect(output.instructions).toBe(originalInstructions);
    expect(output).not.toHaveProperty("_canRetryWithOfficialInstructions");
    expect(output).not.toHaveProperty("max_tokens");
    expect(output).not.toHaveProperty("temperature");
    expect(output.store).toBe(false);
    expect(output.parallel_tool_calls).toBe(true);
  });

  it("当客户端显式设置 parallel_tool_calls=false 时应保留（默认不强制覆写）", async () => {
    const input: Record<string, unknown> = {
      instructions: "abc",
      parallel_tool_calls: false,
    };

    const output = await sanitizeCodexRequest(input, "gpt-5-codex", "auto", 1, {
      isOfficialClient: false,
    });

    expect(output.parallel_tool_calls).toBe(false);
    expect(input.parallel_tool_calls).toBe(false);
  });

  it("auto 策略也不应写入私有重试标记", async () => {
    const originalInstructions = "abc";
    const input: Record<string, unknown> = { instructions: originalInstructions };

    const output = await sanitizeCodexRequest(input, "gpt-5-codex", "auto", 1, {
      isOfficialClient: false,
    });

    expect(output.instructions).toBe(originalInstructions);
    expect(output).not.toHaveProperty("_canRetryWithOfficialInstructions");
  });
});
