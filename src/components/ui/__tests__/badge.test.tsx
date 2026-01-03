/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test } from "vitest";
import { Badge } from "@/components/ui/badge";

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

describe("Badge", () => {
  test("默认应渲染为 span", () => {
    const { container, unmount } = render(<Badge>hi</Badge>);

    const el = container.querySelector('[data-slot="badge"]');
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe("SPAN");

    unmount();
  });

  test("asChild=true 时应透传到子元素（覆盖 Slot 分支）", () => {
    const { container, unmount } = render(
      <Badge asChild>
        <a href="/x">hi</a>
      </Badge>
    );

    const el = container.querySelector('[data-slot="badge"]');
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe("A");
    expect((el as HTMLAnchorElement).getAttribute("href")).toBe("/x");

    unmount();
  });
});
