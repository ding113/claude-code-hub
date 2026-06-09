import { describe, expect, it } from "vitest";
import { buildModelLeaseKey, modelHash } from "@/lib/model-rate-limit/keys";

describe("modelHash", () => {
  it("produces a deterministic 16-char hex hash for a model name", () => {
    const a = modelHash("claude-opus-4");
    const b = modelHash("claude-opus-4");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("produces different hashes for different models", () => {
    expect(modelHash("claude-opus-4")).not.toBe(modelHash("claude-haiku-4.5"));
  });

  it("sanitizes models containing redis-key-hostile characters into a clean hash", () => {
    const hash = modelHash("vendor/model:tag");
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).not.toContain("/");
    expect(hash).not.toContain(":");
  });
});

describe("buildModelLeaseKey", () => {
  const hash = modelHash("claude-opus-4");

  it("includes resetMode for 5h and daily windows", () => {
    expect(buildModelLeaseKey("user", 7, "claude-opus-4", "5h", "rolling")).toBe(
      `lease:user-model:7:${hash}:5h:rolling`
    );
    expect(buildModelLeaseKey("key", 42, "claude-opus-4", "daily", "fixed")).toBe(
      `lease:key-model:42:${hash}:daily:fixed`
    );
  });

  it("omits resetMode for weekly and monthly windows", () => {
    expect(buildModelLeaseKey("user", 7, "claude-opus-4", "weekly")).toBe(
      `lease:user-model:7:${hash}:weekly`
    );
    expect(buildModelLeaseKey("user", 7, "claude-opus-4", "monthly")).toBe(
      `lease:user-model:7:${hash}:monthly`
    );
  });

  it("keeps user-model and key-model prefixes disjoint from the mainline lease: prefix", () => {
    const userKey = buildModelLeaseKey("user", 7, "claude-opus-4", "weekly");
    const keyKey = buildModelLeaseKey("key", 7, "claude-opus-4", "weekly");
    expect(userKey.startsWith("lease:user-model:")).toBe(true);
    expect(keyKey.startsWith("lease:key-model:")).toBe(true);
    expect(userKey).not.toBe(keyKey);
  });
});
