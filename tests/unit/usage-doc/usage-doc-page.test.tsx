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
import UsageDocPage from "@/app/[locale]/usage-doc/page";

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

function loadUsageMessages(locale: string) {
  return JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "messages", locale, "usage.json"), "utf8")
  );
}

async function renderWithIntl(locale: string, node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const usageMessages = loadUsageMessages(locale);

  await act(async () => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={{ usage: usageMessages }} timeZone="UTC">
        {node}
      </NextIntlClientProvider>
    );
  });

  return {
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe("UsageDocPage - 目录/快速链接交互", () => {
  test("应渲染 skip links，且登录态显示返回仪表盘链接", async () => {
    Object.defineProperty(window, "scrollTo", {
      value: vi.fn(),
      writable: true,
    });

    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "auth-token=test-token",
    });

    const { unmount } = await renderWithIntl("en", <UsageDocPage />);

    expect(document.querySelector('a[href="#main-content"]')).not.toBeNull();
    expect(document.querySelector('a[href="#toc-navigation"]')).not.toBeNull();

    const dashboardLink = document.querySelector('a[href="/dashboard"]');
    expect(dashboardLink).not.toBeNull();

    await unmount();

    Reflect.deleteProperty(document, "cookie");
  });

  test("目录项点击后应触发平滑滚动", async () => {
    const scrollToMock = vi.fn();
    Object.defineProperty(window, "scrollTo", {
      value: scrollToMock,
      writable: true,
    });

    const { unmount } = await renderWithIntl("en", <UsageDocPage />);

    const tocNav = document.querySelector("#toc-navigation nav");
    expect(tocNav).not.toBeNull();

    let tocButtons = tocNav?.querySelectorAll("button") ?? [];
    for (let i = 0; i < 10 && tocButtons.length === 0; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      tocButtons = tocNav?.querySelectorAll("button") ?? [];
    }

    expect(tocButtons.length).toBeGreaterThan(0);

    await act(async () => {
      (tocButtons[0] as HTMLButtonElement).click();
    });

    expect(scrollToMock).toHaveBeenCalled();

    await unmount();
  });
});
