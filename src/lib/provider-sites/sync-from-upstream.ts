/**
 * Refresh one provider site's upstream group rates + balance by logging into the site directly.
 */
import { publishProviderCacheInvalidation } from "@/lib/cache/provider-cache";
import { logger } from "@/lib/logger";
import { decryptSecret, encryptSecret } from "@/lib/provider-sites/secret-box";
import {
  findUnkeyedOtherSiteGroupNames,
  pruneStaleSiteProvidersForUpstreamGroups,
  syncSiteKeysForGroups,
  syncSiteProviderBalanceState,
} from "@/lib/provider-sites/sync-keys";
import {
  fetchUpstreamApiKeys,
  fetchUpstreamBalance,
  fetchUpstreamGroupRates,
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

export async function syncProviderSiteFromUpstream(
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
      const allGroups = await findAllProviderGroups();
      const unkeyedOtherGroups = findUnkeyedOtherSiteGroupNames({
        groupNames: upstreamGroupNames,
        upstreamKeys,
        groups: allGroups,
      });
      if (unkeyedOtherGroups.length > 0) {
        const retainedGroupNames = upstreamGroupNames.filter(
          (groupName) => !unkeyedOtherGroups.includes(groupName)
        );
        try {
          const removed = await deleteProviderSiteGroupRatesNotIn(siteId, retainedGroupNames);
          if (removed.length > 0) {
            logger.info("[provider-sites] pruned unkeyed non-routable site groups", {
              siteId,
              siteName,
              removed,
              keyGroups: upstreamKeys.map((key) => key.groupName),
            });
          }
        } catch (error) {
          logger.warn("[provider-sites] unkeyed non-routable group-rate pruning failed", {
            siteId,
            siteName,
            groups: unkeyedOtherGroups,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        try {
          staleProvidersDeleted += await pruneStaleSiteProvidersForUpstreamGroups(
            siteId,
            retainedGroupNames
          );
        } catch (error) {
          logger.warn("[provider-sites] unkeyed non-routable provider pruning failed", {
            siteId,
            siteName,
            groups: unkeyedOtherGroups,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const keySummary = await syncSiteKeysForGroups({
        siteId,
        siteName,
        siteUrl: row.siteUrl,
        siteType: row.siteType || "sub2api",
        providerVendorId: row.providerVendorId ?? null,
        upstreamKeys,
        groupNames: upstreamGroupNames,
        groups: allGroups,
        // Keep providers.cost_multiplier = upstream group ratio for cheapest-first dispatch.
        groupRatios: Object.fromEntries(groups.map((g) => [g.groupName, g.ratio])),
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
    await updateProviderSite(siteId, {
      lastRateSyncedAt: now,
      lastCostSyncedAt: balance.todayCost != null || balance.totalCost != null ? now : undefined,
      lastBalance: balance.balance,
      lastBalanceAt: balance.balance != null ? now : null,
      todayCost: balance.todayCost,
      totalCost: balance.totalCost,
      lastSyncError: null,
      lastSyncAt: now,
    });
    await publishProviderCacheInvalidation();

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
    const message = error instanceof Error ? error.message : String(error);
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
