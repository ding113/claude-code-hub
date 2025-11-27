import { describe, it, expect } from "bun:test";
import { HeaderProcessor } from "@/app/v1/_lib/headers";

describe("HeaderProcessor", () => {
  describe("preserveForwardingHeaders", () => {
    it("should remove IP headers when preserveForwardingHeaders=false (default)", () => {
      const processor = new HeaderProcessor({
        preserveForwardingHeaders: false,
      });

      const headers = new Headers({
        "x-forwarded-for": "1.2.3.4",
        "x-real-ip": "5.6.7.8",
        "cf-connecting-ip": "9.10.11.12",
        "content-type": "application/json",
        authorization: "Bearer test-token",
      });

      const processed = processor.process(headers);

      // IP headers should be removed
      expect(processed.has("x-forwarded-for")).toBe(false);
      expect(processed.has("x-real-ip")).toBe(false);
      expect(processed.has("cf-connecting-ip")).toBe(false);

      // Non-IP headers should be preserved
      expect(processed.has("content-type")).toBe(true);
      expect(processed.get("content-type")).toBe("application/json");

      // Authorization should be removed by default
      expect(processed.has("authorization")).toBe(false);
    });

    it("should preserve IP headers when preserveForwardingHeaders=true", () => {
      const processor = new HeaderProcessor({
        preserveForwardingHeaders: true,
      });

      const headers = new Headers({
        "x-forwarded-for": "1.2.3.4",
        "x-real-ip": "5.6.7.8",
        "cf-connecting-ip": "9.10.11.12",
        "true-client-ip": "13.14.15.16",
        "content-type": "application/json",
      });

      const processed = processor.process(headers);

      // All IP headers should be preserved
      expect(processed.get("x-forwarded-for")).toBe("1.2.3.4");
      expect(processed.get("x-real-ip")).toBe("5.6.7.8");
      expect(processed.get("cf-connecting-ip")).toBe("9.10.11.12");
      expect(processed.get("true-client-ip")).toBe("13.14.15.16");

      // Non-IP headers should also be preserved
      expect(processed.get("content-type")).toBe("application/json");
    });

    it("should always remove non-IP forwarding headers regardless of preserveForwardingHeaders", () => {
      const processor = new HeaderProcessor({
        preserveForwardingHeaders: true,
      });

      const headers = new Headers({
        "x-forwarded-for": "1.2.3.4", // IP header - should be preserved
        "x-forwarded-host": "example.com", // Non-IP header - should be removed
        "x-forwarded-port": "443", // Non-IP header - should be removed
        "x-forwarded-proto": "https", // Non-IP header - should be removed
        "x-request-id": "abc123", // Trace header - should be removed
      });

      const processed = processor.process(headers);

      // IP header should be preserved
      expect(processed.get("x-forwarded-for")).toBe("1.2.3.4");

      // Non-IP headers should be removed
      expect(processed.has("x-forwarded-host")).toBe(false);
      expect(processed.has("x-forwarded-port")).toBe(false);
      expect(processed.has("x-forwarded-proto")).toBe(false);
      expect(processed.has("x-request-id")).toBe(false);
    });

    it("should handle CDN-specific headers correctly", () => {
      const processor = new HeaderProcessor({
        preserveForwardingHeaders: true,
      });

      const headers = new Headers({
        "cf-connecting-ip": "1.2.3.4",
        "cf-ipcountry": "US",
        "cf-ray": "abc123",
        "x-azure-clientip": "5.6.7.8",
        "fastly-client-ip": "9.10.11.12",
      });

      const processed = processor.process(headers);

      // All CDN IP headers should be preserved
      expect(processed.get("cf-connecting-ip")).toBe("1.2.3.4");
      expect(processed.get("cf-ipcountry")).toBe("US");
      expect(processed.get("cf-ray")).toBe("abc123");
      expect(processed.get("x-azure-clientip")).toBe("5.6.7.8");
      expect(processed.get("fastly-client-ip")).toBe("9.10.11.12");
    });

    it("should be case-insensitive for header names", () => {
      const processor = new HeaderProcessor({
        preserveForwardingHeaders: false,
      });

      const headers = new Headers({
        "X-Forwarded-For": "1.2.3.4",
        "X-REAL-IP": "5.6.7.8",
        "CF-Connecting-IP": "9.10.11.12",
      });

      const processed = processor.process(headers);

      // All should be removed regardless of case
      expect(processed.has("x-forwarded-for")).toBe(false);
      expect(processed.has("X-Forwarded-For")).toBe(false);
      expect(processed.has("x-real-ip")).toBe(false);
      expect(processed.has("cf-connecting-ip")).toBe(false);
    });
  });

  describe("createForProxy", () => {
    it("should create processor with default proxy settings", () => {
      const processor = HeaderProcessor.createForProxy();

      const headers = new Headers({
        "x-forwarded-for": "1.2.3.4",
        authorization: "Bearer test",
        "content-type": "application/json",
      });

      const processed = processor.process(headers);

      // IP headers should be removed by default
      expect(processed.has("x-forwarded-for")).toBe(false);
      // Authorization should be removed by default
      expect(processed.has("authorization")).toBe(false);
      // Content-type should be preserved
      expect(processed.has("content-type")).toBe(true);
    });

    it("should respect preserveForwardingHeaders in createForProxy", () => {
      const processor = HeaderProcessor.createForProxy({
        preserveForwardingHeaders: true,
      });

      const headers = new Headers({
        "x-forwarded-for": "1.2.3.4",
        "content-type": "application/json",
      });

      const processed = processor.process(headers);

      // IP headers should be preserved
      expect(processed.get("x-forwarded-for")).toBe("1.2.3.4");
      expect(processed.get("content-type")).toBe("application/json");
    });
  });

  describe("overrides", () => {
    it("should apply header overrides", () => {
      const processor = new HeaderProcessor({
        overrides: {
          host: "api.example.com",
          "x-api-key": "new-key",
        },
      });

      const headers = new Headers({
        host: "old-host.com",
        "content-type": "application/json",
      });

      const processed = processor.process(headers);

      // Overrides should be applied
      expect(processed.get("host")).toBe("api.example.com");
      expect(processed.get("x-api-key")).toBe("new-key");
      // Original headers should be preserved
      expect(processed.get("content-type")).toBe("application/json");
    });
  });

  describe("blacklist", () => {
    it("should respect custom blacklist", () => {
      const processor = new HeaderProcessor({
        blacklist: ["x-custom-header"],
        preserveForwardingHeaders: true, // Preserve IP headers
      });

      const headers = new Headers({
        "x-custom-header": "value",
        "x-forwarded-for": "1.2.3.4",
        "content-type": "application/json",
      });

      const processed = processor.process(headers);

      // Custom blacklist should be applied
      expect(processed.has("x-custom-header")).toBe(false);
      // IP headers should be preserved
      expect(processed.get("x-forwarded-for")).toBe("1.2.3.4");
      // Other headers should be preserved
      expect(processed.get("content-type")).toBe("application/json");
    });
  });
});
