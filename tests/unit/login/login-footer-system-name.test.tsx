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

  return input.url;
}

function mockJsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload,
  } as Response;
}

describe("LoginPage footer system name", () => {
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

  const getSiteTitleFooter = () =>
    container.querySelector<HTMLElement>('[data-testid="login-site-title-footer"]');

  it("renders configured site title when API returns it", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (input: string | URL | Request) => {
        const path = getRequestPath(input);

        if (path === "/api/system-settings") {
          return Promise.resolve(mockJsonResponse({ siteTitle: "My Custom Hub" }));
        }

        return Promise.resolve(mockJsonResponse({ current: "1.0.0", hasUpdate: false }));
      }
    );

    await render();
    await flushMicrotasks();

    expect(getSiteTitleFooter()).not.toBeNull();
    expect(getSiteTitleFooter()?.textContent).toBe("My Custom Hub");
  });

  it("falls back to default title when API fails", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (input: string | URL | Request) => {
        const path = getRequestPath(input);

        if (path === "/api/system-settings") {
          return Promise.resolve(mockJsonResponse({ error: "Unauthorized" }, false));
        }

        return Promise.resolve(mockJsonResponse({ current: "1.0.0", hasUpdate: false }));
      }
    );

    await render();
    await flushMicrotasks();

    expect(getSiteTitleFooter()).not.toBeNull();
    expect(getSiteTitleFooter()?.textContent).toBe(DEFAULT_SITE_TITLE);
  });

  it("shows default title while loading", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (input: string | URL | Request) => {
        const path = getRequestPath(input);

        if (path === "/api/system-settings") {
          return new Promise(() => {});
        }

        return Promise.resolve(mockJsonResponse({ current: "1.0.0", hasUpdate: false }));
      }
    );

    await render();

    expect(getSiteTitleFooter()).not.toBeNull();
    expect(getSiteTitleFooter()?.textContent).toBe(DEFAULT_SITE_TITLE);
  });
});
