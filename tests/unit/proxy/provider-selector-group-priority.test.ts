import { describe, expect, test } from "vitest";
import { getEffectivePriority } from "@/app/v1/_lib/proxy/provider-selector";
import type { Provider } from "@/types/provider";

// Helper to create a minimal Provider for testing
function createProvider(
  priority: number,
  groupPriorities: Record<string, number> | null = null
): Provider {
  return {
    id: 1,
    name: "test-provider",
    providerType: "claude",
    url: "https://api.anthropic.com",
    apiKey: "test-key",
    enabled: true,
    priority,
    weight: 1,
    costMultiplier: 1,
    groupTag: null,
    allowedModels: null,
    modelRedirects: null,
    joinClaudePool: false,
    groupPriorities,
    providerVendorId: null,
    limitTotalUsd: null,
    usedTotalUsd: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("getEffectivePriority - Group-level priority override", () => {
  describe("When user has no group", () => {
    test("should return default priority when userGroup is null", () => {
      const provider = createProvider(5, { cli: 1, chat: 3 });
      expect(getEffectivePriority(provider, null)).toBe(5);
    });

    test("should return default priority when userGroup is empty string", () => {
      const provider = createProvider(5, { cli: 1 });
      expect(getEffectivePriority(provider, "")).toBe(5);
    });
  });

  describe("When provider has no group overrides", () => {
    test("should return default priority when groupPriorities is null", () => {
      const provider = createProvider(5, null);
      expect(getEffectivePriority(provider, "cli")).toBe(5);
    });

    test("should return default priority when groupPriorities is empty", () => {
      const provider = createProvider(5, {});
      expect(getEffectivePriority(provider, "cli")).toBe(5);
    });
  });

  describe("When user group matches override", () => {
    test("should return group-specific priority when user group matches", () => {
      const provider = createProvider(5, { cli: 1, chat: 3 });
      expect(getEffectivePriority(provider, "cli")).toBe(1);
      expect(getEffectivePriority(provider, "chat")).toBe(3);
    });

    test("should return first matching group priority for comma-separated groups", () => {
      const provider = createProvider(5, { cli: 1, chat: 3 });
      // First match wins: "chat" comes first, so priority 3 is returned
      expect(getEffectivePriority(provider, "chat,cli")).toBe(3);
      // First match wins: "cli" comes first, so priority 1 is returned
      expect(getEffectivePriority(provider, "cli,chat")).toBe(1);
    });

    test("should handle whitespace in comma-separated groups", () => {
      const provider = createProvider(5, { cli: 1 });
      expect(getEffectivePriority(provider, " cli , chat ")).toBe(1);
    });
  });

  describe("When user group does not match any override", () => {
    test("should return default priority when no group override exists", () => {
      const provider = createProvider(5, { cli: 1 });
      expect(getEffectivePriority(provider, "web")).toBe(5);
    });

    test("should return default priority when none of comma-separated groups match", () => {
      const provider = createProvider(5, { cli: 1 });
      expect(getEffectivePriority(provider, "web,mobile")).toBe(5);
    });
  });

  describe("Edge cases", () => {
    test("should handle priority value of 0", () => {
      const provider = createProvider(5, { cli: 0 });
      expect(getEffectivePriority(provider, "cli")).toBe(0);
    });

    test("should handle very high priority values", () => {
      const provider = createProvider(5, { cli: 2147483647 });
      expect(getEffectivePriority(provider, "cli")).toBe(2147483647);
    });

    test("should be case-sensitive for group names", () => {
      const provider = createProvider(5, { CLI: 1 });
      expect(getEffectivePriority(provider, "cli")).toBe(5); // No match, returns default
      expect(getEffectivePriority(provider, "CLI")).toBe(1); // Exact match
    });
  });
});
