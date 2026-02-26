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

function getTagInputOnChange(callIndex: number): (values: string[]) => void {
  const calls = vi.mocked(TagInput).mock.calls;
  const call = calls[callIndex];
  if (!call) throw new Error(`TagInput call ${callIndex} not found (got ${calls.length} calls)`);
  return (call[0] as TagInputProps).onChange;
}

describe("ClientRestrictionsEditor - custom clients", () => {
  const onAllowedChange = vi.fn();
  const onBlockedChange = vi.fn();

  const translations = {
    allowAction: "Allow",
    blockAction: "Block",
    customAllowedLabel: "Custom Allowed",
    customAllowedPlaceholder: "",
    customBlockedLabel: "Custom Blocked",
    customBlockedPlaceholder: "",
    customHelp: "",
    presetClients: {},
  };

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
        translations={translations}
      />
    );
  }

  it("custom allowed: should deduplicate values preserving order", () => {
    const unmount = renderEditor([], []);

    act(() => getTagInputOnChange(0)(["a", "b", "a", "c"]));

    expect(onAllowedChange).toHaveBeenCalledWith(["a", "b", "c"]);
    expect(onBlockedChange).not.toHaveBeenCalled();
    unmount();
  });

  it("custom blocked: should deduplicate values preserving order", () => {
    const unmount = renderEditor([], []);

    act(() => getTagInputOnChange(1)(["x", "x", "y"]));

    expect(onBlockedChange).toHaveBeenCalledWith(["x", "y"]);
    expect(onAllowedChange).not.toHaveBeenCalled();
    unmount();
  });
});
