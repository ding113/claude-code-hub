import { describe, expect, test } from "vitest";
import {
  CLIENT_RESTRICTION_PRESET_OPTIONS,
  getSelectedChildren,
  isAllChildrenSelected,
  isPresetClientValue,
  isPresetSelected,
  mergePresetAndCustomClients,
  removePresetValues,
  setChildSelection,
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

  describe("child selection helpers", () => {
    const claudeCodePreset = CLIENT_RESTRICTION_PRESET_OPTIONS[0];
    const geminiPreset = CLIENT_RESTRICTION_PRESET_OPTIONS[1];
    const allChildValues = claudeCodePreset.children!.map((c) => c.value);

    test("getSelectedChildren returns all children when parent value is present", () => {
      expect(getSelectedChildren(["claude-code", "gemini-cli"], claudeCodePreset)).toEqual(
        allChildValues
      );
    });

    test("getSelectedChildren returns specific children when individual values present", () => {
      expect(
        getSelectedChildren(["claude-code-cli", "claude-code-vscode"], claudeCodePreset)
      ).toEqual(["claude-code-cli", "claude-code-vscode"]);
    });

    test("getSelectedChildren returns empty array for preset without children", () => {
      expect(getSelectedChildren(["gemini-cli"], geminiPreset)).toEqual([]);
    });

    test("isAllChildrenSelected returns true when parent value is present", () => {
      expect(isAllChildrenSelected(["claude-code"], claudeCodePreset)).toBe(true);
    });

    test("isAllChildrenSelected returns true when all 6 children individually present", () => {
      expect(isAllChildrenSelected(allChildValues, claudeCodePreset)).toBe(true);
    });

    test("isAllChildrenSelected returns false for partial selection", () => {
      expect(
        isAllChildrenSelected(["claude-code-cli", "claude-code-vscode"], claudeCodePreset)
      ).toBe(false);
    });

    test("setChildSelection auto-consolidates when all 6 children selected", () => {
      expect(setChildSelection(["gemini-cli"], claudeCodePreset, allChildValues)).toEqual([
        "gemini-cli",
        "claude-code",
      ]);
    });

    test("setChildSelection stores individual values for partial selection", () => {
      expect(
        setChildSelection(["gemini-cli"], claudeCodePreset, [
          "claude-code-cli",
          "claude-code-vscode",
        ])
      ).toEqual(["gemini-cli", "claude-code-cli", "claude-code-vscode"]);
    });

    test("setChildSelection removes all preset values when selection is empty", () => {
      expect(setChildSelection(["claude-code", "gemini-cli"], claudeCodePreset, [])).toEqual([
        "gemini-cli",
      ]);
    });

    test("setChildSelection replaces existing child values with new selection", () => {
      expect(
        setChildSelection(["claude-code-cli", "gemini-cli"], claudeCodePreset, [
          "claude-code-vscode",
        ])
      ).toEqual(["gemini-cli", "claude-code-vscode"]);
    });
  });
});
