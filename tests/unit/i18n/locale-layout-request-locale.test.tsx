import type { ReactElement, ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";

const nextIntlMocks = vi.hoisted(() => ({
  provider: vi.fn(({ children }: { children: ReactNode }) => children),
  getMessages: vi.fn(async () => ({ dashboard: { nav: { dashboard: "Dashboard" } } })),
  setRequestLocale: vi.fn(),
}));

vi.mock("next-intl", () => ({
  NextIntlClientProvider: nextIntlMocks.provider,
}));

vi.mock("next-intl/server", () => ({
  getMessages: nextIntlMocks.getMessages,
  setRequestLocale: nextIntlMocks.setRequestLocale,
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: vi.fn(() => null),
  })),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));

vi.mock("@/components/customs/footer", () => ({
  Footer: () => null,
}));

vi.mock("@/components/ui/sonner", () => ({
  Toaster: () => null,
}));

vi.mock("@/lib/layout-site-metadata", () => ({
  resolveDefaultLayoutTimeZone: vi.fn(async () => "UTC"),
  resolveDefaultSiteMetadataSource: vi.fn(async () => null),
}));

vi.mock("@/lib/public-status/layout-metadata", () => ({
  resolveLayoutTimeZone: vi.fn(async () => "UTC"),
  resolveSiteMetadataSource: vi.fn(async () => null),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock("@/app/providers", () => ({
  AppProviders: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/app/globals.css", () => ({}));

function findProviderElement(node: ReactNode): ReactElement | null {
  if (!node || typeof node !== "object") {
    return null;
  }

  if (!("props" in node)) {
    return null;
  }

  const element = node as ReactElement<{ children?: ReactNode }>;

  if (element.type === nextIntlMocks.provider) {
    return element;
  }

  const children = element.props.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const match = findProviderElement(child);
      if (match) return match;
    }
    return null;
  }

  return findProviderElement(children);
}

describe("locale root layout", () => {
  test("pins next-intl request locale and provider locale to the route segment", async () => {
    const { default: RootLayout } = await import("@/app/[locale]/layout");

    const tree = await RootLayout({
      children: <main />,
      params: Promise.resolve({ locale: "en" }),
    });

    expect.soft(nextIntlMocks.setRequestLocale).toHaveBeenCalledWith("en");
    expect(nextIntlMocks.getMessages).toHaveBeenCalledWith({ locale: "en" });

    const provider = findProviderElement(tree);
    expect.soft(provider?.props).toMatchObject({
      locale: "en",
      timeZone: "UTC",
    });
  });
});
