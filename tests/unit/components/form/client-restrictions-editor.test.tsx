/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/client-restrictions/client-presets", () => ({
  CLIENT_RESTRICTION_PRESET_OPTIONS: [],
}));

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

function getTagInputOnChange(callIndex: number): (values: string[]) => void {
  const calls = vi.mocked(TagInput).mock.calls;
  const call = calls[callIndex];
  if (!call) throw new Error(`TagInput call ${callIndex} not found (got ${calls.length} calls)`);
  return (call[0] as TagInputProps).onChange;
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
        allowedLabel="Allowed"
        blockedLabel="Blocked"
        getPresetLabel={(v) => v}
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

    it("trims whitespace from values", () => {
      const unmount = renderEditor([], []);
      act(() => getTagInputOnChange(0)(["  a  ", " b", "c "]));
      expect(onAllowedChange).toHaveBeenCalledWith(["a", "b", "c"]);
      unmount();
    });

    it("filters out empty and whitespace-only entries", () => {
      const unmount = renderEditor([], []);
      act(() => getTagInputOnChange(0)(["a", "", "  ", "b"]));
      expect(onAllowedChange).toHaveBeenCalledWith(["a", "b"]);
      unmount();
    });
  });

  describe("allow/block mutual exclusion", () => {
    it("removes overlapping items from blocked when added to allowed", () => {
      const unmount = renderEditor([], ["b", "c"]);
      act(() => getTagInputOnChange(0)(["a", "b"]));
      expect(onAllowedChange).toHaveBeenCalledWith(["a", "b"]);
      expect(onBlockedChange).toHaveBeenCalledWith(["c"]);
      unmount();
    });

    it("does not call onBlockedChange when allowed has no overlap with blocked", () => {
      const unmount = renderEditor([], ["c", "d"]);
      act(() => getTagInputOnChange(0)(["a", "b"]));
      expect(onAllowedChange).toHaveBeenCalledWith(["a", "b"]);
      expect(onBlockedChange).not.toHaveBeenCalled();
      unmount();
    });

    it("removes overlapping items from allowed when added to blocked", () => {
      const unmount = renderEditor(["a", "b"], []);
      act(() => getTagInputOnChange(1)(["b", "c"]));
      expect(onBlockedChange).toHaveBeenCalledWith(["b", "c"]);
      expect(onAllowedChange).toHaveBeenCalledWith(["a"]);
      unmount();
    });

    it("does not call onAllowedChange when blocked has no overlap with allowed", () => {
      const unmount = renderEditor(["a", "b"], []);
      act(() => getTagInputOnChange(1)(["c", "d"]));
      expect(onBlockedChange).toHaveBeenCalledWith(["c", "d"]);
      expect(onAllowedChange).not.toHaveBeenCalled();
      unmount();
    });

    it("clears all blocked when all items are moved to allowed", () => {
      const unmount = renderEditor([], ["x", "y"]);
      act(() => getTagInputOnChange(0)(["x", "y", "z"]));
      expect(onAllowedChange).toHaveBeenCalledWith(["x", "y", "z"]);
      expect(onBlockedChange).toHaveBeenCalledWith([]);
      unmount();
    });
  });
});
