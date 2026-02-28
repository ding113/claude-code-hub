import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import LoginPage from "@/app/[locale]/login/page";

// Mocks
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

vi.mock("next-themes", () => ({
  useTheme: vi.fn(() => ({ theme: "system", setTheme: vi.fn() })),
}));

describe("LoginPage Visual Regression", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  const render = async () => {
    await act(async () => {
      root.render(<LoginPage />);
    });
  };

  it("renders key structural elements", async () => {
    await render();

    const mainContainer = container.querySelector("div.bg-gradient-to-br");
    expect(mainContainer).not.toBeNull();
    const className = mainContainer?.className || "";
    expect(className).toContain("min-h-[var(--cch-viewport-height,100vh)]");
    expect(className).toContain("bg-gradient-to");

    const langSwitcher = container.querySelector(".fixed.top-4.right-4");
    expect(langSwitcher).not.toBeNull();

    const card = container.querySelector('[data-slot="card"]');
    expect(card).not.toBeNull();

    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    const input = container.querySelector("input#apiKey");
    expect(input).not.toBeNull();

    const button = container.querySelector('button[type="submit"]');
    expect(button).not.toBeNull();
  });

  it("has mobile responsive classes", async () => {
    await render();

    const wrapper = container.querySelector(".max-w-lg");
    expect(wrapper).not.toBeNull();

    const card = wrapper?.querySelector('[data-slot="card"]');
    expect(card).not.toBeNull();
    expect(card?.className).toContain("w-full");
  });
});
