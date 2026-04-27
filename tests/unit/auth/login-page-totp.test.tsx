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

function mockJsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload,
  } as Response;
}

function getRequestPath(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.pathname;
  return new URL(input.url).pathname;
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("login page TOTP flow", () => {
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

  it("prompts for OTP after key validation and submits the OTP code", async () => {
    const loginBodies: unknown[] = [];

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (input: string | URL | Request, init?: RequestInit) => {
        const path = getRequestPath(input);

        if (path === "/api/auth/login") {
          loginBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
          if (loginBodies.length === 1) {
            return Promise.resolve(mockJsonResponse({ ok: true, requiresOtp: true }));
          }
          return Promise.resolve(
            mockJsonResponse({
              ok: true,
              redirectTo: "/dashboard",
              loginType: "dashboard_user",
            })
          );
        }

        if (path === "/api/public-site-meta") {
          return Promise.resolve(mockJsonResponse({ siteTitle: "Acme AI Hub" }));
        }

        return Promise.resolve(mockJsonResponse({ current: "1.0.0", hasUpdate: false }));
      }
    );

    await act(async () => {
      root.render(<LoginPage />);
    });
    await flushMicrotasks();

    const apiKeyInput = container.querySelector<HTMLInputElement>("#apiKey");
    expect(apiKeyInput).not.toBeNull();

    await act(async () => {
      setInputValue(apiKeyInput!, "valid-key");
    });

    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flushMicrotasks();

    expect(container.textContent).toContain("t:form.otpCodeLabel");
    const otpInput = container.querySelector<HTMLInputElement>("#otpCode");
    expect(otpInput).not.toBeNull();

    await act(async () => {
      setInputValue(otpInput!, "123456");
    });

    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flushMicrotasks();

    expect(loginBodies).toEqual([{ key: "valid-key" }, { key: "valid-key", otpCode: "123456" }]);
    expect(mockPush).toHaveBeenCalledWith("/dashboard");
  });
});
