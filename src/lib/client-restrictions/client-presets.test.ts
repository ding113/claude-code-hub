import { describe, expect, test } from "vitest";
import {
  isPresetClientValue,
  isPresetSelected,
  mergePresetAndCustomClients,
  removePresetValues,
  splitPresetAndCustomClients,
  togglePresetSelection,
} from "./client-presets";

describe("client restriction presets", () => {
  test("treats Claude Code sub-client values as preset-compatible aliases", () => {
    expect(isPresetClientValue("claude-code")).toBe(true);
    expect(isPresetClientValue("claude-code-cli")).toBe(true);
    expect(isPresetSelected(["claude-code-cli-sdk"], "claude-code")).toBe(true);
  });

  test("splitPresetAndCustomClients keeps legacy aliases in presetValues", () => {
    const result = splitPresetAndCustomClients(["claude-code-vscode", "my-ide"]);
    expect(result).toEqual({
      presetValues: ["claude-code-vscode"],
      customValues: ["my-ide"],
    });
  });

  test("togglePresetSelection adds canonical value for newly enabled preset", () => {
    expect(togglePresetSelection(["gemini-cli"], "claude-code", true)).toEqual([
      "gemini-cli",
      "claude-code",
    ]);
  });

  test("togglePresetSelection removes canonical value and aliases when disabled", () => {
    expect(
      togglePresetSelection(["claude-code", "claude-code-cli", "my-ide"], "claude-code", false)
    ).toEqual(["my-ide"]);
  });

  test("removePresetValues clears the whole preset group", () => {
    expect(removePresetValues(["claude-code-gh-action", "codex-cli"], "claude-code")).toEqual([
      "codex-cli",
    ]);
  });

  test("mergePresetAndCustomClients preserves legacy preset values without forcing migration", () => {
    expect(
      mergePresetAndCustomClients(["claude-code-sdk-ts", "codex-cli"], ["my-ide", "codex-cli"])
    ).toEqual(["claude-code-sdk-ts", "codex-cli", "my-ide"]);
  });
});
