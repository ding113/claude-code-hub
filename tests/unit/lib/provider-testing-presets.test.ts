import { describe, expect, test } from "vitest";
import { getPresetPayload, getPresetsForProvider } from "@/lib/provider-testing/presets";

describe("provider testing presets", () => {
  test("openai 类型应返回 chat 预置而不是 codex 预置", () => {
    const presets = getPresetsForProvider("openai");

    expect(presets.map((preset) => preset.id)).toEqual(["openai_chat"]);
    expect(presets[0]?.defaultModel).toBe("gpt-4o");
  });

  test("openai chat 预置应生成 chat completions 请求体", () => {
    const payload = getPresetPayload("openai_chat");

    expect(Array.isArray(payload.messages)).toBe(true);
    expect(payload).not.toHaveProperty("input");
    expect(payload).not.toHaveProperty("instructions");
  });
});
