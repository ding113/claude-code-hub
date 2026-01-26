/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, afterEach } from "vitest";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  DropdownMenuSubTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";

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

describe("SelectItem highlight classes", () => {
  test("SelectItem should use primary-based highlight classes for focus state", () => {
    const { container, unmount } = render(
      <Select defaultOpen>
        <SelectTrigger>
          <SelectValue placeholder="Select" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="option1">Option 1</SelectItem>
          <SelectItem value="option2">Option 2</SelectItem>
        </SelectContent>
      </Select>
    );

    // Find SelectItem in the portal (document.body)
    const selectItem = document.querySelector('[data-slot="select-item"]');
    expect(selectItem).not.toBeNull();

    const className = selectItem?.getAttribute("class") ?? "";

    // Should use primary-based highlight classes instead of accent
    expect(className).toContain("focus:bg-primary");
    expect(className).toContain("focus:text-primary-foreground");

    // Should NOT use accent-based highlight classes
    expect(className).not.toContain("focus:bg-accent");
    expect(className).not.toContain("focus:text-accent-foreground");

    unmount();
  });

  test("SelectItem should preserve disabled styling", () => {
    const { unmount } = render(
      <Select defaultOpen>
        <SelectTrigger>
          <SelectValue placeholder="Select" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="option1" disabled>
            Disabled Option
          </SelectItem>
        </SelectContent>
      </Select>
    );

    const selectItem = document.querySelector('[data-slot="select-item"]');
    const className = selectItem?.getAttribute("class") ?? "";

    // Disabled styling should be preserved
    expect(className).toContain("data-[disabled]:pointer-events-none");
    expect(className).toContain("data-[disabled]:opacity-50");

    unmount();
  });
});

describe("DropdownMenuItem highlight classes", () => {
  test("DropdownMenuItem should use primary-based highlight classes for focus state", () => {
    const { unmount } = render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
          <DropdownMenuItem>Item 2</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const menuItem = document.querySelector('[data-slot="dropdown-menu-item"]');
    expect(menuItem).not.toBeNull();

    const className = menuItem?.getAttribute("class") ?? "";

    // Should use primary-based highlight classes
    expect(className).toContain("focus:bg-primary");
    expect(className).toContain("focus:text-primary-foreground");

    // Should NOT use accent-based highlight classes
    expect(className).not.toContain("focus:bg-accent");
    expect(className).not.toContain("focus:text-accent-foreground");

    unmount();
  });

  test("DropdownMenuItem should preserve destructive variant styling", () => {
    const { unmount } = render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const menuItem = document.querySelector('[data-slot="dropdown-menu-item"]');
    const className = menuItem?.getAttribute("class") ?? "";

    // Destructive variant styling should be preserved
    expect(className).toContain("data-[variant=destructive]:text-destructive");
    expect(className).toContain("data-[variant=destructive]:focus:bg-destructive/10");
    expect(className).toContain("data-[variant=destructive]:focus:text-destructive");

    unmount();
  });

  test("DropdownMenuItem should preserve disabled styling", () => {
    const { unmount } = render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem disabled>Disabled Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const menuItem = document.querySelector('[data-slot="dropdown-menu-item"]');
    const className = menuItem?.getAttribute("class") ?? "";

    // Disabled styling should be preserved
    expect(className).toContain("data-[disabled]:pointer-events-none");
    expect(className).toContain("data-[disabled]:opacity-50");

    unmount();
  });
});

describe("DropdownMenuCheckboxItem highlight classes", () => {
  test("DropdownMenuCheckboxItem should use primary-based highlight classes", () => {
    const { unmount } = render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem checked>Checked Item</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const checkboxItem = document.querySelector('[data-slot="dropdown-menu-checkbox-item"]');
    expect(checkboxItem).not.toBeNull();

    const className = checkboxItem?.getAttribute("class") ?? "";

    // Should use primary-based highlight classes
    expect(className).toContain("focus:bg-primary");
    expect(className).toContain("focus:text-primary-foreground");

    // Should NOT use accent-based highlight classes
    expect(className).not.toContain("focus:bg-accent");
    expect(className).not.toContain("focus:text-accent-foreground");

    unmount();
  });
});

describe("DropdownMenuRadioItem highlight classes", () => {
  test("DropdownMenuRadioItem should use primary-based highlight classes", () => {
    const { unmount } = render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="option1">
            <DropdownMenuRadioItem value="option1">Option 1</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="option2">Option 2</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const radioItem = document.querySelector('[data-slot="dropdown-menu-radio-item"]');
    expect(radioItem).not.toBeNull();

    const className = radioItem?.getAttribute("class") ?? "";

    // Should use primary-based highlight classes
    expect(className).toContain("focus:bg-primary");
    expect(className).toContain("focus:text-primary-foreground");

    // Should NOT use accent-based highlight classes
    expect(className).not.toContain("focus:bg-accent");
    expect(className).not.toContain("focus:text-accent-foreground");

    unmount();
  });
});

describe("DropdownMenuSubTrigger highlight classes", () => {
  test("DropdownMenuSubTrigger should use primary-based highlight classes for focus and open states", () => {
    const { unmount } = render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Submenu</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Sub Item</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const subTrigger = document.querySelector('[data-slot="dropdown-menu-sub-trigger"]');
    expect(subTrigger).not.toBeNull();

    const className = subTrigger?.getAttribute("class") ?? "";

    // Should use primary-based highlight classes for focus state
    expect(className).toContain("focus:bg-primary");
    expect(className).toContain("focus:text-primary-foreground");

    // Should use primary-based highlight classes for open state
    expect(className).toContain("data-[state=open]:bg-primary");
    expect(className).toContain("data-[state=open]:text-primary-foreground");

    // Should NOT use accent-based highlight classes
    expect(className).not.toContain("focus:bg-accent");
    expect(className).not.toContain("focus:text-accent-foreground");
    expect(className).not.toContain("data-[state=open]:bg-accent");
    expect(className).not.toContain("data-[state=open]:text-accent-foreground");

    unmount();
  });
});
