import { describe, expect, test } from "vitest";
import { computeVendorKey } from "@/repository/provider-endpoints";

describe("computeVendorKey", () => {
  describe("with websiteUrl (priority over providerUrl)", () => {
    test("returns hostname only, ignoring port", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "https://api.example.com:8080/v1/messages",
          websiteUrl: "https://example.com:3000",
        })
      ).toBe("example.com");
    });

    test("strips www prefix", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "https://api.example.com",
          websiteUrl: "https://www.example.com",
        })
      ).toBe("example.com");
    });

    test("lowercases hostname", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "https://api.Example.COM",
          websiteUrl: "https://WWW.EXAMPLE.COM",
        })
      ).toBe("example.com");
    });

    test("handles websiteUrl without protocol", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "https://api.example.com",
          websiteUrl: "example.com",
        })
      ).toBe("example.com");
    });
  });

  describe("without websiteUrl (fallback to providerUrl with host:port)", () => {
    test("returns host:port for IP address", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "http://192.168.1.1:8080/v1/messages",
          websiteUrl: null,
        })
      ).toBe("192.168.1.1:8080");
    });

    test("different ports create different keys", async () => {
      const key1 = await computeVendorKey({
        providerUrl: "http://192.168.1.1:8080/v1/messages",
        websiteUrl: null,
      });
      const key2 = await computeVendorKey({
        providerUrl: "http://192.168.1.1:9090/v1/messages",
        websiteUrl: null,
      });
      expect(key1).toBe("192.168.1.1:8080");
      expect(key2).toBe("192.168.1.1:9090");
      expect(key1).not.toBe(key2);
    });

    test("uses default port 443 for https without explicit port", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "https://api.example.com/v1/messages",
          websiteUrl: null,
        })
      ).toBe("api.example.com:443");
    });

    test("uses default port 80 for http without explicit port", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "http://api.example.com/v1/messages",
          websiteUrl: null,
        })
      ).toBe("api.example.com:80");
    });

    test("assumes https (port 443) for URL without scheme", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "api.example.com/v1/messages",
          websiteUrl: null,
        })
      ).toBe("api.example.com:443");
    });

    test("strips www prefix in host:port mode", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "https://www.example.com:8080/v1/messages",
          websiteUrl: null,
        })
      ).toBe("example.com:8080");
    });

    test("lowercases hostname in host:port mode", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "https://API.EXAMPLE.COM:8080/v1/messages",
          websiteUrl: null,
        })
      ).toBe("api.example.com:8080");
    });

    test("handles localhost with port", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "http://localhost:3000/v1/messages",
          websiteUrl: null,
        })
      ).toBe("localhost:3000");
    });

    test("handles localhost without explicit port", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "http://localhost/v1/messages",
          websiteUrl: null,
        })
      ).toBe("localhost:80");
    });
  });

  describe("IPv6 addresses", () => {
    test("formats IPv6 with brackets and port", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "http://[::1]:8080/v1/messages",
          websiteUrl: null,
        })
      ).toBe("[::1]:8080");
    });

    test("handles IPv6 without explicit port", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "https://[::1]/v1/messages",
          websiteUrl: null,
        })
      ).toBe("[::1]:443");
    });

    test("handles full IPv6 address", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "http://[2001:db8::1]:9000/v1/messages",
          websiteUrl: null,
        })
      ).toBe("[2001:db8::1]:9000");
    });
  });

  describe("edge cases", () => {
    test("returns null for empty providerUrl", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "",
          websiteUrl: null,
        })
      ).toBeNull();
    });

    test("returns null for whitespace-only providerUrl", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "   ",
          websiteUrl: null,
        })
      ).toBeNull();
    });

    test("uses providerUrl when websiteUrl is empty string", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "http://192.168.1.1:8080/v1/messages",
          websiteUrl: "",
        })
      ).toBe("192.168.1.1:8080");
    });

    test("uses providerUrl when websiteUrl is whitespace", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "http://192.168.1.1:8080/v1/messages",
          websiteUrl: "   ",
        })
      ).toBe("192.168.1.1:8080");
    });

    test("returns null for truly invalid URL", async () => {
      expect(
        await computeVendorKey({
          providerUrl: "://invalid",
          websiteUrl: null,
        })
      ).toBeNull();
    });
  });
});
