import { describe, expect, test } from "vitest";
import {
  detectProviderType,
  extractApiKey,
  extractProviderName,
  extractUrl,
  generateRandomSuffix,
  isValidApiKeyFormat,
  parseProviderText,
} from "@/lib/utils/provider-text-parser";

describe("provider-text-parser", () => {
  describe("detectProviderType", () => {
    test("should detect claude type keywords", () => {
      expect(detectProviderType("https://api.anthropic.com/v1/messages")).toBe("claude");
      expect(detectProviderType("Claude API Key")).toBe("claude");
      expect(detectProviderType("anthropic")).toBe("claude");
    });

    test("should detect codex type keywords", () => {
      expect(detectProviderType("https://api.openai.com/v1/responses")).toBe("codex");
      expect(detectProviderType("GPT-4 API")).toBe("codex");
      expect(detectProviderType("codex endpoint")).toBe("codex");
    });

    test("should detect gemini type keywords", () => {
      expect(detectProviderType("https://generativelanguage.googleapis.com/v1beta")).toBe("gemini");
      expect(detectProviderType("Vertex AI")).toBe("gemini");
      expect(detectProviderType("google gemini")).toBe("gemini");
    });

    test("should detect openai-compatible type keywords", () => {
      expect(detectProviderType("/v1/chat/completions")).toBe("openai-compatible");
      expect(detectProviderType("OpenAI Compatible")).toBe("openai-compatible");
    });

    test("should return default type claude for unmatched text", () => {
      expect(detectProviderType("random text")).toBe("claude");
      expect(detectProviderType("")).toBe("claude");
    });
  });

  describe("extractUrl", () => {
    test("should extract valid URL", () => {
      expect(extractUrl("URL: https://api.example.com/v1/messages")).toBe(
        "https://api.example.com/v1/messages"
      );
    });

    test("should extract HTTP URL", () => {
      expect(extractUrl("endpoint: http://localhost:8080/v1/messages")).toBe(
        "http://localhost:8080/v1/messages"
      );
    });

    test("should remove trailing punctuation", () => {
      expect(extractUrl("Check https://api.test.com/v1.")).toBe("https://api.test.com/v1");
      expect(extractUrl("URL: https://api.test.com/v1,")).toBe("https://api.test.com/v1");
    });

    test("should handle multiple trailing punctuation", () => {
      expect(extractUrl("URL: https://api.test.com/v1...")).toBe("https://api.test.com/v1");
      expect(extractUrl("(https://api.test.com/v1)")).toBe("https://api.test.com/v1");
    });

    test("should return null for text without URL", () => {
      expect(extractUrl("no url here")).toBeNull();
    });

    test("should prioritize API URL", () => {
      const text = "Website: https://example.com, API: https://api.example.com/v1/messages";
      expect(extractUrl(text)).toBe("https://api.example.com/v1/messages");
    });

    test("should fallback to first valid URL when no API indicators", () => {
      expect(extractUrl("site: https://example.com and https://test.com")).toBe(
        "https://example.com"
      );
    });

    test("should handle URL with query parameters", () => {
      const url = "https://api.example.com/v1/messages?key=value";
      expect(extractUrl(`URL: ${url}`)).toBe(url);
    });
  });

  describe("extractApiKey", () => {
    test("should extract OpenAI format key", () => {
      const key = "sk-1234567890abcdefghij1234567890ab";
      expect(extractApiKey(`key: ${key}`)).toBe(key);
    });

    test("should extract Anthropic format key", () => {
      const key = "sk-ant-abcdef1234567890ghijklmnopqrstuvwxyz";
      expect(extractApiKey(`key: ${key}`)).toBe(key);
    });

    test("should extract Google format key", () => {
      const key = "AIzaSyAbcdefghijklmnopqrstuvwxyz123456";
      expect(extractApiKey(`key: ${key}`)).toBe(key);
    });

    test("should return null for text without key", () => {
      expect(extractApiKey("no key")).toBeNull();
      expect(extractApiKey("short")).toBeNull();
    });

    test("should extract generic long key", () => {
      const key = "abcdefghijklmnopqrstuvwxyz123456";
      expect(extractApiKey(`api_key: ${key}`)).toBe(key);
    });
  });

  describe("extractProviderName", () => {
    test("should extract name from name: format", () => {
      expect(extractProviderName("name: MyProvider")).toBe("MyProvider");
      expect(extractProviderName("Name: TestAPI")).toBe("TestAPI");
    });

    test("should extract name from provider: format", () => {
      expect(extractProviderName("provider: TestAPI")).toBe("TestAPI");
    });

    test("should extract name from service: format", () => {
      expect(extractProviderName("service: MyService")).toBe("MyService");
    });

    test("should return null for text without name", () => {
      expect(extractProviderName("https://api.test.com")).toBeNull();
    });

    test("should not extract URL as name", () => {
      expect(extractProviderName("https://api.test.com/v1")).toBeNull();
    });

    test("should not extract API key as name", () => {
      expect(extractProviderName("sk-1234567890abcdefghij")).toBeNull();
    });

    test("should reject names with 2 or fewer characters", () => {
      expect(extractProviderName("name: AB")).toBe("name");
    });

    test("should accept names with exactly 3 characters", () => {
      expect(extractProviderName("provider: ABC")).toBe("ABC");
    });

    test("should accept names up to 60 characters", () => {
      const name60 = "A".repeat(60);
      expect(extractProviderName(`provider: ${name60}`)).toBe(name60);
    });

    test("should fallback to label when value exceeds 60 characters", () => {
      const name61 = "A".repeat(61);
      expect(extractProviderName(`name: ${name61}`)).toBe("name");
    });
  });

  describe("generateRandomSuffix", () => {
    test("should generate 4 character string", () => {
      const suffix = generateRandomSuffix();
      expect(suffix).toHaveLength(4);
      expect(/^[a-z0-9]+$/.test(suffix)).toBe(true);
    });

    test("should generate different values", () => {
      const suffixes = new Set(Array.from({ length: 100 }, generateRandomSuffix));
      expect(suffixes.size).toBeGreaterThan(90);
    });
  });

  describe("isValidApiKeyFormat", () => {
    test("should return true for valid key format", () => {
      expect(isValidApiKeyFormat("sk-1234567890abcdefghij")).toBe(true);
      expect(isValidApiKeyFormat("abcdefghijklmnopqrstuvwxyz123456")).toBe(true);
    });

    test("should return false for short key", () => {
      expect(isValidApiKeyFormat("short")).toBe(false);
      expect(isValidApiKeyFormat("")).toBe(false);
    });

    test("should return false for key with special characters", () => {
      expect(isValidApiKeyFormat("sk-test@key#invalid!")).toBe(false);
    });

    test("should return false for key with exactly 19 characters", () => {
      expect(isValidApiKeyFormat("a".repeat(19))).toBe(false);
    });

    test("should return true for key with exactly 20 characters", () => {
      expect(isValidApiKeyFormat("a".repeat(20))).toBe(true);
    });

    test("should accept keys with underscores and hyphens", () => {
      expect(isValidApiKeyFormat("sk_test-key_12345678901234")).toBe(true);
    });
  });

  describe("parseProviderText", () => {
    test("should parse complete configuration text", () => {
      const text = `
        name: Privnode
        URL: https://api.privnode.com/v1/messages
        API Key: sk-ant-1234567890abcdefghijklmnopqrstuvwxyz
      `;
      const result = parseProviderText(text);

      expect(result.name).toBe("Privnode");
      expect(result.url).toBe("https://api.privnode.com/v1/messages");
      expect(result.key).toMatch(/^sk-ant-/);
      expect(result.providerType).toBe("claude");
      expect(result.confidence.name).toBe(true);
      expect(result.confidence.url).toBe(true);
      expect(result.confidence.key).toBe(true);
    });

    test("should handle minimal input", () => {
      const result = parseProviderText("https://api.openai.com/v1/responses");
      expect(result.url).toBeTruthy();
      expect(result.providerType).toBe("codex");
    });

    test("should handle empty input", () => {
      const result = parseProviderText("");
      expect(result.name).toBeNull();
      expect(result.url).toBeNull();
      expect(result.key).toBeNull();
      expect(result.providerType).toBe("claude");
    });

    test("should set confidence.type to true for non-claude providers", () => {
      const result = parseProviderText("https://api.openai.com/v1/responses");
      expect(result.confidence.type).toBe(true);
    });

    test("should set confidence.type to false for claude provider", () => {
      const result = parseProviderText("anthropic API");
      expect(result.confidence.type).toBe(false);
    });
  });
});
