import type { ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(async () => null),
}));

vi.mock("@/lib/auth", () => authMocks);

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

const intlServerMocks = vi.hoisted(() => ({
  getTranslations: vi.fn(async ({ locale, namespace }: { locale: string; namespace: string }) => {
    return (key: string) => `${namespace}.${key}.${locale}`;
  }),
}));

vi.mock("next-intl/server", () => intlServerMocks);

function makeAsyncParams(locale: string) {
  const promise = Promise.resolve({ locale });

  Object.defineProperty(promise, "locale", {
    get() {
      throw new Error("sync access to params.locale is not allowed");
    },
  });

  return promise as Promise<{ locale: string }> & { locale: string };
}

describe("Next.js async params compatibility", () => {
  beforeEach(() => {
    authMocks.getSession.mockReset();
    authMocks.getSession.mockResolvedValue(null);
    intlServerMocks.getTranslations.mockClear();
  });

  test("usage-doc generateMetadata awaits params before reading locale", async () => {
    const { generateMetadata } = await import("@/app/[locale]/usage-doc/layout");

    const metadata = await generateMetadata({
      params: makeAsyncParams("en") as unknown as Promise<{ locale: string }>,
    });

    expect(metadata).toEqual({
      title: "usage.pageTitle.en",
      description: "usage.pageDescription.en",
    });
  });

  test("UsageDocLayout awaits params before reading locale (session/no-session branches)", async () => {
    const UsageDocLayoutModule = await import("@/app/[locale]/usage-doc/layout");

    authMocks.getSession.mockResolvedValueOnce(null);
    const noSession = await UsageDocLayoutModule.default({
      children: <div />,
      params: makeAsyncParams("en") as unknown as Promise<{ locale: string }>,
    });
    expect(noSession).toBeTruthy();

    authMocks.getSession.mockResolvedValueOnce({} as never);
    const hasSession = await UsageDocLayoutModule.default({
      children: <div />,
      params: makeAsyncParams("en") as unknown as Promise<{ locale: string }>,
    });
    expect(hasSession).toBeTruthy();
  });

  test("big-screen generateMetadata awaits params before reading locale", async () => {
    const BigScreenLayoutModule = await import(
      "@/app/[locale]/internal/dashboard/big-screen/layout"
    );

    const metadata = await BigScreenLayoutModule.generateMetadata({
      params: makeAsyncParams("en") as unknown as Promise<{ locale: string }>,
    });

    expect(metadata).toEqual({
      title: "bigScreen.pageTitle.en",
      description: "bigScreen.pageDescription.en",
    });

    const element = BigScreenLayoutModule.default({ children: <div /> });
    expect(element).toBeTruthy();
  });
});
