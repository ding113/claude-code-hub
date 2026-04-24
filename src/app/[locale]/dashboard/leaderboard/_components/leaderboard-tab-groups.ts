export type LeaderboardLeafScope =
  | "user"
  | "userCacheHitRate"
  | "provider"
  | "providerCacheHitRate"
  | "model";

export type LeaderboardPrimaryTab = "user" | "provider" | "model";
export type LeaderboardPrimaryTabWithSecondary = Exclude<LeaderboardPrimaryTab, "model">;
export type LeaderboardSecondaryTab = "cost" | "cacheHit";

export function normalizeScopeFromUrl(
  scope: string | null | undefined,
  isAdmin: boolean
): LeaderboardLeafScope {
  if (scope === "user") {
    return "user";
  }

  if (
    isAdmin &&
    (scope === "userCacheHitRate" ||
      scope === "provider" ||
      scope === "providerCacheHitRate" ||
      scope === "model")
  ) {
    return scope;
  }

  return "user";
}

export function getPrimaryTabFromScope(scope: LeaderboardLeafScope): LeaderboardPrimaryTab {
  if (scope === "provider" || scope === "providerCacheHitRate") {
    return "provider";
  }

  if (scope === "model") {
    return "model";
  }

  return "user";
}

export function isUserFamilyScope(scope: LeaderboardLeafScope): boolean {
  return getPrimaryTabFromScope(scope) === "user";
}

export function isProviderFamilyScope(scope: LeaderboardLeafScope): boolean {
  return getPrimaryTabFromScope(scope) === "provider";
}

export function getSecondaryTabFromScope(
  scope: LeaderboardLeafScope
): LeaderboardSecondaryTab | null {
  if (scope === "model") {
    return null;
  }

  return scope === "userCacheHitRate" || scope === "providerCacheHitRate" ? "cacheHit" : "cost";
}

export function getScopeForPrimaryTab(tab: LeaderboardPrimaryTab): LeaderboardLeafScope {
  if (tab === "provider") {
    return "provider";
  }

  if (tab === "model") {
    return "model";
  }

  return "user";
}

export function getScopeForSecondaryTab(
  primaryTab: LeaderboardPrimaryTabWithSecondary,
  secondaryTab: LeaderboardSecondaryTab
): LeaderboardLeafScope {
  if (primaryTab === "provider") {
    return secondaryTab === "cacheHit" ? "providerCacheHitRate" : "provider";
  }

  return secondaryTab === "cacheHit" ? "userCacheHitRate" : "user";
}
