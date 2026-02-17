import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/[locale]/login/page";

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
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  useRouter: mockUseRouter,
  usePathname: mockUsePathname,
}));

const globalFetch = global.fetch;

describe("LoginPage Footer Version", () => {
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
    document.body.removeChild(container);
    global.fetch = globalFetch;
  });

  const render = async () => {
    await act(async () => {
      root.render(<LoginPage />);
    });

    await act(async () => {
      await Promise.resolve();
    });
  };

  it("shows version and update hint when hasUpdate=true", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ current: "0.5.0", latest: "0.6.0", hasUpdate: true }),
    });

    await render();

    expect((global.fetch as any).mock.calls[0]?.[0]).toBe("/api/version");
    const footer = container.querySelector('[data-testid="login-footer-version"]');
    expect(footer?.textContent).toContain("v0.5.0");
    expect(footer?.textContent).toContain("t:version.updateAvailable");
  });

  it("shows version without update hint when hasUpdate=false", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ current: "0.5.0", latest: "0.5.0", hasUpdate: false }),
    });

    await render();

    const footer = container.querySelector('[data-testid="login-footer-version"]');
    expect(footer?.textContent).toContain("v0.5.0");
    expect(footer?.textContent).not.toContain("t:version.updateAvailable");
  });

  it("gracefully handles version fetch error without rendering version", async () => {
    (global.fetch as any).mockRejectedValue(new Error("network fail"));

    await render();

    expect(container.querySelector('[data-testid="login-footer-version"]')).toBeNull();
  });
});
