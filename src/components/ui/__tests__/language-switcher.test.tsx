/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import type { Locale } from "@/i18n/config";

const testState = vi.hoisted(() => ({
  currentLocale: "zh-CN" as Locale,
  pathname: "/settings/config",
  router: {
    push: vi.fn(),
    refresh: vi.fn(),
  },
}));

vi.mock("next-intl", () => ({
  useLocale: () => testState.currentLocale,
}));

vi.mock("@/i18n/routing", () => ({
  usePathname: () => testState.pathname,
  useRouter: () => testState.router,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(node);
  });

  return {
    container,
    rerender: (nextNode: ReactNode) => {
      act(() => {
        root.render(nextNode);
      });
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("LanguageSwitcher", () => {
  let view: ReturnType<typeof render> | null = null;

  beforeEach(() => {
    window.sessionStorage.clear();
    testState.currentLocale = "zh-CN";
    testState.pathname = "/settings/config";
    testState.router.push.mockReset();
    testState.router.refresh.mockReset();
  });

  afterEach(() => {
    view?.unmount();
    view = null;
  });

  test("refreshes the current route after the locale provider catches up", () => {
    view = render(<LanguageSwitcher />);

    const englishOption = Array.from(view.container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("English")
    );

    expect(englishOption).toBeTruthy();
    click(englishOption!);

    expect(testState.router.push).toHaveBeenCalledWith("/settings/config", { locale: "en" });
    expect(testState.router.refresh).not.toHaveBeenCalled();

    testState.currentLocale = "en";
    view.rerender(<LanguageSwitcher />);

    expect(testState.router.refresh).toHaveBeenCalledTimes(1);
    const trigger = view.container.querySelector<HTMLButtonElement>(
      "button[aria-label='Select language']"
    );
    expect(trigger?.disabled).toBe(false);
  });

  test("restores the pending refresh after the switcher remounts during navigation", () => {
    view = render(<LanguageSwitcher />);

    const englishOption = Array.from(view.container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("English")
    );

    expect(englishOption).toBeTruthy();
    click(englishOption!);

    expect(window.sessionStorage.getItem("cch.pendingLocaleRefresh")).toBe("en");

    view.unmount();
    view = null;

    testState.currentLocale = "en";
    view = render(<LanguageSwitcher />);

    expect(testState.router.refresh).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem("cch.pendingLocaleRefresh")).toBeNull();
  });

  test("does not refresh from a stale stored locale marker on mount", () => {
    window.sessionStorage.setItem("cch.pendingLocaleRefresh", "en");
    testState.currentLocale = "en";

    view = render(<LanguageSwitcher />);

    expect(testState.router.refresh).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("cch.pendingLocaleRefresh")).toBe("en");
  });
});
