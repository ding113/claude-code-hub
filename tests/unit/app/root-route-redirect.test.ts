import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieValues = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieValues.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

// next/navigation 的 redirect 通过抛出带 digest 的错误交给 Next.js 生成 307 响应
async function captureRedirect(): Promise<{ location: string; status: string }> {
  const { GET } = await import("@/app/route");
  const error = await GET().then(
    () => {
      throw new Error("expected GET to redirect");
    },
    (thrown: unknown) => thrown as { digest?: string }
  );

  const [kind, , location, status] = String(error.digest).split(";");
  expect(kind).toBe("NEXT_REDIRECT");
  return { location, status };
}

describe("root route redirect", () => {
  beforeEach(() => {
    cookieValues.clear();
  });

  it("redirects to the dashboard of the locale stored in the locale cookie", async () => {
    cookieValues.set("NEXT_LOCALE", "ja");

    await expect(captureRedirect()).resolves.toEqual({
      location: "/ja/dashboard",
      status: "307",
    });
  });

  it("falls back to the default locale when the cookie is missing", async () => {
    await expect(captureRedirect()).resolves.toEqual({
      location: "/zh-CN/dashboard",
      status: "307",
    });
  });

  it("ignores locale cookie values that are not supported locales", async () => {
    cookieValues.set("NEXT_LOCALE", "../admin");

    await expect(captureRedirect()).resolves.toEqual({
      location: "/zh-CN/dashboard",
      status: "307",
    });
  });
});
