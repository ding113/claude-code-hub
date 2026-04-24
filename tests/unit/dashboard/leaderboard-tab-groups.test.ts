import { describe, expect, it } from "vitest";
import {
  getPrimaryTabFromScope,
  getScopeForPrimaryTab,
  getScopeForSecondaryTab,
  getSecondaryTabFromScope,
  normalizeScopeFromUrl,
} from "@/app/[locale]/dashboard/leaderboard/_components/leaderboard-tab-groups";

describe("leaderboard tab groups", () => {
  it("maps admin leaf scopes to grouped tabs", () => {
    expect(normalizeScopeFromUrl("providerCacheHitRate", true)).toBe("providerCacheHitRate");
    expect(getPrimaryTabFromScope("user")).toBe("user");
    expect(getPrimaryTabFromScope("providerCacheHitRate")).toBe("provider");
    expect(getPrimaryTabFromScope("model")).toBe("model");
    expect(getSecondaryTabFromScope("user")).toBe("cost");
    expect(getSecondaryTabFromScope("providerCacheHitRate")).toBe("cacheHit");
    expect(getSecondaryTabFromScope("model")).toBeNull();
    expect(getScopeForPrimaryTab("provider")).toBe("provider");
    expect(getScopeForPrimaryTab("model")).toBe("model");
    expect(getScopeForSecondaryTab("user", "cacheHit")).toBe("userCacheHitRate");
    expect(getScopeForSecondaryTab("provider", "cost")).toBe("provider");
  });

  it("forces non-admin scopes back to user", () => {
    expect(normalizeScopeFromUrl("provider", false)).toBe("user");
    expect(normalizeScopeFromUrl("providerCacheHitRate", false)).toBe("user");
    expect(normalizeScopeFromUrl("model", false)).toBe("user");
    expect(normalizeScopeFromUrl("userCacheHitRate", false)).toBe("user");
    expect(normalizeScopeFromUrl("user", false)).toBe("user");
    expect(normalizeScopeFromUrl("unknown", true)).toBe("user");
    expect(normalizeScopeFromUrl(null, true)).toBe("user");
  });
});
