import { describe, expect, test } from "vitest";
import { computeVendorKey } from "@/repository/provider-endpoints";

describe("computeVendorKey", () => {
  describe("with websiteUrl (priority over providerUrl)", () => {
    test("returns hostname only, ignoring port", () => {
      expect(
        computeVendorKey({
          providerUrl: "https://api.example.com:8080/v1/messages",
          websiteUrl: "https://example.com:3000",
        })
      ).toBe("example.com");
    });

    test("strips www prefix", () => {
      expect(
        computeVendorKey({
          providerUrl: "https://api.example.com",
          websiteUrl: "https://www.example.com",
        })
      ).toBe("example.com");
    });

    test("lowercases hostname", () => {
      expect(
        computeVendorKey({
          providerUrl: "https://api.Example.COM",
          websiteUrl: "https://WWW.EXAMPLE.COM",
        })
      ).toBe("example.com");
    });

    test("handles websiteUrl without protocol", () => {
      expect(
        computeVendorKey({
          providerUrl: "https://api.example.com",
          websiteUrl: "example.com",
        })
      ).toBe("example.com");
    });
  });

  describe("without websiteUrl (fallback to providerUrl with host:port)", () => {
    test("returns host:port for IP address", () => {
      expect(
        computeVendorKey({
          providerUrl: "http://192.168.1.1:8080/v1/messages",
          websiteUrl: null,
        })
      ).toBe("192.168.1.1:8080");
    });

    test("different ports create different keys", () => {
      const key1 = computeVendorKey({
        providerUrl: "http://192.168.1.1:8080/v1/messages",
        websiteUrl: null,
      });
      const key2 = computeVendorKey({
        providerUrl: "http://192.168.1.1:9090/v1/messages",
        websiteUrl: null,
      });
      expect(key1).toBe("192.168.1.1:8080");
      expect(key2).toBe("192.168.1.1:9090");
      expect(key1).not.toBe(key2);
    });

    test("uses default port 443 for https without explicit port", () => {
      expect(
        computeVendorKey({
          providerUrl: "https://api.example.com/v1/messages",
          websiteUrl: null,
        })
      ).toBe("api.example.com:443");
    });

    test("uses default port 80 for http without explicit port", () => {
      expect(
        computeVendorKey({
          providerUrl: "http://api.example.com/v1/messages",
          websiteUrl: null,
        })
      ).toBe("api.example.com:80");
    });

    test("assumes https (port 443) for URL without scheme", () => {
      expect(
        computeVendorKey({
          providerUrl: "api.example.com/v1/messages",
          websiteUrl: null,
        })
      ).toBe("api.example.com:443");
    });

    test("strips www prefix in host:port mode", () => {
      expect(
        computeVendorKey({
          providerUrl: "https://www.example.com:8080/v1/messages",
          websiteUrl: null,
        })
      ).toBe("example.com:8080");
    });

    test("lowercases hostname in host:port mode", () => {
      expect(
        computeVendorKey({
          providerUrl: "https://API.EXAMPLE.COM:8080/v1/messages",
          websiteUrl: null,
        })
      ).toBe("api.example.com:8080");
    });

    test("handles localhost with port", () => {
      expect(
        computeVendorKey({
          providerUrl: "http://localhost:3000/v1/messages",
          websiteUrl: null,
        })
      ).toBe("localhost:3000");
    });

    test("handles localhost without explicit port", () => {
      expect(
        computeVendorKey({
          providerUrl: "http://localhost/v1/messages",
          websiteUrl: null,
        })
      ).toBe("localhost:80");
    });
  });

  describe("IPv6 addresses", () => {
    test("formats IPv6 with brackets and port", () => {
      expect(
        computeVendorKey({
          providerUrl: "http://[::1]:8080/v1/messages",
          websiteUrl: null,
        })
      ).toBe("[::1]:8080");
    });

    test("handles IPv6 without explicit port", () => {
      expect(
        computeVendorKey({
          providerUrl: "https://[::1]/v1/messages",
          websiteUrl: null,
        })
      ).toBe("[::1]:443");
    });

    test("handles full IPv6 address", () => {
      expect(
        computeVendorKey({
          providerUrl: "http://[2001:db8::1]:9000/v1/messages",
          websiteUrl: null,
        })
      ).toBe("[2001:db8::1]:9000");
    });
  });

  describe("edge cases", () => {
    test("returns null for empty providerUrl", () => {
      expect(
        computeVendorKey({
          providerUrl: "",
          websiteUrl: null,
        })
      ).toBeNull();
    });

    test("returns null for whitespace-only providerUrl", () => {
      expect(
        computeVendorKey({
          providerUrl: "   ",
          websiteUrl: null,
        })
      ).toBeNull();
    });

    test("uses providerUrl when websiteUrl is empty string", () => {
      expect(
        computeVendorKey({
          providerUrl: "http://192.168.1.1:8080/v1/messages",
          websiteUrl: "",
        })
      ).toBe("192.168.1.1:8080");
    });

    test("uses providerUrl when websiteUrl is whitespace", () => {
      expect(
        computeVendorKey({
          providerUrl: "http://192.168.1.1:8080/v1/messages",
          websiteUrl: "   ",
        })
      ).toBe("192.168.1.1:8080");
    });

    test("returns null for truly invalid URL", () => {
      expect(
        computeVendorKey({
          providerUrl: "://invalid",
          websiteUrl: null,
        })
      ).toBeNull();
    });
  });
});
