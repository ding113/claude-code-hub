import { describe, expect, test, vi } from "vitest";

const systemStatusPageMocks = vi.hoisted(() => ({
  default: vi.fn(async () => "system-status-page"),
  dynamic: "force-dynamic",
}));

const systemStatusLayoutMocks = vi.hoisted(() => ({
  default: vi.fn(({ children }: { children: unknown }) => children),
  generateMetadata: vi.fn(async () => ({
    title: "status-title",
    description: "status-description",
  })),
}));

vi.mock("@/app/[locale]/system-status/page", () => systemStatusPageMocks);
vi.mock("@/app/[locale]/system-status/layout", () => systemStatusLayoutMocks);

describe("status page aliases", () => {
  test("status page re-exports system-status page", async () => {
    const pageModule = await import("@/app/[locale]/status/page");
    const result = await pageModule.default({
      params: Promise.resolve({ locale: "en" }),
    } as never);

    expect(pageModule.dynamic).toBe("force-dynamic");
    expect(systemStatusPageMocks.default).toHaveBeenCalledTimes(1);
    expect(result).toBe("system-status-page");
  });

  test("status layout re-exports system-status layout metadata and wrapper", async () => {
    const layoutModule = await import("@/app/[locale]/status/layout");
    const metadata = await layoutModule.generateMetadata({
      params: Promise.resolve({ locale: "en" }),
    } as never);
    const wrapped = layoutModule.default({ children: "ok" });

    expect(systemStatusLayoutMocks.generateMetadata).toHaveBeenCalledTimes(1);
    expect(metadata).toEqual({
      title: "status-title",
      description: "status-description",
    });
    expect(wrapped).toBe("ok");
  });
});
