import { describe, expect, test } from "vitest";
import { getDefaultPreset, getPresetsForProvider } from "./presets";

describe("provider-testing presets", () => {
  test("openai-compatible 应该使用独立的 OpenAI Compatible 模板，而不是复用 codex 模板", () => {
    const ids = getPresetsForProvider("openai-compatible").map((preset) => preset.id);

    expect(ids).toContain("oa_chat_basic");
    expect(ids).toContain("oa_chat_stream");
    expect(ids).not.toContain("cx_base");
    expect(getDefaultPreset("openai-compatible")?.id).toBe("oa_chat_basic");
  });

  test("codex、openai-compatible、gemini 三套模板都应该各自独立且至少有两个可选模板", () => {
    const codexIds = getPresetsForProvider("codex").map((preset) => preset.id);
    const openaiCompatibleIds = getPresetsForProvider("openai-compatible").map(
      (preset) => preset.id
    );
    const geminiIds = getPresetsForProvider("gemini").map((preset) => preset.id);

    expect(codexIds).toEqual(expect.arrayContaining(["cx_codex_basic", "cx_gpt_basic"]));
    expect(openaiCompatibleIds).toEqual(
      expect.arrayContaining(["oa_chat_basic", "oa_chat_stream"])
    );
    expect(geminiIds).toEqual(expect.arrayContaining(["gm_flash_basic", "gm_pro_basic"]));

    expect(codexIds.some((id) => openaiCompatibleIds.includes(id))).toBe(false);
    expect(geminiIds.some((id) => codexIds.includes(id) || openaiCompatibleIds.includes(id))).toBe(
      false
    );
  });

  test("claude 应该提供多个 relay 风格模板，并默认选择最稳妥的基础模板", () => {
    const ids = getPresetsForProvider("claude").map((preset) => preset.id);

    expect(ids).toEqual(
      expect.arrayContaining(["cc_haiku_basic", "cc_beta_cli", "cc_public_thinking"])
    );
    expect(getDefaultPreset("claude")?.id).toBe("cc_haiku_basic");
  });
});
