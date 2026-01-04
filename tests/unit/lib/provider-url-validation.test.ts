import { describe, expect, test, vi } from "vitest";
import { validateProviderUrlForConnectivity } from "@/lib/validation/provider-url";

describe("validateProviderUrlForConnectivity", () => {
  test("允许 localhost/127.0.0.1 等内网地址", () => {
    const cases = ["http://localhost:1234", "https://127.0.0.1:443", "http://[::1]:8080"];

    for (const url of cases) {
      const result = validateProviderUrlForConnectivity(url);
      expect(result.valid).toBe(true);
    }
  });

  test("允许 RFC1918/Link-local 等私网地址", () => {
    const cases = [
      "http://10.0.0.1:8080",
      "http://172.16.0.10:8080",
      "http://192.168.1.2:8080",
      "http://169.254.0.1:8080",
      "http://[fc00::1]:8080",
      "http://[fd00::1]:8080",
      "http://[fe80::1]:8080",
    ];

    for (const url of cases) {
      const result = validateProviderUrlForConnectivity(url);
      expect(result.valid).toBe(true);
    }
  });

  test("允许常见内部服务端口（不再做端口黑名单）", () => {
    const cases = [
      "http://example.com:22",
      "http://example.com:5432",
      "http://example.com:6379",
      "http://example.com:27017",
    ];

    for (const url of cases) {
      const result = validateProviderUrlForConnectivity(url);
      expect(result.valid).toBe(true);
    }
  });

  test("仍然拒绝非 HTTP(S) 协议", () => {
    const result = validateProviderUrlForConnectivity("ftp://example.com");
    expect(result.valid).toBe(false);
  });

  test("仍然拒绝无法解析的 URL", () => {
    const result = validateProviderUrlForConnectivity("not a url");
    expect(result.valid).toBe(false);
  });

  test("当 URL 构造器抛出非 Error 时，应返回兜底错误信息（覆盖边界分支）", () => {
    const originalURL = globalThis.URL;

    vi.stubGlobal(
      "URL",
      class {
        constructor() {
          throw "boom";
        }
      } as any
    );

    try {
      const result = validateProviderUrlForConnectivity("https://example.com");
      expect(result.valid).toBe(false);
      if (result.valid) return;

      expect(result.error).toEqual(
        expect.objectContaining({
          details: expect.objectContaining({
            error: "URL 解析失败",
          }),
        })
      );
    } finally {
      vi.stubGlobal("URL", originalURL as any);
    }
  });
});
