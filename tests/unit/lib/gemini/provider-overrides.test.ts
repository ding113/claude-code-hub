import { describe, expect, test } from "vitest";
import {
  applyGeminiGoogleSearchOverride,
  applyGeminiGoogleSearchOverrideWithAudit,
} from "@/lib/gemini/provider-overrides";

describe("applyGeminiGoogleSearchOverride", () => {
  describe("non-Gemini providers", () => {
    test("should return unchanged request for claude provider", () => {
      const provider = { providerType: "claude" };
      const request = { tools: [{ codeExecution: {} }] };

      const result = applyGeminiGoogleSearchOverride(provider, request);

      expect(result).toBe(request);
    });

    test("should return unchanged request for codex provider", () => {
      const provider = { providerType: "codex", geminiGoogleSearchPreference: "enabled" };
      const request = { contents: [] };

      const result = applyGeminiGoogleSearchOverride(provider, request);

      expect(result).toBe(request);
    });
  });

  describe("inherit preference", () => {
    test("should pass through unchanged when preference is inherit", () => {
      const provider = { providerType: "gemini", geminiGoogleSearchPreference: "inherit" };
      const request = { contents: [], tools: [{ googleSearch: {} }] };

      const result = applyGeminiGoogleSearchOverride(provider, request);

      expect(result).toBe(request);
    });

    test("should pass through unchanged when preference is null", () => {
      const provider = { providerType: "gemini", geminiGoogleSearchPreference: null };
      const request = { contents: [] };

      const result = applyGeminiGoogleSearchOverride(provider, request);

      expect(result).toBe(request);
    });

    test("should pass through unchanged when preference is undefined", () => {
      const provider = { providerType: "gemini" };
      const request = { contents: [] };

      const result = applyGeminiGoogleSearchOverride(provider, request);

      expect(result).toBe(request);
    });
  });

  describe("enabled preference", () => {
    test("should inject googleSearch tool when not present", () => {
      const provider = { providerType: "gemini", geminiGoogleSearchPreference: "enabled" };
      const request = { contents: [] };

      const result = applyGeminiGoogleSearchOverride(provider, request);

      expect(result).not.toBe(request);
      expect(result.tools).toEqual([{ googleSearch: {} }]);
    });

    test("should inject googleSearch tool alongside existing tools", () => {
      const provider = { providerType: "gemini", geminiGoogleSearchPreference: "enabled" };
      const request = { contents: [], tools: [{ codeExecution: {} }] };

      const result = applyGeminiGoogleSearchOverride(provider, request);

      expect(result).not.toBe(request);
      expect(result.tools).toEqual([{ codeExecution: {} }, { googleSearch: {} }]);
    });

    test("should not duplicate googleSearch if already present", () => {
      const provider = { providerType: "gemini", geminiGoogleSearchPreference: "enabled" };
      const request = { contents: [], tools: [{ googleSearch: {} }] };

      const result = applyGeminiGoogleSearchOverride(provider, request);

      expect(result).toBe(request);
      expect(result.tools).toEqual([{ googleSearch: {} }]);
    });

    test("should work with gemini-cli provider type", () => {
      const provider = { providerType: "gemini-cli", geminiGoogleSearchPreference: "enabled" };
      const request = { contents: [] };

      const result = applyGeminiGoogleSearchOverride(provider, request);

      expect(result.tools).toEqual([{ googleSearch: {} }]);
    });
  });

  describe("disabled preference", () => {
    test("should remove googleSearch tool when present", () => {
      const provider = { providerType: "gemini", geminiGoogleSearchPreference: "disabled" };
      const request = { contents: [], tools: [{ googleSearch: {} }] };

      const result = applyGeminiGoogleSearchOverride(provider, request);

      expect(result).not.toBe(request);
      expect(result.tools).toBeUndefined();
    });

    test("should preserve other tools when removing googleSearch", () => {
      const provider = { providerType: "gemini", geminiGoogleSearchPreference: "disabled" };
      const request = {
        contents: [],
        tools: [{ codeExecution: {} }, { googleSearch: {} }, { functionDeclarations: [] }],
      };

      const result = applyGeminiGoogleSearchOverride(provider, request);

      expect(result).not.toBe(request);
      expect(result.tools).toEqual([{ codeExecution: {} }, { functionDeclarations: [] }]);
    });

    test("should pass through unchanged when googleSearch not present", () => {
      const provider = { providerType: "gemini", geminiGoogleSearchPreference: "disabled" };
      const request = { contents: [], tools: [{ codeExecution: {} }] };

      const result = applyGeminiGoogleSearchOverride(provider, request);

      expect(result).toBe(request);
    });

    test("should pass through unchanged when no tools array", () => {
      const provider = { providerType: "gemini", geminiGoogleSearchPreference: "disabled" };
      const request = { contents: [] };

      const result = applyGeminiGoogleSearchOverride(provider, request);

      expect(result).toBe(request);
    });
  });
});

