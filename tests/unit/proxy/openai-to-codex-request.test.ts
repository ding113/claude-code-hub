import { describe, expect, it } from "vitest";
import { transformOpenAIRequestToCodex } from "@/app/v1/_lib/converters/openai-to-codex/request";

describe("OpenAI → Codex 转换 - instructions 透传", () => {
  it("当输入包含 instructions 时应直接透传", () => {
    const originalInstructions = "透传：不要被转换器覆盖";
    const input: Record<string, unknown> = {
      instructions: originalInstructions,
      messages: [{ role: "user", content: "你好" }],
    };

    const output = transformOpenAIRequestToCodex("gpt-5-codex", input, true) as any;
    expect(output.instructions).toBe(originalInstructions);
  });

  it("当输入无 instructions 但有 system messages 时，应把 system 文本映射到 instructions", () => {
    const input: Record<string, unknown> = {
      messages: [
        { role: "system", content: "系统指令 1" },
        { role: "system", content: "系统指令 2" },
        { role: "user", content: "用户消息" },
      ],
    };

    const output = transformOpenAIRequestToCodex("gpt-5-codex", input, true) as any;

    expect(output.instructions).toBe("系统指令 1\n\n系统指令 2");
    expect(output.input?.[0]?.role).toBe("user");
    expect(output.input?.[0]?.content?.[0]?.text).toBe("用户消息");
  });

  it("当输入既无 instructions 也无 system messages 时，不应注入默认 instructions", () => {
    const input: Record<string, unknown> = {
      messages: [{ role: "user", content: "用户消息" }],
    };

    const output = transformOpenAIRequestToCodex("gpt-5-codex", input, true) as any;
    expect(output.instructions).toBeUndefined();
  });

  it("当输入显式设置 parallel_tool_calls=false 时，应透传到 Codex 请求", () => {
    const input: Record<string, unknown> = {
      messages: [{ role: "user", content: "你好" }],
      parallel_tool_calls: false,
    };

    const output = transformOpenAIRequestToCodex("gpt-5-codex", input, true) as any;
    expect(output.parallel_tool_calls).toBe(false);
  });
});
