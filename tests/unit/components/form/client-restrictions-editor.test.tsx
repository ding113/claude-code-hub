/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/client-restrictions/client-presets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client-restrictions/client-presets")>();
  return {
    ...actual,
    CLIENT_RESTRICTION_PRESET_OPTIONS: [],
  };
});

vi.mock("@/components/ui/tag-input", () => ({
  TagInput: vi.fn(() => null),
}));

// eslint-disable-next-line import/order -- must come after vi.mock
import { TagInput } from "@/components/ui/tag-input";
// eslint-disable-next-line import/order -- must come after vi.mock
import { ClientRestrictionsEditor } from "@/components/form/client-restrictions-editor";

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return () => {
    act(() => root.unmount());
    container.remove();
  };
}

type TagInputProps = { onChange: (v: string[]) => void; value: string[] };

function getTagInputProps(callIndex: number): TagInputProps {
  const calls = vi.mocked(TagInput).mock.calls;
  const call = calls[callIndex];
  if (!call) throw new Error(`TagInput call ${callIndex} not found (got ${calls.length} calls)`);
  return call[0] as TagInputProps;
}

function getTagInputOnChange(callIndex: number): (values: string[]) => void {
  return getTagInputProps(callIndex).onChange;
}

describe("ClientRestrictionsEditor", () => {
  const onAllowedChange = vi.fn();
  const onBlockedChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  function renderEditor(allowed: string[], blocked: string[]) {
    return render(
      <ClientRestrictionsEditor
        allowed={allowed}
        blocked={blocked}
        onAllowedChange={onAllowedChange}
        onBlockedChange={onBlockedChange}
        translations={{
          allowAction: "允许",
          blockAction: "阻止",
          customAllowedLabel: "自定义允许",
          customAllowedPlaceholder: "",
          customBlockedLabel: "自定义阻止",
          customBlockedPlaceholder: "",
          customHelp: "",
          presetClients: {},
        }}
      />
    );
  }

  describe("uniqueOrdered normalization", () => {
    it("deduplicates values preserving first occurrence order", () => {
      const unmount = renderEditor([], []);
      act(() => getTagInputOnChange(0)(["a", "b", "a", "c"]));
      expect(onAllowedChange).toHaveBeenCalledWith(["a", "b", "c"]);
      unmount();
    });

    it("preserves preset aliases and filters them out from custom input", () => {
      const unmount = renderEditor(["claude-code-cli", "my-ide"], []);
      expect(getTagInputProps(0).value).toEqual(["my-ide"]);

      act(() => getTagInputOnChange(0)(["next-ide", "claude-code-cli"]));
      expect(onAllowedChange).toHaveBeenCalledWith(["claude-code-cli", "next-ide"]);

      unmount();
    });

    it("does not change blocked values when editing allowed custom values", () => {
      const unmount = renderEditor([], ["b", "c"]);
      act(() => getTagInputOnChange(0)(["a", "b"]));
      expect(onAllowedChange).toHaveBeenCalledWith(["a", "b"]);
      expect(onBlockedChange).not.toHaveBeenCalled();
      unmount();
    });
  });

  describe("custom blocked field", () => {
    it("preserves preset aliases and filters them out from custom input", () => {
      const unmount = renderEditor([], ["claude-code-vscode", "blocked-ide"]);
      expect(getTagInputProps(1).value).toEqual(["blocked-ide"]);

      act(() => getTagInputOnChange(1)(["next-blocked", "claude-code-vscode"]));
      expect(onBlockedChange).toHaveBeenCalledWith(["claude-code-vscode", "next-blocked"]);
      expect(onAllowedChange).not.toHaveBeenCalled();

      unmount();
    });
  });
});
