import { beforeEach, describe, expect, test } from "vitest";
import { requestFilterEngine } from "@/lib/request-filter-engine";
import type { RequestFilter } from "@/repository/request-filters";
import type { FilterOperation } from "@/lib/request-filter-types";

// =============================================================================
// Helpers
// =============================================================================

let filterId = 0;

function createFilter(overrides: Partial<RequestFilter>): RequestFilter {
  return {
    id: ++filterId,
    name: `adv-filter-${filterId}`,
    description: null,
    scope: "body",
    action: "json_path",
    matchType: null,
    target: "",
    replacement: null,
    priority: 0,
    isEnabled: true,
    bindingType: "global",
    providerIds: null,
    groupTags: null,
    ruleMode: "simple",
    executionPhase: "guard",
    operations: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createAdvancedFilter(
  operations: FilterOperation[],
  overrides: Partial<RequestFilter> = {}
): RequestFilter {
  return createFilter({
    ruleMode: "advanced",
    executionPhase: "final",
    operations,
    ...overrides,
  });
}

// =============================================================================
// Insert Operations
// =============================================================================

describe("Advanced Mode - Insert Operations", () => {
  beforeEach(() => {
    filterId = 0;
    requestFilterEngine.setFiltersForTest([]);
  });

  test("insert at end (default): appends to array", async () => {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: "hello" }],
    };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "insert",
        scope: "body",
        path: "messages",
        value: { role: "system", content: "You are helpful" },
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    const msgs = body.messages as Array<Record<string, string>>;
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toEqual({ role: "system", content: "You are helpful" });
  });

  test("insert at start: prepends to array", async () => {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: "hello" }],
    };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "insert",
        scope: "body",
        path: "messages",
        value: { role: "system", content: "system prompt" },
        position: "start",
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    const msgs = body.messages as Array<Record<string, string>>;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: "system", content: "system prompt" });
  });

  test("insert before anchor: anchor found -> correct position", async () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: "system", content: "existing" },
        { role: "user", content: "hello" },
      ],
    };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "insert",
        scope: "body",
        path: "messages",
        value: { role: "system", content: "injected" },
        position: "before",
        anchor: { field: "role", value: "user" },
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    const msgs = body.messages as Array<Record<string, string>>;
    expect(msgs).toHaveLength(3);
    expect(msgs[1]).toEqual({ role: "system", content: "injected" });
    expect(msgs[2]).toEqual({ role: "user", content: "hello" });
  });

  test("insert after anchor: anchor found -> correct position", async () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ],
    };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "insert",
        scope: "body",
        path: "messages",
        value: { role: "system", content: "after-user" },
        position: "after",
        anchor: { field: "role", value: "user" },
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    const msgs = body.messages as Array<Record<string, string>>;
    expect(msgs).toHaveLength(4);
    expect(msgs[2]).toEqual({ role: "system", content: "after-user" });
  });

  test("onAnchorMissing: start - anchor not found -> prepend", async () => {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: "hello" }],
    };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "insert",
        scope: "body",
        path: "messages",
        value: { role: "system", content: "fallback-start" },
        position: "before",
        anchor: { field: "role", value: "nonexistent" },
        onAnchorMissing: "start",
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    const msgs = body.messages as Array<Record<string, string>>;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: "system", content: "fallback-start" });
  });

  test("onAnchorMissing: end - anchor not found -> append", async () => {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: "hello" }],
    };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "insert",
        scope: "body",
        path: "messages",
        value: { role: "system", content: "fallback-end" },
        position: "after",
        anchor: { field: "role", value: "nonexistent" },
        onAnchorMissing: "end",
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    const msgs = body.messages as Array<Record<string, string>>;
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toEqual({ role: "system", content: "fallback-end" });
  });

  test("onAnchorMissing: skip - anchor not found -> no insertion", async () => {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: "hello" }],
    };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "insert",
        scope: "body",
        path: "messages",
        value: { role: "system", content: "skipped" },
        position: "before",
        anchor: { field: "role", value: "nonexistent" },
        onAnchorMissing: "skip",
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    const msgs = body.messages as Array<Record<string, string>>;
    expect(msgs).toHaveLength(1);
  });

  test("dedupe (deep equal): exact duplicate exists -> skip", async () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "hello" },
      ],
    };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "insert",
        scope: "body",
        path: "messages",
        value: { role: "system", content: "You are helpful" },
        position: "start",
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    const msgs = body.messages as Array<Record<string, string>>;
    expect(msgs).toHaveLength(2); // no insertion, duplicate found
  });

  test("dedupe (byFields): partial field match exists -> skip", async () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: "system", content: "old system prompt" },
        { role: "user", content: "hello" },
      ],
    };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "insert",
        scope: "body",
        path: "messages",
        value: { role: "system", content: "new system prompt" },
        position: "start",
        dedupe: { byFields: ["role"] },
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    const msgs = body.messages as Array<Record<string, string>>;
    expect(msgs).toHaveLength(2); // skipped because role:"system" already exists
  });

  test("dedupe disabled: duplicate exists -> insert anyway", async () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "hello" },
      ],
    };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "insert",
        scope: "body",
        path: "messages",
        value: { role: "system", content: "You are helpful" },
        position: "start",
        dedupe: { enabled: false },
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    const msgs = body.messages as Array<Record<string, string>>;
    expect(msgs).toHaveLength(3); // inserted despite duplicate
    expect(msgs[0]).toEqual({ role: "system", content: "You are helpful" });
  });

  test("insert into non-existent array: creates array at path", async () => {
    const body: Record<string, unknown> = {};
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "insert",
        scope: "body",
        path: "tools",
        value: { type: "computer_20241022" },
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    expect(body.tools).toEqual([{ type: "computer_20241022" }]);
  });
});

