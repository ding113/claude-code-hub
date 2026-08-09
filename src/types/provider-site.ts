/**
 * Provider site (upstream website / 中转单位) entity.
 * Maps to provider_sites + provider_site_group_rates.
 */

export type ProviderSiteType = "sub2api" | "newapi" | "custom";
export type ProviderSiteCaptchaProvider =
  | "none"
  | "global"
  | "yescaptcha"
  | "capsolver"
  | "2captcha"
  | "anticaptcha";

export interface ProviderSiteGroupRate {
  id: number;
  siteId: number;
  groupName: string;
  description: string | null;
  /** Upstream group ratio / rate_multiplier */
  ratio: number;
  /** CCH-facing ratio: upstream ratio / parent site's recharge multiplier. */
  effectiveRatio: number;
  completionRatio: number | null;
  /** CCH-facing completion ratio after the same conversion. */
  effectiveCompletionRatio: number | null;
  /**
   * CCH dispatch pool after classification:
   * image | grok | claude | codex | other
   */
  dispatchGroupTag: string | null;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderSite {
  id: number;
  name: string;
  siteUrl: string;
  siteType: ProviderSiteType | string;
  providerVendorId: number | null;
  notes: string | null;
  isEnabled: boolean;
  /** Manual display order for site cards (lower first). */
  sortOrder: number;
  /** Upstream recharge multiplier used for CCH-facing rates and balances. */
  rechargeMultiplier: number;
  upstreamHubChannelId: number | null;
  username: string | null;
  /** Whether a password is stored (never return ciphertext to clients). */
  hasPassword: boolean;
  turnstileEnabled: boolean;
  captchaProvider: ProviderSiteCaptchaProvider | string;
  hasCaptchaApiKey: boolean;
  captchaEndpoint: string | null;
  lastBalance: number | null;
  /** CCH-facing balance: upstream balance / rechargeMultiplier. */
  realBalance: number | null;
  lastBalanceAt: Date | null;
  todayCost: number | null;
  /** CCH-facing today cost: upstream todayCost / rechargeMultiplier. */
  realTodayCost: number | null;
  totalCost: number | null;
  lastSyncError: string | null;
  lastSyncAt: Date | null;
  lastRateSyncedAt: Date | null;
  lastCostSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderSiteWithRates extends ProviderSite {
  groupRates: ProviderSiteGroupRate[];
  providerCount: number;
  enabledProviderCount: number;
}

export interface CreateProviderSiteInput {
  name: string;
  siteUrl: string;
  siteType?: ProviderSiteType | string;
  providerVendorId?: number | null;
  notes?: string | null;
  isEnabled?: boolean;
  sortOrder?: number;
  rechargeMultiplier?: number;
  upstreamHubChannelId?: number | null;
  username?: string | null;
  /** Plain password; encrypted before storage. */
  password?: string | null;
  turnstileEnabled?: boolean;
  captchaProvider?: ProviderSiteCaptchaProvider | string;
  captchaApiKey?: string | null;
  captchaEndpoint?: string | null;
}

export interface UpdateProviderSiteInput {
  name?: string;
  siteUrl?: string;
  siteType?: ProviderSiteType | string;
  providerVendorId?: number | null;
  notes?: string | null;
  isEnabled?: boolean;
  sortOrder?: number;
  rechargeMultiplier?: number;
  upstreamHubChannelId?: number | null;
  username?: string | null;
  /** Plain password; omit/empty keeps existing. */
  password?: string | null;
  turnstileEnabled?: boolean;
  captchaProvider?: ProviderSiteCaptchaProvider | string;
  captchaApiKey?: string | null;
  captchaEndpoint?: string | null;
  lastRateSyncedAt?: Date | null;
  lastCostSyncedAt?: Date | null;
  lastBalance?: number | null;
  lastBalanceAt?: Date | null;
  todayCost?: number | null;
  totalCost?: number | null;
  lastSyncError?: string | null;
  lastSyncAt?: Date | null;
  sessionAccessTokenCipher?: string | null;
  sessionCookieCipher?: string | null;
  sessionUserId?: string | null;
  sessionExpiresAt?: Date | null;
}

export interface UpsertProviderSiteGroupRateInput {
  groupName: string;
  description?: string | null;
  ratio?: number;
  completionRatio?: number | null;
  dispatchGroupTag?: string | null;
}

export interface UpdateProviderSiteGroupRateInput {
  groupName?: string;
  description?: string | null;
  ratio?: number;
  completionRatio?: number | null;
  dispatchGroupTag?: string | null;
}

export interface ProviderSiteSyncResult {
  siteId: number;
  siteName: string;
  ok: boolean;
  groupsSeen: number;
  groupsUpserted: number;
  balance: number | null;
  todayCost: number | null;
  totalCost: number | null;
  error?: string;
  durationMs: number;
  /** Key sync: one provider per (site, group). */
  keysSynced?: {
    created: number;
    deleted: number;
    reused: number;
    skippedGroups: string[];
    keysSeen: number;
    /** Upstream keys auto-created for empty eligible groups. */
    keysAutoCreated?: number;
    /** Upstream API keys deleted because they were explicitly unassigned. */
    unboundUpstreamKeysDeleted?: number;
    /** Duplicate upstream keys removed while keeping one key per group. */
    upstreamDuplicateKeysDeleted?: number;
  };
}