describe("applyGeminiGoogleSearchOverrideWithAudit", () => {
  describe("non-Gemini providers", () => {
    test("should return null audit for non-Gemini provider", () => {
      const provider = { providerType: "claude", geminiGoogleSearchPreference: "enabled" };
      const request = { contents: [] };

      const { request: result, audit } = applyGeminiGoogleSearchOverrideWithAudit(
        provider,
        request
      );

      expect(result).toBe(request);
      expect(audit).toBeNull();
    });
  });

  describe("inherit preference", () => {
    test("should return null audit when preference is inherit", () => {
      const provider = {
        id: 1,
        name: "Test Gemini",
        providerType: "gemini",
        geminiGoogleSearchPreference: "inherit",
      };
      const request = { contents: [] };

      const { audit } = applyGeminiGoogleSearchOverrideWithAudit(provider, request);

      expect(audit).toBeNull();
    });
  });

  describe("enabled preference", () => {
    test("should return inject audit when googleSearch is injected", () => {
      const provider = {
        id: 1,
        name: "Test Gemini",
        providerType: "gemini",
        geminiGoogleSearchPreference: "enabled",
      };
      const request = { contents: [] };

      const { request: result, audit } = applyGeminiGoogleSearchOverrideWithAudit(
        provider,
        request
      );

      expect(result.tools).toEqual([{ googleSearch: {} }]);
      expect(audit).toEqual({
        type: "gemini_google_search_override",
        scope: "request",
        hit: true,
        providerId: 1,
        providerName: "Test Gemini",
        action: "inject",
        preference: "enabled",
        hadGoogleSearchInRequest: false,
      });
    });

    test("should return passthrough audit when googleSearch already present", () => {
      const provider = {
        id: 2,
        name: "Gemini Pro",
        providerType: "gemini",
        geminiGoogleSearchPreference: "enabled",
      };
      const request = { contents: [], tools: [{ googleSearch: {} }] };

      const { request: result, audit } = applyGeminiGoogleSearchOverrideWithAudit(
        provider,
        request
      );

      expect(result).toBe(request);
      expect(audit).toEqual({
        type: "gemini_google_search_override",
        scope: "request",
        hit: true,
        providerId: 2,
        providerName: "Gemini Pro",
        action: "passthrough",
        preference: "enabled",
        hadGoogleSearchInRequest: true,
      });
    });
  });

  describe("disabled preference", () => {
    test("should return remove audit when googleSearch is removed", () => {
      const provider = {
        id: 3,
        name: "Gemini Flash",
        providerType: "gemini",
        geminiGoogleSearchPreference: "disabled",
      };
      const request = { contents: [], tools: [{ googleSearch: {} }] };

      const { request: result, audit } = applyGeminiGoogleSearchOverrideWithAudit(
        provider,
        request
      );

      expect(result.tools).toBeUndefined();
      expect(audit).toEqual({
        type: "gemini_google_search_override",
        scope: "request",
        hit: true,
        providerId: 3,
        providerName: "Gemini Flash",
        action: "remove",
        preference: "disabled",
        hadGoogleSearchInRequest: true,
      });
    });

    test("should return passthrough audit when no googleSearch to remove", () => {
      const provider = {
        id: 4,
        providerType: "gemini-cli",
        geminiGoogleSearchPreference: "disabled",
      };
      const request = { contents: [], tools: [{ codeExecution: {} }] };

      const { request: result, audit } = applyGeminiGoogleSearchOverrideWithAudit(
        provider,
        request
      );

      expect(result).toBe(request);
      expect(audit).toEqual({
        type: "gemini_google_search_override",
        scope: "request",
        hit: true,
        providerId: 4,
        providerName: null,
        action: "passthrough",
        preference: "disabled",
        hadGoogleSearchInRequest: false,
      });
    });
  });

  describe("edge cases", () => {
    test("should handle missing provider id and name", () => {
      const provider = {
        providerType: "gemini",
        geminiGoogleSearchPreference: "enabled",
      };
      const request = { contents: [] };

      const { audit } = applyGeminiGoogleSearchOverrideWithAudit(provider, request);

      expect(audit?.providerId).toBeNull();
      expect(audit?.providerName).toBeNull();
    });

    test("should handle non-plain object tools", () => {
      const provider = {
        providerType: "gemini",
        geminiGoogleSearchPreference: "disabled",
      };
      const request = { contents: [], tools: ["string-tool", 123, null] };

      const { request: result } = applyGeminiGoogleSearchOverrideWithAudit(
        provider,
        request as unknown as Record<string, unknown>
      );

      expect(result).toBe(request);
    });

    test("should handle googleSearch with extra properties", () => {
      const provider = {
        providerType: "gemini",
        geminiGoogleSearchPreference: "disabled",
      };
      const request = {
        contents: [],
        tools: [{ googleSearch: { dynamicRetrievalConfig: { threshold: 0.5 } } }],
      };

      const { request: result } = applyGeminiGoogleSearchOverrideWithAudit(provider, request);

      expect(result.tools).toBeUndefined();
    });
  });
});
