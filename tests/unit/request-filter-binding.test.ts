import { beforeEach, describe, expect, test } from "vitest";
import { requestFilterEngine } from "@/lib/request-filter-engine";
import type { RequestFilter } from "@/repository/request-filters";

// =============================================================================
// Helper Functions
// =============================================================================

let filterId = 0;

function createFilter(overrides: Partial<RequestFilter>): RequestFilter {
  return {
    id: ++filterId,
    name: `test-filter-${filterId}`,
    description: null,
    scope: "header",
    action: "set",
    matchType: null,
    target: "x-test",
    replacement: "test-value",
    priority: 0,
    isEnabled: true,
    bindingType: "global",
    providerIds: null,
    groupTags: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createGlobalFilter(
  scope: "header" | "body",
  action: "remove" | "set" | "json_path" | "text_replace",
  target: string,
  replacement: unknown,
  priority = 0,
  matchType: "contains" | "exact" | "regex" | null = null
): RequestFilter {
  return createFilter({
    scope,
    action,
    target,
    replacement,
    priority,
    matchType,
    bindingType: "global",
  });
}

function createProviderFilter(
  providerIds: number[],
  scope: "header" | "body",
  action: "remove" | "set" | "json_path" | "text_replace",
  target: string,
  replacement: unknown,
  priority = 0,
  matchType: "contains" | "exact" | "regex" | null = null
): RequestFilter {
  return createFilter({
    scope,
    action,
    target,
    replacement,
    priority,
    matchType,
    bindingType: "providers",
    providerIds,
  });
}

function createGroupFilter(
  groupTags: string[],
  scope: "header" | "body",
  action: "remove" | "set" | "json_path" | "text_replace",
  target: string,
  replacement: unknown,
  priority = 0,
  matchType: "contains" | "exact" | "regex" | null = null
): RequestFilter {
  return createFilter({
    scope,
    action,
    target,
    replacement,
    priority,
    matchType,
    bindingType: "groups",
    groupTags,
  });
}

interface MockSession {
  headers: Headers;
  request: {
    message: Record<string, unknown>;
    log: string;
    model: string;
  };
  provider?: {
    id: number;
    groupTag: string | null;
  };
}

function createSession(): MockSession {
  return {
    headers: new Headers({
      "user-agent": "test-ua",
      "x-remove": "value-to-remove",
      "x-keep": "keep-this",
    }),
    request: {
      message: {
        text: "hello world secret data",
        nested: { secret: "abc123", keep: "preserved" },
        items: ["item1", "item2"],
      },
      log: "",
      model: "claude-3",
    },
  };
}

function createSessionWithProvider(
  providerId: number,
  groupTag: string | null = null
): MockSession {
  const session = createSession();
  session.provider = { id: providerId, groupTag };
  return session;
}

// =============================================================================
// Tests
// =============================================================================

describe("Request Filter Engine - Binding Types", () => {
  beforeEach(() => {
    filterId = 0;
    requestFilterEngine.setFiltersForTest([]);
  });

  // ===========================================================================
  // 1. Global filters (applyGlobal) - 7 tests
  // ===========================================================================
  describe("Global filters (applyGlobal)", () => {
    test("should apply global header filter (remove)", async () => {
      const filter = createGlobalFilter("header", "remove", "x-remove", null);
      requestFilterEngine.setFiltersForTest([filter]);

      const session = createSession();
      expect(session.headers.has("x-remove")).toBe(true);

      await requestFilterEngine.applyGlobal(
        session as Parameters<typeof requestFilterEngine.applyGlobal>[0]
      );

      expect(session.headers.has("x-remove")).toBe(false);
      expect(session.headers.get("x-keep")).toBe("keep-this");
    });

    test("should apply global header filter (set)", async () => {
      const filter = createGlobalFilter("header", "set", "x-custom", "custom-value");
      requestFilterEngine.setFiltersForTest([filter]);

      const session = createSession();
      expect(session.headers.has("x-custom")).toBe(false);

      await requestFilterEngine.applyGlobal(
        session as Parameters<typeof requestFilterEngine.applyGlobal>[0]
      );

      expect(session.headers.get("x-custom")).toBe("custom-value");
    });

    test("should apply global body filter (json_path)", async () => {
      const filter = createGlobalFilter("body", "json_path", "nested.secret", "***REDACTED***");
      requestFilterEngine.setFiltersForTest([filter]);

      const session = createSession();
      expect(
        (session.request.message as Record<string, Record<string, string>>).nested.secret
      ).toBe("abc123");

      await requestFilterEngine.applyGlobal(
        session as Parameters<typeof requestFilterEngine.applyGlobal>[0]
      );

      expect(
        (session.request.message as Record<string, Record<string, string>>).nested.secret
      ).toBe("***REDACTED***");
      expect((session.request.message as Record<string, Record<string, string>>).nested.keep).toBe(
        "preserved"
      );
    });

    test("should apply global body filter (text_replace with contains)", async () => {
      const filter = createGlobalFilter(
        "body",
        "text_replace",
        "secret",
        "[HIDDEN]",
        0,
        "contains"
      );
      requestFilterEngine.setFiltersForTest([filter]);

      const session = createSession();

      await requestFilterEngine.applyGlobal(
        session as Parameters<typeof requestFilterEngine.applyGlobal>[0]
      );

      expect((session.request.message as Record<string, string>).text).toBe(
        "hello world [HIDDEN] data"
      );
    });

    test("should apply global body filter (text_replace with regex)", async () => {
      const filter = createGlobalFilter("body", "text_replace", "\\d+", "[NUM]", 0, "regex");
      requestFilterEngine.setFiltersForTest([filter]);

      const session = createSession();

      await requestFilterEngine.applyGlobal(
        session as Parameters<typeof requestFilterEngine.applyGlobal>[0]
      );

      expect(
        (session.request.message as Record<string, Record<string, string>>).nested.secret
      ).toBe("abc[NUM]");
    });

    test("should apply multiple global filters in priority order", async () => {
      // Filters are sorted by priority (ascending), last one wins
      const filters = [
        createGlobalFilter("header", "set", "x-order", "first", 0),
        createGlobalFilter("header", "set", "x-order", "second", 1),
        createGlobalFilter("header", "set", "x-order", "third", 2),
      ];
      requestFilterEngine.setFiltersForTest(filters);

      const session = createSession();

      await requestFilterEngine.applyGlobal(
        session as Parameters<typeof requestFilterEngine.applyGlobal>[0]
      );

      // Applied in priority order: 0 -> 1 -> 2, last one (priority 2) wins
      expect(session.headers.get("x-order")).toBe("third");
    });

    test("should not fail on empty filters", async () => {
      requestFilterEngine.setFiltersForTest([]);

      const session = createSession();
      const originalHeaders = new Headers(session.headers);

      await expect(
        requestFilterEngine.applyGlobal(
          session as Parameters<typeof requestFilterEngine.applyGlobal>[0]
        )
      ).resolves.toBeUndefined();

      expect(session.headers.get("user-agent")).toBe(originalHeaders.get("user-agent"));
    });
  });

  // ===========================================================================
  // 2. Provider-specific filters (bindingType="providers") - 6 tests
  // ===========================================================================
  describe("Provider-specific filters (bindingType=providers)", () => {
    test("should apply filter when providerId matches single ID", async () => {
      const filter = createProviderFilter([1], "header", "set", "x-provider", "matched");
      requestFilterEngine.setFiltersForTest([filter]);

      const session = createSessionWithProvider(1);

      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );

      expect(session.headers.get("x-provider")).toBe("matched");
    });

    test("should apply filter when providerId matches one of multiple IDs", async () => {
      const filter = createProviderFilter([1, 2, 3], "header", "set", "x-provider", "matched");
      requestFilterEngine.setFiltersForTest([filter]);

      const session = createSessionWithProvider(2);

      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );

      expect(session.headers.get("x-provider")).toBe("matched");
    });

    test("should NOT apply filter when providerId not in list", async () => {
      const filter = createProviderFilter([1, 2, 3], "header", "set", "x-provider", "matched");
      requestFilterEngine.setFiltersForTest([filter]);

      const session = createSessionWithProvider(99);

      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );

      expect(session.headers.has("x-provider")).toBe(false);
    });

    test("should apply header and body filters for matching provider", async () => {
      const filters = [
        createProviderFilter([5], "header", "set", "x-auth", "bearer-token"),
        createProviderFilter([5], "body", "json_path", "metadata.provider", "provider-5"),
      ];
      requestFilterEngine.setFiltersForTest(filters);

      const session = createSessionWithProvider(5);

      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );

      expect(session.headers.get("x-auth")).toBe("bearer-token");
      expect(
        (session.request.message as Record<string, Record<string, string>>).metadata.provider
      ).toBe("provider-5");
    });

    test("should handle multiple provider filters with different priorities", async () => {
      // Filters are sorted by priority (ascending), last one wins
      const filters = [
        createProviderFilter([1], "header", "set", "x-priority", "high", 1),
        createProviderFilter([1], "header", "set", "x-priority", "low", 10),
      ];
      requestFilterEngine.setFiltersForTest(filters);

      const session = createSessionWithProvider(1);

      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );

      // Applied in priority order: 1 -> 10, last one (priority 10) wins
      expect(session.headers.get("x-priority")).toBe("low");
    });

    test("should skip provider filter with empty providerIds array", async () => {
      const filter = createProviderFilter([], "header", "set", "x-empty", "should-not-apply");
      requestFilterEngine.setFiltersForTest([filter]);

      const session = createSessionWithProvider(1);

      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );

      expect(session.headers.has("x-empty")).toBe(false);
    });
  });

  // ===========================================================================
  // 3. Group-specific filters (bindingType="groups") - 7 tests
  // ===========================================================================
  describe("Group-specific filters (bindingType=groups)", () => {
    test("should apply filter when provider groupTag matches exactly", async () => {
      const filter = createGroupFilter(["premium"], "header", "set", "x-tier", "premium-tier");
      requestFilterEngine.setFiltersForTest([filter]);

      const session = createSessionWithProvider(1, "premium");

      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );

      expect(session.headers.get("x-tier")).toBe("premium-tier");
    });

    test("should apply filter when provider has comma-separated tags and one matches", async () => {
      const filter = createGroupFilter(["vip"], "header", "set", "x-vip", "true");
      requestFilterEngine.setFiltersForTest([filter]);

      // Provider has multiple tags: "basic, vip, beta"
      const session = createSessionWithProvider(1, "basic, vip, beta");

      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );

      expect(session.headers.get("x-vip")).toBe("true");
    });

    test("should apply filter when filter has multiple groupTags and one matches", async () => {
      const filter = createGroupFilter(
        ["gold", "silver", "bronze"],
        "header",
        "set",
        "x-medal",
        "awarded"
      );
      requestFilterEngine.setFiltersForTest([filter]);

      const session = createSessionWithProvider(1, "silver");

      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );

      expect(session.headers.get("x-medal")).toBe("awarded");
    });

    test("should NOT apply filter when no tag match", async () => {
      const filter = createGroupFilter(["premium", "vip"], "header", "set", "x-special", "yes");
      requestFilterEngine.setFiltersForTest([filter]);

      const session = createSessionWithProvider(1, "basic");

      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );

      expect(session.headers.has("x-special")).toBe(false);
    });

    test("should NOT apply filter when provider has no groupTag (null)", async () => {
      const filter = createGroupFilter(["any-tag"], "header", "set", "x-null", "applied");
      requestFilterEngine.setFiltersForTest([filter]);

      const session = createSessionWithProvider(1, null);

      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );

      expect(session.headers.has("x-null")).toBe(false);
    });

    test("should NOT apply filter when provider has empty groupTag", async () => {
      const filter = createGroupFilter(["tag"], "header", "set", "x-empty-tag", "applied");
      requestFilterEngine.setFiltersForTest([filter]);

      const session = createSessionWithProvider(1, "");

      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );

      expect(session.headers.has("x-empty-tag")).toBe(false);
    });

    test("should skip group filter with empty groupTags array", async () => {
      const filter = createGroupFilter([], "header", "set", "x-no-tags", "applied");
      requestFilterEngine.setFiltersForTest([filter]);

      const session = createSessionWithProvider(1, "any-tag");

      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );

      expect(session.headers.has("x-no-tags")).toBe(false);
    });
  });

  // ===========================================================================
  // 4. Combined filters (global + provider/group) - 4 tests
  // ===========================================================================
  describe("Combined filters (global + provider/group)", () => {
    test("should apply both global and provider filters in sequence", async () => {
      const filters = [
        createGlobalFilter("header", "set", "x-global", "global-value"),
        createProviderFilter([1], "header", "set", "x-provider", "provider-value"),
      ];
      requestFilterEngine.setFiltersForTest(filters);

      const session = createSessionWithProvider(1);

      // First apply global
      await requestFilterEngine.applyGlobal(
        session as Parameters<typeof requestFilterEngine.applyGlobal>[0]
      );
      expect(session.headers.get("x-global")).toBe("global-value");
      expect(session.headers.has("x-provider")).toBe(false);

      // Then apply provider-specific
      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );
      expect(session.headers.get("x-global")).toBe("global-value");
      expect(session.headers.get("x-provider")).toBe("provider-value");
    });

    test("should apply both global and group filters in sequence", async () => {
      const filters = [
        createGlobalFilter("header", "set", "x-global", "from-global"),
        createGroupFilter(["enterprise"], "header", "set", "x-enterprise", "enterprise-tier"),
      ];
      requestFilterEngine.setFiltersForTest(filters);

      const session = createSessionWithProvider(1, "enterprise");

      await requestFilterEngine.applyGlobal(
        session as Parameters<typeof requestFilterEngine.applyGlobal>[0]
      );
      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );

      expect(session.headers.get("x-global")).toBe("from-global");
      expect(session.headers.get("x-enterprise")).toBe("enterprise-tier");
    });

    test("should maintain priority order within each category", async () => {
      const filters = [
        createGlobalFilter("header", "set", "x-seq", "g1", 0),
        createGlobalFilter("header", "set", "x-seq", "g2", 1),
        createProviderFilter([1], "header", "set", "x-seq", "p1", 0),
        createProviderFilter([1], "header", "set", "x-seq", "p2", 1),
      ];
      requestFilterEngine.setFiltersForTest(filters);

      const session = createSessionWithProvider(1);

      await requestFilterEngine.applyGlobal(
        session as Parameters<typeof requestFilterEngine.applyGlobal>[0]
      );
      // After global: g1 -> g2, result is "g2"
      expect(session.headers.get("x-seq")).toBe("g2");

      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );
      // After provider: p1 -> p2, result is "p2"
      expect(session.headers.get("x-seq")).toBe("p2");
    });

    test("should handle all three binding types together", async () => {
      const filters = [
        createGlobalFilter("header", "set", "x-binding", "global"),
        createProviderFilter([1, 2], "header", "set", "x-binding", "provider"),
        createGroupFilter(["vip"], "header", "set", "x-binding", "group"),
      ];
      requestFilterEngine.setFiltersForTest(filters);

      // Session with provider ID 1 and group tag "vip"
      const session = createSessionWithProvider(1, "vip");

      await requestFilterEngine.applyGlobal(
        session as Parameters<typeof requestFilterEngine.applyGlobal>[0]
      );
      expect(session.headers.get("x-binding")).toBe("global");

      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );
      // Both provider and group filters match, applied in order: provider -> group
      expect(session.headers.get("x-binding")).toBe("group");
    });
  });

  // ===========================================================================
  // 5. Edge cases - 4 tests
  // ===========================================================================
  describe("Edge cases", () => {
    test("should return early from applyForProvider when no provider", async () => {
      const filter = createProviderFilter([1], "header", "set", "x-edge", "value");
      requestFilterEngine.setFiltersForTest([filter]);

      const session = createSession(); // No provider

      await expect(
        requestFilterEngine.applyForProvider(
          session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
        )
      ).resolves.toBeUndefined();

      expect(session.headers.has("x-edge")).toBe(false);
    });

    test("should handle filter with null providerIds (treated as no match)", async () => {
      const filter = createFilter({
        bindingType: "providers",
        providerIds: null,
        scope: "header",
        action: "set",
        target: "x-null-ids",
        replacement: "value",
      });
      requestFilterEngine.setFiltersForTest([filter]);

      const session = createSessionWithProvider(1);

      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );

      expect(session.headers.has("x-null-ids")).toBe(false);
    });

    test("should handle filter with null groupTags (treated as no match)", async () => {
      const filter = createFilter({
        bindingType: "groups",
        groupTags: null,
        scope: "header",
        action: "set",
        target: "x-null-tags",
        replacement: "value",
      });
      requestFilterEngine.setFiltersForTest([filter]);

      const session = createSessionWithProvider(1, "some-tag");

      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );

      expect(session.headers.has("x-null-tags")).toBe(false);
    });

    test("should handle regex filter with provider binding", async () => {
      const filter = createProviderFilter(
        [10],
        "body",
        "text_replace",
        "secret",
        "[FILTERED]",
        0,
        "contains"
      );
      requestFilterEngine.setFiltersForTest([filter]);

      const session = createSessionWithProvider(10);

      await requestFilterEngine.applyForProvider(
        session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
      );

      expect((session.request.message as Record<string, string>).text).toBe(
        "hello world [FILTERED] data"
      );
    });
  });
});
