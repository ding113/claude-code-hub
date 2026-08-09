/**
 * Refresh one provider site's upstream group rates + balance by logging into the site directly.
 */
import { publishProviderCacheInvalidation } from "@/lib/cache/provider-cache";
import { logger } from "@/lib/logger";
import { normalizeUpstreamRate } from "@/lib/provider-sites/billing";
import {
  clearProviderSiteRateLimit,
  formatProviderSiteRateLimitCooldown,
  getProviderSiteRateLimitCooldown,
  noteProviderSiteRateLimit,
} from "@/lib/provider-sites/rate-limit-cooldown";
import { decryptSecret, encryptSecret } from "@/lib/provider-sites/secret-box";
import {
  deleteDuplicateUpstreamApiKeys,
  deleteUnboundUpstreamApiKeys,
  pruneStaleSiteProvidersForUpstreamGroups,
  syncSiteKeysForGroups,
  syncSiteProviderBalanceState,
} from "@/lib/provider-sites/sync-keys";
import {
  fetchUpstreamApiKeys,
  fetchUpstreamBalance,
  fetchUpstreamGroupRates,
  isUpstreamRateLimitedError,
  isUpstreamUnauthorizedError,
  loginUpstreamSite,
  type UpstreamAuthSession,
  type UpstreamSiteCredentials,
} from "@/lib/provider-sites/upstream-connector";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import { findAllProviderGroups } from "@/repository/provider-groups";
import {
  deleteProviderSiteGroupRatesNotIn,
  findEnabledProviderSiteAuthRows,
  findProviderSiteAuthRow,
  updateProviderSite,
  upsertProviderSiteGroupRate,
} from "@/repository/provider-sites";
import type { ProviderSiteSyncResult } from "@/types/provider-site";

function rowToCreds(row: NonNullable<Awaited<ReturnType<typeof findProviderSiteAuthRow>>>): {
  creds: UpstreamSiteCredentials;
  siteName: string;
} {
  const password = decryptSecret(row.passwordCipher) || "";
  let captchaProvider = (row.captchaProvider || "global").trim().toLowerCase();
  const captchaApiKey = decryptSecret(row.captchaApiKeyCipher);
  const captchaEndpoint = row.captchaEndpoint;
  // "global" (or legacy empty) resolves to system-wide captcha credentials later in sync.
  if (!captchaProvider || captchaProvider === "global") {
    captchaProvider = "global";
  }
  let session: UpstreamAuthSession | null = null;
  if (row.sessionExpiresAt) {
    const accessToken = decryptSecret(row.sessionAccessTokenCipher) || undefined;
    const cookie = decryptSecret(row.sessionCookieCipher) || undefined;
    if (accessToken || cookie) {
      session = {
        accessToken,
        cookie,
        userId: row.sessionUserId ?? undefined,
        expiresAt: new Date(row.sessionExpiresAt),
      };
    }
  }
  return {
    siteName: row.name,
    creds: {
      siteUrl: row.siteUrl,
      siteType: row.siteType || "sub2api",
      username: row.username || "",
      password,
      turnstileEnabled: row.turnstileEnabled ?? false,
      captchaProvider,
      captchaApiKey,
      captchaEndpoint,
      session,
    },
  };
}