// =============================================================================
// Remove Operations
// =============================================================================

describe("Advanced Mode - Remove Operations", () => {
  beforeEach(() => {
    filterId = 0;
    requestFilterEngine.setFiltersForTest([]);
  });

  test("remove body path: deletes nested field", async () => {
    const body: Record<string, unknown> = {
      metadata: { user_id: "abc", internal: "secret" },
    };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      { op: "remove", scope: "body", path: "metadata.internal" },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    const metadata = body.metadata as Record<string, string>;
    expect(metadata.user_id).toBe("abc");
    expect(metadata.internal).toBeUndefined();
  });

  test("remove array elements by matcher: removes all matching", async () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: "system", content: "a" },
        { role: "user", content: "b" },
        { role: "system", content: "c" },
      ],
    };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "remove",
        scope: "body",
        path: "messages",
        matcher: { field: "role", value: "system" },
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    const msgs = body.messages as Array<Record<string, string>>;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
  });

  test("remove header: deletes header", async () => {
    const body: Record<string, unknown> = {};
    const headers = new Headers({ "x-internal": "secret", "x-keep": "yes" });

    const filter = createAdvancedFilter([{ op: "remove", scope: "header", path: "x-internal" }]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    expect(headers.has("x-internal")).toBe(false);
    expect(headers.get("x-keep")).toBe("yes");
  });
});

// =============================================================================
// Set Operations
// =============================================================================

