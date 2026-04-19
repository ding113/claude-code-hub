import { describe, expect, test, vi } from "vitest";

const intlServerMocks = vi.hoisted(() => ({
  getTranslations: vi.fn(async ({ locale, namespace }: { locale: string; namespace: string }) => {
    return (key: string) => `${namespace}.${key}.${locale}`;
  }),
}));

vi.mock("next-intl/server", () => intlServerMocks);

vi.mock("next/font/google", () => ({
  IBM_Plex_Mono: vi.fn(() => ({ variable: "font-ibm-plex-mono" })),
  Space_Grotesk: vi.fn(() => ({ variable: "font-space-grotesk" })),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock("@/lib/system-status", () => ({
  getPublicSystemStatusSnapshot: vi.fn(async () => null),
}));

function makeAsyncParams(locale: string) {
  const promise = Promise.resolve({ locale });

  Object.defineProperty(promise, "locale", {
    get() {
      throw new Error("sync access to params.locale is not allowed");
    },
  });

  return promise as Promise<{ locale: string }> & { locale: string };
}

describe("system-status page metadata", () => {
  test.each(["zh-CN", "zh-TW", "en", "ja", "ru"])(
    "generateMetadata awaits params before reading locale (%s)",
    async (locale) => {
    const { generateMetadata } = await import("@/app/[locale]/system-status/layout");

    const metadata = await generateMetadata({
      params: makeAsyncParams(locale) as unknown as Promise<{ locale: string }>,
    });

    expect(metadata).toEqual({
      title: `systemStatus.pageTitle.${locale}`,
      description: `systemStatus.pageDescription.${locale}`,
    });
    }
  );
});