async function resolveGlobalCaptcha(
  creds: UpstreamSiteCredentials
): Promise<UpstreamSiteCredentials> {
  if (creds.captchaProvider !== "global") return creds;
  try {
    const { getSystemSettings } = await import("@/repository/system-config");
    const { db } = await import("@/drizzle/db");
    const { systemSettings } = await import("@/drizzle/schema");
    const settings = await getSystemSettings();
    const [cipherRow] = await db
      .select({ cipher: systemSettings.siteCaptchaApiKeyCipher })
      .from(systemSettings)
      .limit(1);
    return {
      ...creds,
      captchaProvider: settings.siteCaptchaProvider || "none",
      captchaApiKey: decryptSecret(cipherRow?.cipher) ?? null,
      captchaEndpoint: settings.siteCaptchaEndpoint,
    };
  } catch (error) {
    logger.warn("[provider-sites] resolve global captcha failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...creds, captchaProvider: "none", captchaApiKey: null };
  }
}

async function persistSession(siteId: number, session: UpstreamAuthSession): Promise<void> {
  await updateProviderSite(siteId, {
    sessionAccessTokenCipher: session.accessToken ? encryptSecret(session.accessToken) : null,
    sessionCookieCipher: session.cookie ? encryptSecret(session.cookie) : null,
    sessionUserId: session.userId ?? null,
    sessionExpiresAt: session.expiresAt,
  });
}

async function clearPersistedSession(siteId: number): Promise<void> {
  await updateProviderSite(siteId, {
    sessionAccessTokenCipher: null,
    sessionCookieCipher: null,
    sessionUserId: null,
    sessionExpiresAt: null,
  });
}

async function fetchRatesAndBalance(
  siteId: number,
  creds: UpstreamSiteCredentials,
  session: UpstreamAuthSession
) {
  const groups = await fetchUpstreamGroupRates(creds, session);
  const timezone = await resolveSystemTimezone();
  const balance = await fetchUpstreamBalance(creds, session, timezone).catch((error) => {
    if (isUpstreamUnauthorizedError(error)) throw error;
    logger.warn("[provider-sites] balance fetch failed", {
      siteId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { balance: null, todayCost: null, totalCost: null };
  });
  return { groups, balance };
}

const activeSiteSyncs = new Map<number, Promise<ProviderSiteSyncResult>>();

async function syncProviderSiteFromUpstreamUnlocked(
  siteId: number
): Promise<ProviderSiteSyncResult> {
  const started = Date.now();
  const row = await findProviderSiteAuthRow(siteId);
  if (!row) {
    return {
      siteId,
      siteName: `#${siteId}`,
      ok: false,
      groupsUpserted: 0,
      groupsSeen: 0,
      balance: null,
      todayCost: null,
      totalCost: null,
      error: "site not found",
      durationMs: Date.now() - started,
    };
  }

  const { creds: rawCreds, siteName } = rowToCreds(row);
  const existingCooldown = getProviderSiteRateLimitCooldown(rawCreds.siteUrl, {
    lastSyncAt: row.lastSyncAt,
    lastSyncError: row.lastSyncError,
  });
  if (existingCooldown) {
    const error = formatProviderSiteRateLimitCooldown(existingCooldown);
    logger.info("[provider-sites] sync skipped during rate-limit cooldown", {
      siteId,
      siteName,
      retryInMs: existingCooldown.remainingMs,
      source: existingCooldown.source,
    });
    return {
      siteId,
      siteName,
      ok: false,
      groupsUpserted: 0,
      groupsSeen: 0,
      balance: null,
      todayCost: null,
      totalCost: null,
      error,
      durationMs: Date.now() - started,
    };
  }
  if (!rawCreds.username || !rawCreds.password) {
    const error = "missing username/password";
    await updateProviderSite(siteId, {
      lastSyncError: error,
      lastSyncAt: new Date(),
    });
    return {
      siteId,
      siteName,
      ok: false,
      groupsUpserted: 0,
      groupsSeen: 0,
      balance: null,
      todayCost: null,
      totalCost: null,
      error,
      durationMs: Date.now() - started,
    };
  }

  try {
    let creds = await resolveGlobalCaptcha(rawCreds);
    let session = await loginUpstreamSite(creds);
    await persistSession(siteId, session);

    let groupsAndBalance;
    try {
      groupsAndBalance = await fetchRatesAndBalance(siteId, creds, session);
    } catch (error) {
      if (!isUpstreamUnauthorizedError(error)) throw error;
      logger.warn("[provider-sites] upstream session rejected; re-authenticating", {
        siteId,
        siteName,
      });
      await clearPersistedSession(siteId);
      creds = { ...creds, session: null };
      session = await loginUpstreamSite(creds);
      await persistSession(siteId, session);
      groupsAndBalance = await fetchRatesAndBalance(siteId, creds, session);
    }
    const { groups, balance } = groupsAndBalance;
    const upstreamGroupNames = groups
      .map((group) => group.groupName.trim())
      .filter((groupName) => groupName.length > 0);

    let upserted = 0;
    for (const g of groups) {
      await upsertProviderSiteGroupRate(siteId, {
        groupName: g.groupName,
        description: g.description,
        ratio: g.ratio,
        completionRatio: g.completionRatio,
      });
      upserted += 1;
    }

    // Only prune when the upstream returned a non-empty group list. An empty
    // list is more often a transient auth/API glitch than "site has zero groups".
    if (upstreamGroupNames.length > 0) {
      const removed = await deleteProviderSiteGroupRatesNotIn(siteId, upstreamGroupNames);
      if (removed.length > 0) {
        logger.info("[provider-sites] pruned stale site groups", {
          siteId,
          siteName,
          removed,
        });
      }
    }

    // Group rates are authoritative for provider pruning. Do this before fetching
    // keys so a temporary upstream key-list failure cannot keep a removed group
    // routable locally.
    let staleProvidersDeleted = 0;
    if (upstreamGroupNames.length > 0) {
      try {
        staleProvidersDeleted = await pruneStaleSiteProvidersForUpstreamGroups(
          siteId,
          upstreamGroupNames
        );
      } catch (error) {
        logger.warn("[provider-sites] stale provider pruning failed", {
          siteId,
          siteName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Key sync: one provider per (site, group). Duplicate providers under the same
    // site+group are pruned (keep enabled); missing groups auto-create an upstream
    // key then mirror it into CCH.
    let keysSynced: ProviderSiteSyncResult["keysSynced"];
    try {
      let upstreamKeys;
      try {
        upstreamKeys = await fetchUpstreamApiKeys(creds, session);
      } catch (error) {
        if (!isUpstreamUnauthorizedError(error)) throw error;
        logger.warn("[provider-sites] upstream key session rejected; re-authenticating", {
          siteId,
          siteName,
        });
        await clearPersistedSession(siteId);
        creds = { ...creds, session: null };
        session = await loginUpstreamSite(creds);
        await persistSession(siteId, session);
        upstreamKeys = await fetchUpstreamApiKeys(creds, session);
      }
      logger.info("[provider-sites] upstream keys fetched", {
        siteId,
        siteName,
        count: upstreamKeys.length,
        grouped: new Set(upstreamKeys.map((k) => k.groupName)).size,
      });
      const deduplicated = await deleteDuplicateUpstreamApiKeys({
        siteId,
        siteName,
        upstreamKeys,
        creds,
        session,
      });
      upstreamKeys = deduplicated.keys;
      const upstreamDuplicateKeysDeleted = deduplicated.deleted;
      let unboundUpstreamKeysDeleted = 0;
      if (upstreamGroupNames.length > 0) {
        unboundUpstreamKeysDeleted = await deleteUnboundUpstreamApiKeys({
          siteId,
          siteName,
          upstreamKeys,
          creds,
          session,
        });
      }
      const allGroups = await findAllProviderGroups();
      const keySummary = await syncSiteKeysForGroups({
        siteId,
        siteName,
        siteUrl: row.siteUrl,
        siteType: row.siteType || "sub2api",
        providerVendorId: row.providerVendorId ?? null,
        upstreamKeys,
        groupNames: upstreamGroupNames,
        groups: allGroups,
        // Keep providers.cost_multiplier = effective CCH ratio for cheapest-first dispatch.
        groupRatios: Object.fromEntries(
          groups.map((g) => [g.groupName, normalizeUpstreamRate(g.ratio, row.rechargeMultiplier)])
        ),
        balance: balance.balance,
        // Auto-create missing upstream keys for eligible groups (fail → next tick).
        creds,
        session,
      });
      keysSynced = {
        created: keySummary.providersCreated,
        deleted: staleProvidersDeleted + keySummary.providersDeleted,
        reused: keySummary.providersReused,
        skippedGroups: keySummary.skippedGroupNames,
        keysSeen: keySummary.keysSeen,
        keysAutoCreated: keySummary.keysAutoCreated,
        unboundUpstreamKeysDeleted,
        upstreamDuplicateKeysDeleted,
      };
    } catch (error) {
      logger.warn("[provider-sites] key sync failed (rates still saved)", {
        siteId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Do not toggle providers when the balance request failed or returned an
    // invalid value. A trusted balance below 0.01 disables the whole site's
    // linked provider set; 0.01 and above re-enables it.
    const balanceState = await syncSiteProviderBalanceState(siteId, balance.balance);
    if (balanceState.changed > 0) {
      logger.info("[provider-sites] balance-based provider state updated", {
        siteId,
        siteName,
        enabled: balanceState.enabled,
        changed: balanceState.changed,
      });
    }

    const now = new Date();
    const cooldown = getProviderSiteRateLimitCooldown(creds.siteUrl);
    const cooldownError = cooldown ? formatProviderSiteRateLimitCooldown(cooldown) : null;
    await updateProviderSite(siteId, {
      lastRateSyncedAt: now,
      lastCostSyncedAt: balance.todayCost != null || balance.totalCost != null ? now : undefined,
      lastBalance: balance.balance,
      lastBalanceAt: balance.balance != null ? now : null,
      todayCost: balance.todayCost,
      totalCost: balance.totalCost,
      lastSyncError: cooldownError,
      lastSyncAt: now,
    });
    await publishProviderCacheInvalidation();

    if (cooldownError) {
      logger.warn("[provider-sites] sync partially saved before rate-limit cooldown", {
        siteId,
        siteName,
        retryInMs: cooldown?.remainingMs,
      });
      return {
        siteId,
        siteName,
        ok: false,
        groupsUpserted: upserted,
        groupsSeen: groups.length,
        balance: balance.balance,
        todayCost: balance.todayCost,
        totalCost: balance.totalCost,
        durationMs: Date.now() - started,
        error: cooldownError,
        keysSynced,
      };
    }

    clearProviderSiteRateLimit(creds.siteUrl);
    return {
      siteId,
      siteName,
      ok: true,
      groupsUpserted: upserted,
      groupsSeen: groups.length,
      balance: balance.balance,
      todayCost: balance.todayCost,
      totalCost: balance.totalCost,
      durationMs: Date.now() - started,
      keysSynced,
    };
  } catch (error) {
    if (isUpstreamRateLimitedError(error) && !getProviderSiteRateLimitCooldown(rawCreds.siteUrl)) {
      noteProviderSiteRateLimit(rawCreds.siteUrl, error.retryAfterMs);
    }
    const rawMessage = error instanceof Error ? error.message : String(error);
    const cooldown = getProviderSiteRateLimitCooldown(rawCreds.siteUrl);
    const message = cooldown
      ? `${rawMessage}; ${formatProviderSiteRateLimitCooldown(cooldown)}`
      : rawMessage;
    logger.error("[provider-sites] sync failed", { siteId, siteName, error: message });
    await updateProviderSite(siteId, {
      lastSyncError: message.slice(0, 2000),
      lastSyncAt: new Date(),
    });
    return {
      siteId,
      siteName,
      ok: false,
      groupsUpserted: 0,
      groupsSeen: 0,
      balance: null,
      todayCost: null,
      totalCost: null,
      error: message,
      durationMs: Date.now() - started,
    };
  }
}

/** Serialize manual and scheduled syncs for the same site in this app process. */
export async function syncProviderSiteFromUpstream(
  siteId: number
): Promise<ProviderSiteSyncResult> {
  const active = activeSiteSyncs.get(siteId);
  if (active) {
    logger.info("[provider-sites] sync coalesced; site sync already running", { siteId });
    return active;
  }

  const current = syncProviderSiteFromUpstreamUnlocked(siteId);
  activeSiteSyncs.set(siteId, current);
  try {
    return await current;
  } finally {
    if (activeSiteSyncs.get(siteId) === current) activeSiteSyncs.delete(siteId);
  }
}

export async function syncAllEnabledProviderSitesFromUpstream(options?: {
  concurrency?: number;
}): Promise<ProviderSiteSyncResult[]> {
  const rows = await findEnabledProviderSiteAuthRows();
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 3, 8));
  const results: ProviderSiteSyncResult[] = [];
  let idx = 0;

  async function worker() {
    while (idx < rows.length) {
      const current = rows[idx++];
      if (!current) break;
      // Skip sites without credentials quietly but still record result.
      if (!current.username || !current.passwordCipher) {
        results.push({
          siteId: current.id,
          siteName: current.name,
          ok: false,
          groupsUpserted: 0,
          groupsSeen: 0,
          balance: null,
          todayCost: null,
          totalCost: null,
          error: "missing username/password",
          durationMs: 0,
        });
        continue;
      }
      results.push(await syncProviderSiteFromUpstream(current.id));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results.sort((a, b) => a.siteId - b.siteId);
}
