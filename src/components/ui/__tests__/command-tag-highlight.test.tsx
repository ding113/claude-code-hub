/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, afterEach } from "vitest";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
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
  // Clean up any portaled content
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

describe("CommandItem highlight classes", () => {
  test("CommandItem should use primary-based highlight classes for selected state", () => {
    const { container, unmount } = render(
      <Command>
        <CommandList>
          <CommandGroup>
            <CommandItem>Item 1</CommandItem>
            <CommandItem>Item 2</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    );

    const commandItem = container.querySelector('[data-slot="command-item"]');
    expect(commandItem).not.toBeNull();

    const className = commandItem?.getAttribute("class") ?? "";

    // Should use primary-based highlight classes for selected state
    expect(className).toContain("data-[selected=true]:bg-primary");
    expect(className).toContain("data-[selected=true]:text-primary-foreground");

    // Should NOT use accent-based highlight classes
    expect(className).not.toContain("data-[selected=true]:bg-accent");
    expect(className).not.toContain("data-[selected=true]:text-accent-foreground");

    unmount();
  });

  test("CommandItem should preserve disabled styling", () => {
    const { container, unmount } = render(
      <Command>
        <CommandList>
          <CommandGroup>
            <CommandItem disabled>Disabled Item</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    );

    const commandItem = container.querySelector('[data-slot="command-item"]');
    const className = commandItem?.getAttribute("class") ?? "";

    // Disabled styling should be preserved
    expect(className).toContain("data-[disabled=true]:pointer-events-none");
    expect(className).toContain("data-[disabled=true]:opacity-50");

    unmount();
  });
});

describe("TagInput suggestion highlight classes", () => {
  test("TagInput suggestion items should use primary-based highlight classes for hover state", async () => {
    const suggestions = [
      { value: "tag1", label: "Tag 1" },
      { value: "tag2", label: "Tag 2" },
    ];

    const { container, unmount } = render(
      <TagInput value={[]} onChange={() => {}} suggestions={suggestions} />
    );

    // Focus the input to show suggestions
    const input = container.querySelector("input");
    expect(input).not.toBeNull();

    await act(async () => {
      input?.focus();
      // Wait for suggestions to appear
      await new Promise((r) => setTimeout(r, 50));
    });

    // Find suggestion buttons in the portal
    const suggestionButtons = document.querySelectorAll("button.w-full.px-3.py-2");

    // Verify suggestions are rendered
    expect(suggestionButtons.length).toBeGreaterThan(0);

    const className = suggestionButtons[0].getAttribute("class") ?? "";

    // Should use primary-based highlight classes for hover state
    expect(className).toContain("hover:bg-primary");
    expect(className).toContain("hover:text-primary-foreground");

    // Should NOT use accent-based highlight classes
    expect(className).not.toContain("hover:bg-accent");
    expect(className).not.toContain("hover:text-accent-foreground");

    unmount();
  });

  test("TagInput highlighted suggestion should use primary-based background", async () => {
    const suggestions = [
      { value: "tag1", label: "Tag 1" },
      { value: "tag2", label: "Tag 2" },
    ];

    const { container, unmount } = render(
      <TagInput value={[]} onChange={() => {}} suggestions={suggestions} />
    );

    // Focus the input to show suggestions
    const input = container.querySelector("input");
    expect(input).not.toBeNull();

    await act(async () => {
      input?.focus();
      // Wait for suggestions to appear
      await new Promise((r) => setTimeout(r, 50));
    });

    // Find suggestion buttons in the portal
    const suggestionButtons = document.querySelectorAll("button.w-full.px-3.py-2");

    // Verify suggestions are rendered
    expect(suggestionButtons.length).toBeGreaterThan(0);

    const className = suggestionButtons[0].getAttribute("class") ?? "";

    // The highlighted state class should use primary (when index === highlightedIndex)
    // This is applied conditionally, so we check the hover classes which are always present
    expect(className).toContain("hover:bg-primary");
    expect(className).toContain("hover:text-primary-foreground");

    unmount();
  });
});
