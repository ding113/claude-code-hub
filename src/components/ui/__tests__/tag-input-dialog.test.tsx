/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, afterEach } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TagInput } from "@/components/ui/tag-input";

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

function DialogTagInput() {
  const [value, setValue] = useState<string[]>([]);

  return (
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tag Input</DialogTitle>
          <DialogDescription>Tag input dialog test</DialogDescription>
        </DialogHeader>
        <TagInput
          value={value}
          onChange={setValue}
          suggestions={[
            { value: "tag1", label: "Tag 1" },
            { value: "tag2", label: "Tag 2" },
          ]}
        />
      </DialogContent>
    </Dialog>
  );
}

describe("TagInput inside Dialog", () => {
  test("renders suggestions under dialog content and supports click selection", async () => {
    const { container, unmount } = render(<DialogTagInput />);

    const input = document.querySelector("input");
    expect(input).not.toBeNull();

    await act(async () => {
      input?.focus();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const dialogContent = document.querySelector('[data-slot="dialog-content"]');
    expect(dialogContent).not.toBeNull();
    const suggestionButton = Array.from(dialogContent?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Tag 1"
    );

    expect(suggestionButton).not.toBeNull();
    expect(suggestionButton?.closest('[data-slot="dialog-content"]')).not.toBeNull();

    await act(async () => {
      suggestionButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    const dialogContentAfterClick = document.querySelector('[data-slot="dialog-content"]');
    expect(dialogContentAfterClick?.textContent).toContain("tag1");

    unmount();
  });

  test("supports keyboard selection within dialog", async () => {
    const { container, unmount } = render(<DialogTagInput />);

    const input = document.querySelector("input");
    expect(input).not.toBeNull();

    await act(async () => {
      input?.focus();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const dialogContentAfterKey = document.querySelector('[data-slot="dialog-content"]');
    expect(dialogContentAfterKey?.textContent).toContain("tag1");

    unmount();
  });
});
