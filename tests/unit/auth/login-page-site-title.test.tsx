/**
 * @vitest-environment happy-dom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "../../../src/app/[locale]/login/page";

const mockPush = vi.hoisted(() => vi.fn());
const mockRefresh = vi.hoisted(() => vi.fn());
const mockUseRouter = vi.hoisted(() => vi.fn(() => ({ push: mockPush, refresh: mockRefresh })));
const mockUseSearchParams = vi.hoisted(() => vi.fn(() => ({ get: vi.fn(() => null) })));
const mockUseTranslations = vi.hoisted(() => vi.fn(() => (key: string) => `t:${key}`));
const mockUseLocale = vi.hoisted(() => vi.fn(() => "en"));
const mockUsePathname = vi.hoisted(() => vi.fn(() => "/login"));

vi.mock("next/navigation", () => ({
  useSearchParams: mockUseSearchParams,
  useRouter: mockUseRouter,
  usePathname: mockUsePathname,
}));

vi.mock("next-intl", () => ({
  useTranslations: mockUseTranslations,
  useLocale: mockUseLocale,
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: mockUseRouter,
  usePathname: mockUsePathname,
}));

vi.mock("next-themes", () => ({
  useTheme: vi.fn(() => ({ theme: "system", setTheme: vi.fn() })),
}));

const globalFetch = global.fetch;
const DEFAULT_SITE_TITLE = "Claude Code Hub";

function getRequestPath(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.pathname;
  }

  return new URL(input.url).pathname;
}

function mockJsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload,
  } as Response;
}

describe("login page site title", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    global.fetch = globalFetch;
  });

  const render = async () => {
    await act(async () => {
      root.render(<LoginPage />);
    });
  };

  const flushMicrotasks = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it("reads branding from the public-safe metadata endpoint instead of the admin settings API", async () => {
    const requestedPaths: string[] = [];

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (input: string | URL | Request) => {
        const path = getRequestPath(input);
        requestedPaths.push(path);

        if (path === "/api/public-site-meta") {
          return Promise.resolve(mockJsonResponse({ siteTitle: "Acme AI Hub" }));
        }

        return Promise.resolve(mockJsonResponse({ current: "1.0.0", hasUpdate: false }));
      }
    );

    await render();
    await flushMicrotasks();

    const headings = Array.from(container.querySelectorAll("h1")).map(
      (heading) => heading.textContent?.trim() || ""
    );

    expect(requestedPaths).toContain("/api/public-site-meta");
    expect(requestedPaths).not.toContain("/api/system-settings");
    expect(headings).toContain("Acme AI Hub");
    expect(
      container.querySelector<HTMLElement>('[data-testid="login-site-title-footer"]')?.textContent
    ).toBe("Acme AI Hub");
  });

  it("falls back to the default title when the public branding payload is blank", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (input: string | URL | Request) => {
        const path = getRequestPath(input);

        if (path === "/api/public-site-meta") {
          return Promise.resolve(mockJsonResponse({ siteTitle: "   " }));
        }

        return Promise.resolve(mockJsonResponse({ current: "1.0.0", hasUpdate: false }));
      }
    );

    await render();
    await flushMicrotasks();

    expect(
      container.querySelector<HTMLElement>('[data-testid="login-site-title-footer"]')?.textContent
    ).toBe(DEFAULT_SITE_TITLE);
  });
});
