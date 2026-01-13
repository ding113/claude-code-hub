import { describe, expect, test } from "vitest";
import { normalizeVendorKeyFromUrl } from "@/lib/utils/vendor-key";

describe("normalizeVendorKeyFromUrl", () => {
  test("应从 https URL 提取并归一化 hostname（去掉 www.）", () => {
    expect(normalizeVendorKeyFromUrl("https://www.Example.com/path")).toBe("example.com");
  });

  test("应保留子域名（仅去掉最前缀 www.）", () => {
    expect(normalizeVendorKeyFromUrl("https://www.api.example.com")).toBe("api.example.com");
    expect(normalizeVendorKeyFromUrl("https://api.example.com")).toBe("api.example.com");
  });

  test("包含端口时应忽略端口，仅使用 hostname", () => {
    expect(normalizeVendorKeyFromUrl("https://api.example.com:8443/v1")).toBe("api.example.com");
  });

  test("无效 URL 应返回 null", () => {
    expect(normalizeVendorKeyFromUrl("not-a-url")).toBeNull();
  });
});
