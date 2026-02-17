import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
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

describe("LoginPage Accessibility", () => {
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
  };

  const setInputValue = (input: HTMLInputElement, value: string) => {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const getSubmitButton = () =>
    container.querySelector('button[type="submit"]') as HTMLButtonElement;
  const getApiKeyInput = () => container.querySelector("input#apiKey") as HTMLInputElement;
  const getOverlay = () => container.querySelector('[data-testid="loading-overlay"]');

  it("loading overlay has correct ARIA attributes", async () => {
    let resolveFetch: (value: any) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    (global.fetch as any).mockReturnValue(fetchPromise);

    await render();

    const input = getApiKeyInput();
    await act(async () => {
      setInputValue(input, "test-api-key");
    });

    const button = getSubmitButton();
    await act(async () => {
      button.click();
    });

    const overlay = getOverlay();
    expect(overlay).not.toBeNull();

    expect(overlay?.getAttribute("role")).toBe("dialog");
    expect(overlay?.getAttribute("aria-modal")).toBe("true");
    expect(overlay?.getAttribute("aria-label")).toBe("t:login.loggingIn");

    const statusText = overlay?.querySelector('p[role="status"]');
    expect(statusText).not.toBeNull();
    expect(statusText?.getAttribute("aria-live")).toBe("polite");

    const spinner = overlay?.querySelector(".animate-spin");
    expect(spinner?.classList.contains("motion-reduce:animate-none")).toBe(true);

    await act(async () => {
      resolveFetch!({
        ok: true,
        json: async () => ({ redirectTo: "/dashboard" }),
      });
    });
  });

  it("error state manages focus and announces alert", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Invalid key" }),
    });

    await render();

    const input = getApiKeyInput();
    const focusSpy = vi.spyOn(input, "focus");

    await act(async () => {
      setInputValue(input, "test-api-key");
    });

    await act(async () => {
      getSubmitButton().click();
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Invalid key");

    expect(focusSpy).toHaveBeenCalled();
  });
});
