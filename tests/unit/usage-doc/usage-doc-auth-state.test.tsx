/**
 * @vitest-environment happy-dom
 */

import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test, vi } from "vitest";
import { UsageDocAuthProvider } from "@/app/[locale]/usage-doc/_components/usage-doc-auth-context";
import { QuickLinks } from "@/app/[locale]/usage-doc/_components/quick-links";

vi.mock("@/i18n/routing", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function loadUsageMessages() {
  return JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "messages", "en", "usage.json"), "utf8")
  );
}

function renderWithAuth(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const usageMessages = loadUsageMessages();

  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={{ usage: usageMessages }} timeZone="UTC">
        {node}
      </NextIntlClientProvider>
    );
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("usage-doc auth state - HttpOnly cookie alignment", () => {
  test("logged-in: QuickLinks renders dashboard link when isLoggedIn=true", () => {
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });

    const { container, unmount } = renderWithAuth(
      <UsageDocAuthProvider isLoggedIn={true}>
        <QuickLinks isLoggedIn={true} />
      </UsageDocAuthProvider>
    );

    const dashboardLink = container.querySelector('a[href="/dashboard"]');
    expect(dashboardLink).not.toBeNull();

    unmount();
  });

  test("logged-out: QuickLinks does NOT render dashboard link when isLoggedIn=false", () => {
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });

    const { container, unmount } = renderWithAuth(
      <UsageDocAuthProvider isLoggedIn={false}>
        <QuickLinks isLoggedIn={false} />
      </UsageDocAuthProvider>
    );

    const dashboardLink = container.querySelector('a[href="/dashboard"]');
    expect(dashboardLink).toBeNull();

    unmount();
  });

  test("default context value is isLoggedIn=false (no provider ancestor)", () => {
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });

    const { container, unmount } = renderWithAuth(<QuickLinks isLoggedIn={false} />);

    const dashboardLink = container.querySelector('a[href="/dashboard"]');
    expect(dashboardLink).toBeNull();

    unmount();
  });

  test("page.tsx no longer reads document.cookie for auth state", async () => {
    const srcContent = fs.readFileSync(
      path.join(process.cwd(), "src", "app", "[locale]", "usage-doc", "page.tsx"),
      "utf8"
    );
    expect(srcContent).not.toContain("document.cookie");
  });

  test("page.tsx uses useUsageDocAuth hook for session state", async () => {
    const srcContent = fs.readFileSync(
      path.join(process.cwd(), "src", "app", "[locale]", "usage-doc", "page.tsx"),
      "utf8"
    );
    expect(srcContent).toContain("useUsageDocAuth");
  });

  test("layout.tsx wraps children with UsageDocAuthProvider", async () => {
    const srcContent = fs.readFileSync(
      path.join(process.cwd(), "src", "app", "[locale]", "usage-doc", "layout.tsx"),
      "utf8"
    );
    expect(srcContent).toContain("UsageDocAuthProvider");
    expect(srcContent).toContain("isLoggedIn={!!session}");
  });
});