describe("Advanced Mode - Set Operations", () => {
  beforeEach(() => {
    filterId = 0;
    requestFilterEngine.setFiltersForTest([]);
  });

  test("set body path (overwrite): overwrites existing value", async () => {
    const body: Record<string, unknown> = { model: "old-model" };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      { op: "set", scope: "body", path: "model", value: "new-model" },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    expect(body.model).toBe("new-model");
  });

  test("set body path (if_missing): skips when exists, sets when missing", async () => {
    const body: Record<string, unknown> = { model: "existing" };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "set",
        scope: "body",
        path: "model",
        value: "should-not-set",
        writeMode: "if_missing",
      },
      {
        op: "set",
        scope: "body",
        path: "max_tokens",
        value: 4096,
        writeMode: "if_missing",
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    expect(body.model).toBe("existing"); // unchanged
    expect(body.max_tokens).toBe(4096); // set because missing
  });

  test("set header (overwrite/if_missing): same logic", async () => {
    const body: Record<string, unknown> = {};
    const headers = new Headers({ "x-existing": "old" });

    const filter = createAdvancedFilter([
      { op: "set", scope: "header", path: "x-existing", value: "new" },
      {
        op: "set",
        scope: "header",
        path: "x-new",
        value: "created",
        writeMode: "if_missing",
      },
      {
        op: "set",
        scope: "header",
        path: "x-existing",
        value: "should-not-overwrite",
        writeMode: "if_missing",
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    expect(headers.get("x-existing")).toBe("new"); // overwritten by first op, if_missing skipped
    expect(headers.get("x-new")).toBe("created");
  });

  test("set creates intermediate objects when path doesn't exist", async () => {
    const body: Record<string, unknown> = {};
    const headers = new Headers();

    const filter = createAdvancedFilter([
      { op: "set", scope: "body", path: "metadata.user_id", value: "u123" },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    expect((body.metadata as Record<string, string>).user_id).toBe("u123");
  });
});

// =============================================================================
// Merge Operations
// =============================================================================

describe("Advanced Mode - Merge Operations", () => {
  beforeEach(() => {
    filterId = 0;
    requestFilterEngine.setFiltersForTest([]);
  });

  test("deep merge adds new fields", async () => {
    const body: Record<string, unknown> = {
      metadata: { user_id: "abc" },
    };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "merge",
        scope: "body",
        path: "metadata",
        value: { session_id: "s123", tag: "test" },
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    const metadata = body.metadata as Record<string, string>;
    expect(metadata.user_id).toBe("abc");
    expect(metadata.session_id).toBe("s123");
    expect(metadata.tag).toBe("test");
  });

  test("deep merge overwrites existing fields", async () => {
    const body: Record<string, unknown> = {
      config: { temperature: 0.7, model: "old" },
    };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "merge",
        scope: "body",
        path: "config",
        value: { model: "new" },
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    const config = body.config as Record<string, unknown>;
    expect(config.model).toBe("new");
    expect(config.temperature).toBe(0.7);
  });

  test("deep merge with null value deletes field", async () => {
    const body: Record<string, unknown> = {
      metadata: { user_id: "abc", internal_tracking: "xyz" },
    };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "merge",
        scope: "body",
        path: "metadata",
        value: { internal_tracking: null },
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    const metadata = body.metadata as Record<string, unknown>;
    expect(metadata.user_id).toBe("abc");
    expect("internal_tracking" in metadata).toBe(false);
  });

  test("deep merge on nested objects (e.g., cache_control)", async () => {
    const body: Record<string, unknown> = {
      messages: [
        {
          role: "system",
          content: [
            {
              type: "text",
              text: "prompt",
              cache_control: { type: "ephemeral" },
            },
          ],
        },
      ],
    };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "merge",
        scope: "body",
        path: "messages[0].content[0].cache_control",
        value: { type: "persistent", ttl: 3600 },
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    const msgs = body.messages as Array<{
      content: Array<{ cache_control: Record<string, unknown> }>;
    }>;
    expect(msgs[0].content[0].cache_control).toEqual({
      type: "persistent",
      ttl: 3600,
    });
  });

  test("merge creates target object if missing", async () => {
    const body: Record<string, unknown> = {};
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "merge",
        scope: "body",
        path: "metadata",
        value: { user_id: "abc" },
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    expect((body.metadata as Record<string, string>).user_id).toBe("abc");
  });
});

// =============================================================================
// Matcher Tests
// =============================================================================

describe("Advanced Mode - Matcher", () => {
  beforeEach(() => {
    filterId = 0;
    requestFilterEngine.setFiltersForTest([]);
  });

  test("contains match (string field)", async () => {
    const body: Record<string, unknown> = {
      items: [{ name: "hello world" }, { name: "goodbye" }, { name: "hello there" }],
    };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "remove",
        scope: "body",
        path: "items",
        matcher: { field: "name", value: "hello", matchType: "contains" },
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    const items = body.items as Array<{ name: string }>;
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("goodbye");
  });

  test("regex match (valid pattern)", async () => {
    const body: Record<string, unknown> = {
      items: [{ tag: "v1.0.0" }, { tag: "v2.0.0" }, { tag: "beta" }],
    };
    const headers = new Headers();

    const filter = createAdvancedFilter([
      {
        op: "remove",
        scope: "body",
        path: "items",
        matcher: { field: "tag", value: "^v\\d+", matchType: "regex" },
      },
    ]);
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    const items = body.items as Array<{ tag: string }>;
    expect(items).toHaveLength(1);
    expect(items[0].tag).toBe("beta");
  });
});

// =============================================================================
// Final Phase Integration
// =============================================================================

describe("Advanced Mode - Final Phase Integration", () => {
  beforeEach(() => {
    filterId = 0;
    requestFilterEngine.setFiltersForTest([]);
  });

  test("final filters execute on provided body/headers (not session)", async () => {
    // Simple mode guard filter modifies session
    const guardFilter = createFilter({
      ruleMode: "simple",
      executionPhase: "guard",
      scope: "header",
      action: "set",
      target: "x-guard",
      replacement: "from-guard",
      bindingType: "global",
    });

    // Advanced mode final filter modifies body/headers directly
    const finalFilter = createAdvancedFilter(
      [{ op: "set", scope: "body", path: "injected", value: true }],
      { bindingType: "global" }
    );

    requestFilterEngine.setFiltersForTest([guardFilter, finalFilter]);

    // applyFinal only processes final-phase filters
    const body: Record<string, unknown> = { original: "data" };
    const headers = new Headers();

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    expect(body.injected).toBe(true);
    // guard filter should NOT have been applied to headers
    expect(headers.has("x-guard")).toBe(false);
  });

  test("transport header blacklist enforced after final ops", async () => {
    const body: Record<string, unknown> = {};
    const headers = new Headers();

    const filter = createAdvancedFilter(
      [
        { op: "set", scope: "header", path: "content-length", value: "999" },
        { op: "set", scope: "header", path: "connection", value: "keep-alive" },
        { op: "set", scope: "header", path: "transfer-encoding", value: "chunked" },
        { op: "set", scope: "header", path: "x-custom", value: "allowed" },
      ],
      { bindingType: "global" }
    );
    requestFilterEngine.setFiltersForTest([filter]);

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    expect(headers.has("content-length")).toBe(false);
    expect(headers.has("connection")).toBe(false);
    expect(headers.has("transfer-encoding")).toBe(false);
    expect(headers.get("x-custom")).toBe("allowed");
  });

  test("provider binding works in final phase", async () => {
    const providerFilter = createAdvancedFilter(
      [{ op: "set", scope: "body", path: "provider_applied", value: true }],
      {
        bindingType: "providers",
        providerIds: [42],
      }
    );
    const otherFilter = createAdvancedFilter(
      [{ op: "set", scope: "body", path: "other_applied", value: true }],
      {
        bindingType: "providers",
        providerIds: [99],
      }
    );

    requestFilterEngine.setFiltersForTest([providerFilter, otherFilter]);

    const body: Record<string, unknown> = {};
    const headers = new Headers();

    await requestFilterEngine.applyFinal(
      { provider: { id: 42, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    expect(body.provider_applied).toBe(true);
    expect(body.other_applied).toBeUndefined();
  });

  test("group binding in final phase treats null or blank provider tags as default", async () => {
    const defaultFilter = createAdvancedFilter(
      [{ op: "set", scope: "body", path: "default_applied", value: true }],
      {
        bindingType: "groups",
        groupTags: ["default"],
      }
    );
    const premiumFilter = createAdvancedFilter(
      [{ op: "set", scope: "body", path: "premium_applied", value: true }],
      {
        bindingType: "groups",
        groupTags: ["premium"],
      }
    );
    requestFilterEngine.setFiltersForTest([defaultFilter, premiumFilter]);

    const nullBody: Record<string, unknown> = {};
    const blankBody: Record<string, unknown> = {};
    const premiumBody: Record<string, unknown> = {};
    const headers = new Headers();

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      nullBody,
      headers
    );
    await requestFilterEngine.applyFinal(
      { provider: { id: 2, groupTag: "   " } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      blankBody,
      headers
    );
    await requestFilterEngine.applyFinal(
      { provider: { id: 3, groupTag: "premium" } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      premiumBody,
      headers
    );

    expect(nullBody.default_applied).toBe(true);
    expect(blankBody.default_applied).toBe(true);
    expect(premiumBody.default_applied).toBeUndefined();
    expect(premiumBody.premium_applied).toBe(true);
  });

  test("simple mode filters in final phase use existing logic on body/headers", async () => {
    const filter = createFilter({
      ruleMode: "simple",
      executionPhase: "final",
      scope: "body",
      action: "json_path",
      target: "secret",
      replacement: "***",
      bindingType: "global",
    });
    requestFilterEngine.setFiltersForTest([filter]);

    const body: Record<string, unknown> = { secret: "my-api-key" };
    const headers = new Headers();

    await requestFilterEngine.applyFinal(
      { provider: { id: 1, groupTag: null } } as Parameters<
        typeof requestFilterEngine.applyFinal
      >[0],
      body,
      headers
    );

    expect(body.secret).toBe("***");
  });
});
