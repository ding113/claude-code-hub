/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MyUsageHeader } from "./my-usage-header";

const mockPush = vi.hoisted(() => vi.fn());
const mockRefresh = vi.hoisted(() => vi.fn());

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

const messages = {
  myUsage: {
    header: {
      title: "My Usage",
      welcome: "Welcome, {name}",
      documentation: "Usage Docs",
      logout: "Logout",
      keyLabel: "Key",
      userLabel: "User",
    },
  },
};

describe("MyUsageHeader", () => {
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

  function renderHeader() {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <MyUsageHeader keyName="primary-key" userName="Ada" />
        </NextIntlClientProvider>
      );
    });
  }

  it("renders a visible usage documentation entry for readonly users", () => {
    renderHeader();

    const docsLink = container.querySelector('a[href="/usage-doc"]');

    expect(docsLink).not.toBeNull();
    expect(docsLink?.textContent).toContain("Usage Docs");
    expect(container.textContent).toContain("Welcome, Ada");
  });
});
