/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, afterEach, vi } from "vitest";
import { ClientRestrictionsEditor } from "@/components/form/client-restrictions-editor";

const TEST_TRANSLATIONS = {
  allowAction: "Allow",
  blockAction: "Block",
  customAllowedLabel: "Custom Allowed",
  customAllowedPlaceholder: "e.g. my-tool",
  customBlockedLabel: "Custom Blocked",
  customBlockedPlaceholder: "e.g. legacy",
  customHelp: "Custom patterns help text",
  presetClients: {
    "claude-code": "Claude Code (all)",
    "gemini-cli": "Gemini CLI",
    "factory-cli": "Droid CLI",
    "codex-cli": "Codex CLI",
  },
};

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(node);
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

describe("ClientRestrictionsEditor", () => {
  test("renders all 4 preset client rows with correct display labels", () => {
    const onAllowedChange = vi.fn();
    const onBlockedChange = vi.fn();

    const { container, unmount } = render(
      <ClientRestrictionsEditor
        allowed={[]}
        blocked={[]}
        onAllowedChange={onAllowedChange}
        onBlockedChange={onBlockedChange}
        translations={TEST_TRANSLATIONS}
      />
    );

    expect(container.textContent).toContain("Claude Code (all)");
    expect(container.textContent).toContain("Gemini CLI");
    expect(container.textContent).toContain("Droid CLI");
    expect(container.textContent).toContain("Codex CLI");

    unmount();
  });

  test("renders Allow and Block checkboxes for each preset", () => {
    const onAllowedChange = vi.fn();
    const onBlockedChange = vi.fn();

    const { container, unmount } = render(
      <ClientRestrictionsEditor
        allowed={[]}
        blocked={[]}
        onAllowedChange={onAllowedChange}
        onBlockedChange={onBlockedChange}
        translations={TEST_TRANSLATIONS}
      />
    );

    expect(document.getElementById("allow-claude-code")).not.toBeNull();
    expect(document.getElementById("block-claude-code")).not.toBeNull();
    expect(document.getElementById("allow-gemini-cli")).not.toBeNull();
    expect(document.getElementById("block-gemini-cli")).not.toBeNull();
    expect(document.getElementById("allow-factory-cli")).not.toBeNull();
    expect(document.getElementById("block-factory-cli")).not.toBeNull();
    expect(document.getElementById("allow-codex-cli")).not.toBeNull();
    expect(document.getElementById("block-codex-cli")).not.toBeNull();

    unmount();
  });

  test("clicking Allow checkbox calls onAllowedChange with preset value added", () => {
    const onAllowedChange = vi.fn();
    const onBlockedChange = vi.fn();

    render(
      <ClientRestrictionsEditor
        allowed={[]}
        blocked={[]}
        onAllowedChange={onAllowedChange}
        onBlockedChange={onBlockedChange}
        translations={TEST_TRANSLATIONS}
      />
    );

    const allowCheckbox = document.getElementById("allow-claude-code");
    expect(allowCheckbox).not.toBeNull();

    act(() => {
      allowCheckbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onAllowedChange).toHaveBeenCalledWith(["claude-code"]);

    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  test("clicking Allow checkbox also removes preset from blocked list", () => {
    const onAllowedChange = vi.fn();
    const onBlockedChange = vi.fn();

    render(
      <ClientRestrictionsEditor
        allowed={[]}
        blocked={["claude-code"]}
        onAllowedChange={onAllowedChange}
        onBlockedChange={onBlockedChange}
        translations={TEST_TRANSLATIONS}
      />
    );

    const allowCheckbox = document.getElementById("allow-claude-code");
    expect(allowCheckbox).not.toBeNull();

    act(() => {
      allowCheckbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onAllowedChange).toHaveBeenCalledWith(["claude-code"]);
    expect(onBlockedChange).toHaveBeenCalledWith([]);

    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  test("clicking Block checkbox calls onBlockedChange with preset value added", () => {
    const onAllowedChange = vi.fn();
    const onBlockedChange = vi.fn();

    render(
      <ClientRestrictionsEditor
        allowed={[]}
        blocked={[]}
        onAllowedChange={onAllowedChange}
        onBlockedChange={onBlockedChange}
        translations={TEST_TRANSLATIONS}
      />
    );

    const blockCheckbox = document.getElementById("block-gemini-cli");
    expect(blockCheckbox).not.toBeNull();

    act(() => {
      blockCheckbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onBlockedChange).toHaveBeenCalledWith(["gemini-cli"]);

    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  test("clicking Block checkbox also removes preset from allowed list", () => {
    const onAllowedChange = vi.fn();
    const onBlockedChange = vi.fn();

    render(
      <ClientRestrictionsEditor
        allowed={["gemini-cli"]}
        blocked={[]}
        onAllowedChange={onAllowedChange}
        onBlockedChange={onBlockedChange}
        translations={TEST_TRANSLATIONS}
      />
    );

    const blockCheckbox = document.getElementById("block-gemini-cli");
    expect(blockCheckbox).not.toBeNull();

    act(() => {
      blockCheckbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onBlockedChange).toHaveBeenCalledWith(["gemini-cli"]);
    expect(onAllowedChange).toHaveBeenCalledWith([]);

    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  test("unchecking an already-checked Allow removes preset from allowed list", () => {
    const onAllowedChange = vi.fn();
    const onBlockedChange = vi.fn();

    render(
      <ClientRestrictionsEditor
        allowed={["claude-code"]}
        blocked={[]}
        onAllowedChange={onAllowedChange}
        onBlockedChange={onBlockedChange}
        translations={TEST_TRANSLATIONS}
      />
    );

    const allowCheckbox = document.getElementById("allow-claude-code");
    expect(allowCheckbox).not.toBeNull();

    act(() => {
      allowCheckbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onAllowedChange).toHaveBeenCalledWith([]);

    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  test("custom values are split correctly and shown in custom TagInput fields", () => {
    const onAllowedChange = vi.fn();
    const onBlockedChange = vi.fn();

    const { container, unmount } = render(
      <ClientRestrictionsEditor
        allowed={["my-custom-tool", "another-one"]}
        blocked={["legacy-client"]}
        onAllowedChange={onAllowedChange}
        onBlockedChange={onBlockedChange}
        translations={TEST_TRANSLATIONS}
      />
    );

    // Verify that custom allowed and custom blocked labels are rendered
    const labels = Array.from(container.querySelectorAll("label"));
    const labelTexts = labels.map((label) => label.textContent);

    expect(labelTexts.some((text) => text?.includes("Custom Allowed"))).toBe(true);
    expect(labelTexts.some((text) => text?.includes("Custom Blocked"))).toBe(true);

    // Verify checkboxes exist (should have 8: 4 presets * 2 checkboxes)
    const allowCheckboxes = container.querySelectorAll('[id^="allow-"]');
    const blockCheckboxes = container.querySelectorAll('[id^="block-"]');
    expect(allowCheckboxes.length).toBe(4);
    expect(blockCheckboxes.length).toBe(4);

    unmount();
  });
  test("mixed state: allowed with preset and custom renders correctly", () => {
    const onAllowedChange = vi.fn();
    const onBlockedChange = vi.fn();

    const { container, unmount } = render(
      <ClientRestrictionsEditor
        allowed={["claude-code", "my-custom"]}
        blocked={[]}
        onAllowedChange={onAllowedChange}
        onBlockedChange={onBlockedChange}
        translations={TEST_TRANSLATIONS}
      />
    );

    const allowCheckbox = document.getElementById("allow-claude-code");
    expect(allowCheckbox).not.toBeNull();

    const checkedAttr = allowCheckbox?.getAttribute("data-state");
    expect(checkedAttr).toBe("checked");

    const customAllowedLabel = Array.from(container.querySelectorAll("label")).find((label) =>
      label.textContent?.includes("Custom Allowed")
    );
    expect(customAllowedLabel).not.toBeNull();

    unmount();
  });
  test("disabled prop disables all checkboxes", () => {
    const onAllowedChange = vi.fn();
    const onBlockedChange = vi.fn();

    const { container, unmount } = render(
      <ClientRestrictionsEditor
        allowed={[]}
        blocked={[]}
        onAllowedChange={onAllowedChange}
        onBlockedChange={onBlockedChange}
        disabled
        translations={TEST_TRANSLATIONS}
      />
    );

    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((checkbox) => {
      expect(checkbox.hasAttribute("disabled")).toBe(true);
    });

    unmount();
  });

  test("unchecking Block removes preset from blocked list", () => {
    const onAllowedChange = vi.fn();
    const onBlockedChange = vi.fn();

    render(
      <ClientRestrictionsEditor
        allowed={[]}
        blocked={["factory-cli"]}
        onAllowedChange={onAllowedChange}
        onBlockedChange={onBlockedChange}
        translations={TEST_TRANSLATIONS}
      />
    );

    const blockCheckbox = document.getElementById("block-factory-cli");
    expect(blockCheckbox).not.toBeNull();

    act(() => {
      blockCheckbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onBlockedChange).toHaveBeenCalledWith([]);

    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  test("onInvalidTag callback is passed to ArrayTagInputField", () => {
    const onAllowedChange = vi.fn();
    const onBlockedChange = vi.fn();
    const onInvalidTag = vi.fn();

    const { unmount } = render(
      <ClientRestrictionsEditor
        allowed={[]}
        blocked={[]}
        onAllowedChange={onAllowedChange}
        onBlockedChange={onBlockedChange}
        onInvalidTag={onInvalidTag}
        translations={TEST_TRANSLATIONS}
      />
    );

    expect(onInvalidTag).not.toHaveBeenCalled();

    unmount();
  });
});
