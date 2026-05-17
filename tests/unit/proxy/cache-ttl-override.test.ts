import { describe, expect, it } from "vitest";
import {
  applyCacheTtlOverrideToMessage,
  mergeAnthropicCacheTtlBetaFlag,
} from "@/app/v1/_lib/proxy/forwarder";

describe("applyCacheTtlOverrideToMessage", () => {
  it("rewrites ttl on top-level system content blocks with ephemeral cache_control", () => {
    const message: Record<string, unknown> = {
      system: [
        {
          type: "text",
          text: "system prompt",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [],
    };

    const applied = applyCacheTtlOverrideToMessage(message, "1h");

    expect(applied).toBe(true);
    expect(message.system).toEqual([
      {
        type: "text",
        text: "system prompt",
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ]);
  });

  it("leaves a string-form system field untouched", () => {
    const message: Record<string, unknown> = {
      system: "you are helpful",
      messages: [],
    };

    const applied = applyCacheTtlOverrideToMessage(message, "1h");

    expect(applied).toBe(false);
    expect(message.system).toBe("you are helpful");
  });

  it("rewrites ttl on messages[].content[] ephemeral blocks (existing behavior)", () => {
    const message: Record<string, unknown> = {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "hello",
              cache_control: { type: "ephemeral" },
            },
          ],
        },
      ],
    };

    const applied = applyCacheTtlOverrideToMessage(message, "1h");

    expect(applied).toBe(true);
    const messages = message.messages as Array<{
      content: Array<{ cache_control: Record<string, unknown> }>;
    }>;
    expect(messages[0].content[0].cache_control).toEqual({
      type: "ephemeral",
      ttl: "1h",
    });
  });

  it("rewrites both system and messages breakpoints in a single pass", () => {
    const message: Record<string, unknown> = {
      system: [{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "u", cache_control: { type: "ephemeral" } }],
        },
      ],
    };

    const applied = applyCacheTtlOverrideToMessage(message, "1h");

    expect(applied).toBe(true);
    const sys = message.system as Array<{ cache_control: Record<string, unknown> }>;
    const msgs = message.messages as Array<{
      content: Array<{ cache_control: Record<string, unknown> }>;
    }>;
    expect(sys[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(msgs[0].content[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("returns false and preserves reference identity when there are no ephemeral breakpoints", () => {
    const originalSystem = [{ type: "text", text: "no cache" }];
    const originalMessageContent = [{ type: "text", text: "no cache here either" }];
    const message: Record<string, unknown> = {
      system: originalSystem,
      messages: [{ role: "user", content: originalMessageContent }],
    };

    const applied = applyCacheTtlOverrideToMessage(message, "1h");

    expect(applied).toBe(false);
    // Reference identity should be preserved on the no-op path so downstream
    // consumers that diff by reference (e.g. dirty-checking) don't see false positives.
    expect(message.system).toBe(originalSystem);
    expect((message.messages as Array<{ content: unknown }>)[0].content).toBe(
      originalMessageContent
    );
  });

  it("downgrades existing 1h ttl to 5m when override resolves to 5m", () => {
    const message: Record<string, unknown> = {
      system: [
        {
          type: "text",
          text: "sys",
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "u",
              cache_control: { type: "ephemeral", ttl: "1h" },
            },
          ],
        },
      ],
    };

    const applied = applyCacheTtlOverrideToMessage(message, "5m");

    expect(applied).toBe(true);
    const sys = message.system as Array<{ cache_control: Record<string, unknown> }>;
    const msgs = message.messages as Array<{
      content: Array<{ cache_control: Record<string, unknown> }>;
    }>;
    expect(sys[0].cache_control).toEqual({ type: "ephemeral", ttl: "5m" });
    expect(msgs[0].content[0].cache_control).toEqual({ type: "ephemeral", ttl: "5m" });
  });

  it("ignores non-ephemeral cache_control entries and non-object cache_control", () => {
    const message: Record<string, unknown> = {
      system: [
        // unknown cache_control type — must not be modified
        {
          type: "text",
          text: "sys",
          cache_control: { type: "persistent" },
        },
        // cache_control as a non-object — must not crash and must not mark applied
        { type: "text", text: "weird", cache_control: "ephemeral" },
      ],
      messages: [],
    };

    const applied = applyCacheTtlOverrideToMessage(message, "1h");

    expect(applied).toBe(false);
    const sys = message.system as Array<Record<string, unknown>>;
    expect(sys[0].cache_control).toEqual({ type: "persistent" });
    expect(sys[1].cache_control).toBe("ephemeral");
  });

  it("handles missing system / messages gracefully", () => {
    const message: Record<string, unknown> = {};
    const applied = applyCacheTtlOverrideToMessage(message, "1h");
    expect(applied).toBe(false);
    expect(message).toEqual({});
  });

  it("preserves other fields on the content block when rewriting cache_control", () => {
    const message: Record<string, unknown> = {
      system: [
        {
          type: "text",
          text: "sys",
          extraField: "keepme",
          cache_control: { type: "ephemeral", customExt: "x" },
        },
      ],
      messages: [],
    };

    applyCacheTtlOverrideToMessage(message, "1h");

    const sys = message.system as Array<Record<string, unknown>>;
    expect(sys[0]).toEqual({
      type: "text",
      text: "sys",
      extraField: "keepme",
      cache_control: { type: "ephemeral", customExt: "x", ttl: "1h" },
    });
  });
});

describe("mergeAnthropicCacheTtlBetaFlag", () => {
  it("adds extended-cache-ttl + prompt-caching when no existing beta is present", () => {
    const merged = mergeAnthropicCacheTtlBetaFlag(null);
    const flags = merged.split(",").map((s) => s.trim());
    expect(flags).toEqual(
      expect.arrayContaining(["extended-cache-ttl-2025-04-11", "prompt-caching-2024-07-31"])
    );
    expect(flags).toHaveLength(2);
  });

  it("treats undefined and empty string identically to null", () => {
    expect(mergeAnthropicCacheTtlBetaFlag(undefined)).toBe(mergeAnthropicCacheTtlBetaFlag(null));
    expect(mergeAnthropicCacheTtlBetaFlag("")).toBe(mergeAnthropicCacheTtlBetaFlag(null));
  });

  it("always backfills prompt-caching dependency, even when client sent unrelated betas", () => {
    // Regression: previously the helper only backfilled `prompt-caching-2024-07-31` when the
    // set size landed on exactly 1 after adding extended-cache-ttl. If the client had sent any
    // other beta flag (e.g. `messages-2023-12-15`), prompt-caching was silently dropped and
    // the upstream rejected the request for a missing dependency. Now we add it unconditionally.
    const merged = mergeAnthropicCacheTtlBetaFlag("messages-2023-12-15");
    const flags = merged.split(",").map((s) => s.trim());
    expect(flags).toContain("messages-2023-12-15");
    expect(flags).toContain("extended-cache-ttl-2025-04-11");
    expect(flags).toContain("prompt-caching-2024-07-31");
    expect(flags).toHaveLength(3);
  });

  it("dedupes when extended-cache-ttl is already present", () => {
    const merged = mergeAnthropicCacheTtlBetaFlag(
      "extended-cache-ttl-2025-04-11, prompt-caching-2024-07-31"
    );
    const flags = merged.split(",").map((s) => s.trim());
    expect(flags).toEqual(
      expect.arrayContaining(["extended-cache-ttl-2025-04-11", "prompt-caching-2024-07-31"])
    );
    expect(flags).toHaveLength(2);
  });

  it("backfills prompt-caching when client only sent extended-cache-ttl-2025-04-11", () => {
    const merged = mergeAnthropicCacheTtlBetaFlag("extended-cache-ttl-2025-04-11");
    const flags = merged.split(",").map((s) => s.trim());
    expect(flags).toEqual(
      expect.arrayContaining(["extended-cache-ttl-2025-04-11", "prompt-caching-2024-07-31"])
    );
    expect(flags).toHaveLength(2);
  });

  it("trims whitespace and ignores empty segments in the existing header", () => {
    const merged = mergeAnthropicCacheTtlBetaFlag("  ,  messages-2023-12-15  ,  ");
    const flags = merged.split(",").map((s) => s.trim());
    expect(flags).toContain("messages-2023-12-15");
    expect(flags).toContain("extended-cache-ttl-2025-04-11");
    expect(flags).toContain("prompt-caching-2024-07-31");
    expect(flags).toHaveLength(3);
  });
});
