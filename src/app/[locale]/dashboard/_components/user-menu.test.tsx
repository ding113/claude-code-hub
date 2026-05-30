/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserMenu } from "./user-menu";

const mockPush = vi.hoisted(() => vi.fn());
const mockRefresh = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    ({
      documentation: "Docs",
      logout: "Logout",
    })[key] ?? key,
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

describe("UserMenu", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("keeps a usage documentation entry in the user control area", () => {
    act(() => {
      root.render(<UserMenu user={{ id: 1, name: "Ada Lovelace" }} />);
    });

    const docsLink = container.querySelector('a[href="/usage-doc"][aria-label="Docs"]');

    expect(docsLink).not.toBeNull();
    expect(docsLink?.getAttribute("title")).toBe("Docs");
  });
});
