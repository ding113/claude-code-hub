import { describe, expect, test } from "vitest";
import {
  getDefaultPreset,
  getExecutionPresetCandidates,
  getPresetsForProvider,
} from "./presets";

function assertMinimalProbePayload(payload: Record<string, unknown>) {
  const raw = JSON.stringify(payload);
  expect(payload.stream).toBe(true);
  expect(raw).not.toContain("cache_control");
  expect(raw).not.toContain("system-reminder");
  expect(raw).not.toContain("You are Claude Code");
  expect(raw).not.toContain("You are Codex");
  expect(raw).not.toContain("echo bot");
  expect(raw).not.toContain("apply_patch");
  // Claude / OpenAI-compatible lean bodies should not carry thinking blocks.
  if (!("input" in payload)) {
    expect(raw).not.toContain("thinking");
  }
}

describe("provider-testing presets", () => {
  test("三类健康测都只保留单一最小流式模板", () => {
    expect(getPresetsForProvider("claude").map((p) => p.id)).toEqual(["cc_haiku_basic"]);
    expect(getPresetsForProvider("claude-auth").map((p) => p.id)).toEqual(["cc_haiku_basic"]);
    expect(getPresetsForProvider("codex").map((p) => p.id)).toEqual(["cx_codex_basic"]);
    expect(getPresetsForProvider("openai-compatible").map((p) => p.id)).toEqual(["oa_chat_stream"]);
  });

  test("claude 最小模板无 beta/thinking/cache", () => {
    const preset = getDefaultPreset("claude");
    const payload = preset?.payload as Record<string, unknown>;
    expect(preset?.id).toBe("cc_haiku_basic");
    expect(preset?.extraHeaders).toBeUndefined();
    expect(payload.max_tokens).toBe(8);
    expect(JSON.stringify(payload.messages)).toContain("hi");
    assertMinimalProbePayload(payload);
  });

  test("codex 最小模板保留短 instructions，并显式关闭 tools/reasoning", () => {
    const preset = getDefaultPreset("codex");
    const payload = preset?.payload as Record<string, unknown>;
    expect(preset?.id).toBe("cx_codex_basic");
    expect(payload.max_output_tokens).toBe(16);
    expect(payload.instructions).toBe("Reply with exactly pong.");
    expect(JSON.stringify(payload.input)).toContain("hi");
    expect(payload.tools).toEqual([]);
    expect(payload.tool_choice).toBe("none");
    expect((payload.reasoning as { effort?: string } | undefined)?.effort).toBe("none");
    const raw = JSON.stringify(payload);
    expect(raw).not.toContain("You are Codex");
    expect(raw).not.toContain("apply_patch");
    expect(payload.stream).toBe(true);
  });

  test("openai-compatible 最小模板只有 user hi", () => {
    const preset = getDefaultPreset("openai-compatible");
    const payload = preset?.payload as Record<string, unknown>;
    expect(preset?.id).toBe("oa_chat_stream");
    expect(payload.max_tokens).toBe(8);
    expect(JSON.stringify(payload.messages)).toContain("hi");
    assertMinimalProbePayload(payload);
  });

  test("执行候选集对三类都只返回一个最小模板", () => {
    expect(
      getExecutionPresetCandidates({ providerType: "claude", model: "claude-opus-4-6" }).map(
        (p) => p.id
      )
    ).toEqual(["cc_haiku_basic"]);
    expect(
      getExecutionPresetCandidates({ providerType: "codex", model: "gpt-5.6-terra" }).map(
        (p) => p.id
      )
    ).toEqual(["cx_codex_basic"]);
    expect(
      getExecutionPresetCandidates({
        providerType: "openai-compatible",
        model: "grok-4.5",
      }).map((p) => p.id)
    ).toEqual(["oa_chat_stream"]);
  });
});
