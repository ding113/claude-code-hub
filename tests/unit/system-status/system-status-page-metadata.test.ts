import { describe, expect, test, vi } from "vitest";

const intlServerMocks = vi.hoisted(() => ({
  getTranslations: vi.fn(async ({ locale, namespace }: { locale: string; namespace: string }) => {
    return (key: string) => `${namespace}.${key}.${locale}`;
  }),
}));

vi.mock("next-intl/server", () => intlServerMocks);

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
  test("generateMetadata awaits params before reading locale", async () => {
    const { generateMetadata } = await import("@/app/[locale]/system-status/layout");

    const metadata = await generateMetadata({
      params: makeAsyncParams("en") as unknown as Promise<{ locale: string }>,
    });

    expect(metadata).toEqual({
      title: "systemStatus.pageTitle.en",
      description: "systemStatus.pageDescription.en",
    });
  });
});
