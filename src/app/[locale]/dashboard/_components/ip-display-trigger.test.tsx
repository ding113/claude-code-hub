/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import { IpDisplayTrigger } from "./ip-display-trigger";

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

describe("IpDisplayTrigger", () => {
  test("renders placeholder when ip is empty", () => {
    const { container, unmount } = render(<IpDisplayTrigger ip={null} onClick={() => {}} />);

    expect(container.textContent).toContain("—");
    expect(container.querySelector("button")).toBeNull();

    unmount();
  });

  test("renders a truncating trigger for long ipv6 and forwards click", () => {
    const onClick = vi.fn();
    const ipv6 = "2001:0db8:85a3:0000:0000:8a2e:0370:7334";
    const { container, unmount } = render(<IpDisplayTrigger ip={ipv6} onClick={onClick} />);

    const button = container.querySelector("button");
    const text = container.querySelector("[data-slot='ip-display-text']");

    expect(button).not.toBeNull();
    expect(button?.getAttribute("title")).toBe(ipv6);
    expect(button?.className).toContain("w-full");
    expect(button?.className).toContain("min-w-0");
    expect(text?.textContent).toBe(ipv6);
    expect(text?.className).toContain("truncate");
    expect(text?.className).toContain("max-w-full");

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    unmount();
  });
});
