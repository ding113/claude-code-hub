// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { defaultLocale, locales } from "@/i18n/config";
import { buildLocalCapacityResponse } from "@/lib/memory/http";

const getLocale = vi.hoisted(() => vi.fn());
vi.mock("next-intl/server", () => ({ getLocale }));

describe("本地容量响应语言", () => {
  it.each([...locales, "unknown", "unavailable"])(
    "%s 使用语言目录并保留重试契约",
    async (locale) => {
      if (locale === "unavailable") getLocale.mockRejectedValue(new Error("No request context"));
      else getLocale.mockResolvedValue(locale);
      const response = await buildLocalCapacityResponse();
      const expectedLocale = locales.includes(locale as typeof defaultLocale)
        ? locale
        : defaultLocale;
      const catalog = await import(`../../../messages/${expectedLocale}/errors.json`);
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("1");
      expect(await response.json()).toMatchObject({
        error: {
          type: "local_capacity_exceeded",
          message: catalog.default.LOCAL_CAPACITY_EXCEEDED,
        },
      });
    }
  );
});
