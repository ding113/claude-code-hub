import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providerHealthTestLogs, providerSites, providerSiteGroupRates, providers } from "@/drizzle/schema";
import { normalizeUpstreamRate, resolveRechargeMultiplier } from "@/lib/provider-sites/billing";
import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { logger } from "@/lib/logger";
import {
  HEALTH_TEST_GLOBAL_DAILY_BUDGET_DEFAULT,
  HEALTH_TEST_PROVIDER_DAILY_BUDGET_DEFAULT,
  HEALTH_TEST_WINDOW_SIZE,
  healthTestDailyBudgetAmount,
  isHealthTestOverDailyBudget,
} from "@/lib/provider-health-test/defaults";
import type { HealthRebalanceProvider } from "@/lib/provider-health-test/slo-rebalance";
import type { HealthTestSloThresholds } from "@/lib/provider-health-test/slo-thresholds";
import {
  computeHealthTestModelStats,
  computeHealthTestStats,
  type HealthTestLogLike,
} from "@/lib/provider-health-test/stats";
import type { Provider, ProviderType } from "@/types/provider";

export type ProviderHealthTestSource = "scheduled" | "manual";

export interface ProviderHealthTestLog {
  id: number;
  providerId: number;
  source: ProviderHealthTestSource;
  ok: boolean;
  status: string | null;
  model: string | null;
  firstByteMs: number | null;
  latencyMs: number | null;
  httpStatusCode: number | null;
  errorType: string | null;
  errorMessage: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  costUsd: number | null;
  createdAt: Date;
}

export type ProviderHealthTestTarget = Pick<
  Provider,
  | "id"
  | "name"
  | "url"
  | "key"
  | "providerType"
  | "proxyUrl"
  | "proxyFallbackToDirect"
  | "customHeaders"
  | "lastHealthTestAt"
  | "scheduledHealthTestEnabled"
  | "isEnabled"
  | "costMultiplier"
  | "groupTag"
> & {
  /** Resolved scheduled health-test model from provider group config; null = skip. */
  healthTestModel?: string | null;
  /** All models configured by the provider's group(s), tested independently. */
  healthTestModels?: string[];
};

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toLog(row: {
  id: number;
  providerId: number;
  source: string;
  ok: boolean;
  status: string | null;
  model: string | null;
  firstByteMs: number | null;
  latencyMs: number | null;
  httpStatusCode: number | null;
  errorType: string | null;
  errorMessage: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  costUsd: string | number | null;
  createdAt: Date | null;
}): ProviderHealthTestLog {
  return {
    id: row.id,
    providerId: row.providerId,
    source: (row.source as ProviderHealthTestSource) || "scheduled",
    ok: row.ok,
    status: row.status,
    model: row.model,
    firstByteMs: row.firstByteMs,
    latencyMs: row.latencyMs,
    httpStatusCode: row.httpStatusCode,
    errorType: row.errorType,
    errorMessage: row.errorMessage,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheCreationInputTokens: row.cacheCreationInputTokens,
    cacheReadInputTokens: row.cacheReadInputTokens,
    costUsd: toNumberOrNull(row.costUsd),
    createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
  };
}

function localDayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function getHealthTestGlobalBudgetStatus(): Promise<{
  todayCost: number;
  budget: number;
  /** Site-wide per-provider daily cap (same for every provider). 0 = unlimited. */
  perProviderBudget: number;
  suspendedDay: string | null;
  isSuspendedToday: boolean;
  localDay: string;
}> {
  const today = localDayKey();
  let budget = HEALTH_TEST_GLOBAL_DAILY_BUDGET_DEFAULT;
  let perProviderBudget = HEALTH_TEST_PROVIDER_DAILY_BUDGET_DEFAULT;
  let suspendedDay: string | null = null;
  try {
    const { getSystemSettings } = await import("@/repository/system-config");
    const settings = await getSystemSettings();
    budget = healthTestDailyBudgetAmount(
      Number.isFinite(settings.healthTestDailyBudgetCny)
        ? settings.healthTestDailyBudgetCny
        : HEALTH_TEST_GLOBAL_DAILY_BUDGET_DEFAULT
    );
    if (
      settings.healthTestPerProviderDailyBudget != null &&
      Number.isFinite(settings.healthTestPerProviderDailyBudget)
    ) {
      // 0 means unlimited for per-provider; do not clamp via healthTestDailyBudgetAmount
      perProviderBudget = Math.max(0, Number(settings.healthTestPerProviderDailyBudget));
    }
    suspendedDay = settings.healthTestGlobalBudgetSuspendedDay ?? null;
  } catch {
    // defaults
  }

  const rows = await db
    .select({
      cost: providers.healthTestTodayCostUsd,
      date: providers.healthTestTodayDate,
    })
    .from(providers)
    .where(isNull(providers.deletedAt));
  let todayCost = 0;
  for (const row of rows) {
    if (row.date === today) {
      todayCost += toNumberOrNull(row.cost) ?? 0;
    }
  }

  return {
    todayCost,
    budget,
    perProviderBudget,
    suspendedDay,
    isSuspendedToday: suspendedDay === today,
    localDay: today,
  };
}

/**
 * When global budget is exceeded: mark system day + turn off ALL currently-on
 * scheduled probes (tagged with healthTestBudgetSuspendedDay for midnight reopen).
 */
export async function suspendAllScheduledHealthTestsForGlobalBudget(
  today: string = localDayKey()
): Promise<{ disabled: number }> {
  const { updateSystemSettings } = await import("@/repository/system-config");
  await updateSystemSettings({ healthTestGlobalBudgetSuspendedDay: today });

  const disabled = await db
    .update(providers)
    .set({
      scheduledHealthTestEnabled: false,
      healthTestBudgetSuspendedDay: today,
      updatedAt: new Date(),
    })
    .where(and(isNull(providers.deletedAt), eq(providers.scheduledHealthTestEnabled, true)))
    .returning({ id: providers.id });

  if (disabled.length > 0) {
    logger.warn(
      "[ProviderHealthTest] GLOBAL daily budget exceeded; all scheduled tests disabled until next day",
      {
        today,
        disabled: disabled.length,
        providerIds: disabled.map((d) => d.id).slice(0, 40),
      }
    );
    try {
      const { publishProviderCacheInvalidation } = await import("@/lib/cache/provider-cache");
      await publishProviderCacheInvalidation();
    } catch {
      // best-effort
    }
  }
  return { disabled: disabled.length };
}

export async function findProvidersForScheduledHealthTest(): Promise<ProviderHealthTestTarget[]> {
  // Midnight rollover: clear global suspend + re-enable providers marked by budget suspend.
  const today = localDayKey();
  try {
    const { getSystemSettings, updateSystemSettings } = await import("@/repository/system-config");
    const settings = await getSystemSettings();
    if (
      settings.healthTestGlobalBudgetSuspendedDay &&
      settings.healthTestGlobalBudgetSuspendedDay !== today
    ) {
      await updateSystemSettings({ healthTestGlobalBudgetSuspendedDay: null });
      logger.info("[ProviderHealthTest] cleared global budget suspend for new local day", {
        previous: settings.healthTestGlobalBudgetSuspendedDay,
        today,
      });
    }

    const reenabled = await db
      .update(providers)
      .set({
        scheduledHealthTestEnabled: true,
        healthTestBudgetSuspendedDay: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          isNull(providers.deletedAt),
          eq(providers.scheduledHealthTestEnabled, false),
          sql`${providers.healthTestBudgetSuspendedDay} IS NOT NULL`,
          sql`${providers.healthTestBudgetSuspendedDay} <> ${today}`
        )
      )
      .returning({ id: providers.id, name: providers.name });
    if (reenabled.length > 0) {
      logger.info("[ProviderHealthTest] auto re-enabled after budget day rollover", {
        count: reenabled.length,
        providerIds: reenabled.map((r) => r.id),
      });
      try {
        const { publishProviderCacheInvalidation } = await import("@/lib/cache/provider-cache");
        await publishProviderCacheInvalidation();
      } catch {
        // best-effort
      }
    }
  } catch (error) {
    logger.warn("[ProviderHealthTest] budget re-enable pass failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // If still globally suspended today, do not schedule any probes.
  try {
    const status = await getHealthTestGlobalBudgetStatus();
    if (status.isSuspendedToday) {
      return [];
    }
  } catch {
    // continue
  }

  const rows = await db
    .select({
      id: providers.id,
      name: providers.name,
      url: providers.url,
      key: providers.key,
      providerType: providers.providerType,
      proxyUrl: providers.proxyUrl,
      proxyFallbackToDirect: providers.proxyFallbackToDirect,
      customHeaders: providers.customHeaders,
      lastHealthTestAt: providers.lastHealthTestAt,
      scheduledHealthTestEnabled: providers.scheduledHealthTestEnabled,
      isEnabled: providers.isEnabled,
      costMultiplier: providers.costMultiplier,
      groupTag: providers.groupTag,
      siteId: providers.siteId,
      siteGroupName: providers.siteGroupName,
      billingMode: providers.billingMode,
    })
    .from(providers)
    .where(
      and(
        isNull(providers.deletedAt),
        eq(providers.isEnabled, true),
        eq(providers.scheduledHealthTestEnabled, true)
      )
    );

  // Resolve all configured per-group health-test models; providers without any
  // configured model are skipped. Preserve tag order for the legacy first model.
  const { getProviderGroupHealthTestModelsMap } = await import("@/repository/provider-groups");
  const { resolveProviderGroupsWithDefault } = await import("@/lib/utils/provider-group");
  const modelsByGroup = await getProviderGroupHealthTestModelsMap();

  // Project site-linked providers' cost multiplier to the CCH-facing (processed)
  // value = upstream ratio ÷ rechargeMultiplier, mirroring dispatch scheduling.
  // providers.cost_multiplier still holds the raw upstream ratio until the next
  // site sync, so health-test cost estimates must apply the same in-memory
  // projection as applyEffectiveSiteDispatchCosts.
  const siteLinkedIds = Array.from(
    new Set(
      rows
        .filter(
          (row) =>
            row.billingMode === "site_group_ratio" &&
            row.siteId != null &&
            String(row.siteGroupName ?? "").trim().length > 0
        )
        .map((row) => row.siteId as number)
    )
  );
  const effectiveBySiteGroup = new Map<string, number>();
  if (siteLinkedIds.length > 0) {
    const [sites, rates] = await Promise.all([
      db
        .select({ id: providerSites.id, rechargeMultiplier: providerSites.rechargeMultiplier })
        .from(providerSites)
        .where(inArray(providerSites.id, siteLinkedIds)),
      db
        .select({
          siteId: providerSiteGroupRates.siteId,
          groupName: providerSiteGroupRates.groupName,
          ratio: providerSiteGroupRates.ratio,
        })
        .from(providerSiteGroupRates)
        .where(inArray(providerSiteGroupRates.siteId, siteLinkedIds)),
    ]);
    const rechargeBySite = new Map(
      sites.map((site) => [site.id, resolveRechargeMultiplier(site.rechargeMultiplier)])
    );
    for (const rate of rates) {
      effectiveBySiteGroup.set(
        `${rate.siteId}:${String(rate.groupName ?? "").trim().toLowerCase()}`,
        normalizeUpstreamRate(rate.ratio, rechargeBySite.get(rate.siteId))
      );
    }
  }

  return rows
    .map((row) => {
      const tags = resolveProviderGroupsWithDefault(row.groupTag);
      const healthTestModels: string[] = [];
      const seenModels = new Set<string>();
      for (const tag of tags) {
        for (const model of modelsByGroup.get(tag) ?? []) {
          if (seenModels.has(model)) continue;
          seenModels.add(model);
          healthTestModels.push(model);
        }
      }
      let costMultiplier = row.costMultiplier ? Number.parseFloat(String(row.costMultiplier)) : 1;
      if (row.billingMode === "site_group_ratio" && row.siteId != null) {
        const effective = effectiveBySiteGroup.get(
          `${row.siteId}:${String(row.siteGroupName ?? "").trim().toLowerCase()}`
        );
        if (effective !== undefined) {
          costMultiplier = effective;
        }
      }
      return {
        id: row.id,
        name: row.name,
        url: row.url,
        key: row.key,
        providerType: (row.providerType || "claude") as ProviderType,
        proxyUrl: row.proxyUrl ?? null,
        proxyFallbackToDirect: row.proxyFallbackToDirect ?? false,
        customHeaders: row.customHeaders ?? null,
        lastHealthTestAt: row.lastHealthTestAt ? new Date(row.lastHealthTestAt) : null,
        scheduledHealthTestEnabled: row.scheduledHealthTestEnabled ?? true,
        isEnabled: row.isEnabled,
        costMultiplier,
        groupTag: row.groupTag ?? null,
        healthTestModel: healthTestModels[0] ?? null,
        healthTestModels,
      };
    })
    .filter((row) => row.healthTestModels.length > 0);
}

export async function findProviderHealthTestLogs(
  providerId: number,
  limit: number = HEALTH_TEST_WINDOW_SIZE
): Promise<ProviderHealthTestLog[]> {
  const rows = await db
    .select({
      id: providerHealthTestLogs.id,
      providerId: providerHealthTestLogs.providerId,
      source: providerHealthTestLogs.source,
      ok: providerHealthTestLogs.ok,
      status: providerHealthTestLogs.status,
      model: providerHealthTestLogs.model,
      firstByteMs: providerHealthTestLogs.firstByteMs,
      latencyMs: providerHealthTestLogs.latencyMs,
      httpStatusCode: providerHealthTestLogs.httpStatusCode,
      errorType: providerHealthTestLogs.errorType,
      errorMessage: providerHealthTestLogs.errorMessage,
      inputTokens: providerHealthTestLogs.inputTokens,
      outputTokens: providerHealthTestLogs.outputTokens,
      cacheCreationInputTokens: providerHealthTestLogs.cacheCreationInputTokens,
      cacheReadInputTokens: providerHealthTestLogs.cacheReadInputTokens,
      costUsd: providerHealthTestLogs.costUsd,
      createdAt: providerHealthTestLogs.createdAt,
    })
    .from(providerHealthTestLogs)
    .where(eq(providerHealthTestLogs.providerId, providerId))
    .orderBy(desc(providerHealthTestLogs.createdAt), desc(providerHealthTestLogs.id))
    .limit(limit);

  return rows.map(toLog);
}

export async function recordProviderHealthTestResult(input: {
  providerId: number;
  source: ProviderHealthTestSource;
  ok: boolean;
  status?: string | null;
  model?: string | null;
  firstByteMs?: number | null;
  latencyMs?: number | null;
  httpStatusCode?: number | null;
  errorType?: string | null;
  errorMessage?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  costUsd?: string | number | null;
  /** Configured models for this provider, used to retain enough interleaved history. */
  healthTestModels?: readonly string[] | null;
}): Promise<{
  onlineRate: number | null;
  avgFirstByteMs: number | null;
  recentResults: import("@/lib/provider-health-test/stats").ProviderHealthTestSample[];
}> {
  const testedAt = new Date();
  const recordedModel =
    typeof input.model === "string" && input.model.trim() ? input.model.trim() : null;
  const costUsdStr =
    input.costUsd == null
      ? null
      : typeof input.costUsd === "number"
        ? input.costUsd.toFixed(15)
        : String(input.costUsd);

  await db.insert(providerHealthTestLogs).values({
    providerId: input.providerId,
    source: input.source,
    ok: input.ok,
    status: input.status ?? null,
    model: recordedModel,
    firstByteMs: input.firstByteMs ?? null,
    latencyMs: input.latencyMs ?? null,
    httpStatusCode: input.httpStatusCode ?? null,
    errorType: input.ok ? null : (input.errorType ?? null),
    errorMessage: input.ok ? null : (input.errorMessage ?? null),
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    cacheCreationInputTokens: input.cacheCreationInputTokens ?? null,
    cacheReadInputTokens: input.cacheReadInputTokens ?? null,
    costUsd: costUsdStr,
    createdAt: testedAt,
  });

  let windowSize = HEALTH_TEST_WINDOW_SIZE;
  try {
    const { getSystemSettings } = await import("@/repository/system-config");
    const settings = await getSystemSettings();
    if (Number.isFinite(settings.healthTestWindowSize) && settings.healthTestWindowSize > 0) {
      windowSize = Math.min(50, Math.max(1, Math.trunc(settings.healthTestWindowSize)));
    }
  } catch {
    // keep default
  }
  // Fetch enough rows for the aggregate legacy window and each configured model's
  // independent rolling window. Scheduled multi-model probes interleave logs;
  // keep one extra window for legacy/manual rows that may be mixed in.
  const configuredModelCount = new Set(
    (input.healthTestModels ?? [])
      .filter((model): model is string => typeof model === "string")
      .map((model) => model.trim())
      .filter(Boolean)
  ).size;
  const historyWindowMultiplier = Math.max(2, configuredModelCount + 1);
  const historyWindowLimit = windowSize * historyWindowMultiplier;
  const recent = await findProviderHealthTestLogs(input.providerId, historyWindowLimit);
  const stats = computeHealthTestStats(
    recent.slice(0, windowSize).map(
      (log): HealthTestLogLike => ({
        ok: log.ok,
        firstByteMs: log.firstByteMs,
        latencyMs: log.latencyMs,
        status: log.status,
        model: log.model,
        source: log.source,
        errorType: log.errorType,
        errorMessage: log.errorMessage,
        httpStatusCode: log.httpStatusCode,
        inputTokens: log.inputTokens,
        outputTokens: log.outputTokens,
        cacheCreationInputTokens: log.cacheCreationInputTokens,
        cacheReadInputTokens: log.cacheReadInputTokens,
        costUsd: log.costUsd,
        createdAt: log.createdAt,
      })
    ),
    windowSize
  );

  const modelStats = computeHealthTestModelStats(recent, windowSize);

  // Rolling day counters for health-test spend (local day boundary).
  const today = localDayKey(testedAt);
  const sampleCost = toNumberOrNull(costUsdStr) ?? 0;
  const [current] = await db
    .select({
      healthTestTodayCostUsd: providers.healthTestTodayCostUsd,
      healthTestTodayCalls: providers.healthTestTodayCalls,
      healthTestTodayDate: providers.healthTestTodayDate,
      scheduledHealthTestEnabled: providers.scheduledHealthTestEnabled,
      healthTestBudgetSuspendedDay: providers.healthTestBudgetSuspendedDay,
    })
    .from(providers)
    .where(eq(providers.id, input.providerId))
    .limit(1);

  const sameDay = current?.healthTestTodayDate === today;
  const prevCost = sameDay ? (toNumberOrNull(current?.healthTestTodayCostUsd) ?? 0) : 0;
  const prevCalls = sameDay ? (current?.healthTestTodayCalls ?? 0) : 0;
  const nextCost = prevCost + sampleCost;
  const nextCalls = prevCalls + 1;

  // Per-provider counters only — global budget is checked after write.
  await db
    .update(providers)
    .set({
      lastHealthTestAt: testedAt,
      lastHealthTestOk: input.ok,
      lastHealthTestStatus: input.status ?? null,
      lastHealthTestFirstByteMs: input.firstByteMs ?? null,
      lastHealthTestLatencyMs: input.latencyMs ?? null,
      lastHealthTestModel: recordedModel,
      lastHealthTestErrorType: input.ok ? null : (input.errorType ?? null),
      lastHealthTestErrorMessage: input.ok ? null : (input.errorMessage ?? null),
      healthTestOnlineRate: stats.onlineRate == null ? null : stats.onlineRate.toFixed(4),
      healthTestAvgFirstByteMs: stats.avgFirstByteMs,
      healthTestRecentResults: stats.recentResults,
      healthTestModelStats: modelStats,
      healthTestTodayCostUsd: nextCost.toFixed(15),
      healthTestTodayCalls: nextCalls,
      healthTestTodayDate: today,
      updatedAt: testedAt,
    })
    .where(eq(providers.id, input.providerId));

  // Global daily budget: if sum of today's health-test spend >= cap, disable ALL
  // scheduled tests until next local day (midnight re-enable).
  let globalSuspended = false;
  if (input.source === "scheduled" && sampleCost > 0) {
    try {
      const status = await getHealthTestGlobalBudgetStatus();
      if (
        !status.isSuspendedToday &&
        isHealthTestOverDailyBudget(status.todayCost, status.budget)
      ) {
        await suspendAllScheduledHealthTestsForGlobalBudget(today);
        globalSuspended = true;
      }
    } catch (error) {
      logger.warn("[ProviderHealthTest] global budget check failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Manual tests refresh the dispatch cache immediately. Scheduled runs also
  // invalidate per-provider when each probe finishes (see run-test.ts).
  if (input.source === "manual" || globalSuspended) {
    try {
      const { publishProviderCacheInvalidation } = await import("@/lib/cache/provider-cache");
      await publishProviderCacheInvalidation();
    } catch (error) {
      logger.debug("[ProviderHealthTest] cache invalidate skipped", {
        providerId: input.providerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Best-effort prune: keep a little more than the window to avoid thrash
  try {
    await db.execute(sql`
      DELETE FROM provider_health_test_logs
      WHERE id IN (
        SELECT id FROM provider_health_test_logs
        WHERE provider_id = ${input.providerId}
        ORDER BY created_at DESC NULLS LAST, id DESC
        OFFSET ${historyWindowLimit + 40}
      )
    `);
  } catch (error) {
    logger.debug("[ProviderHealthTest] prune skipped", {
      providerId: input.providerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return stats;
}

/**
 * Wipe probe history + denormalized SLO snapshots for a provider.
 * Called when scheduled health tests are turned off so stale green bars
 * cannot re-qualify the provider without a fresh window after re-enable.
 * Does NOT reset today's cost counters (budget accounting is separate).
 */
export async function clearProviderHealthTestHistory(providerId: number): Promise<void> {
  await db.delete(providerHealthTestLogs).where(eq(providerHealthTestLogs.providerId, providerId));

  await db
    .update(providers)
    .set({
      lastHealthTestAt: null,
      lastHealthTestOk: null,
      lastHealthTestStatus: null,
      lastHealthTestFirstByteMs: null,
      lastHealthTestLatencyMs: null,
      lastHealthTestModel: null,
      lastHealthTestErrorType: null,
      lastHealthTestErrorMessage: null,
      healthTestOnlineRate: null,
      healthTestAvgFirstByteMs: null,
      healthTestRecentResults: null,
      healthTestModelStats: null,
      updatedAt: new Date(),
    })
    .where(and(eq(providers.id, providerId), isNull(providers.deletedAt)));
}

export async function updateProviderScheduledHealthTestEnabled(
  providerId: number,
  enabled: boolean
): Promise<boolean> {
  // Manual toggle clears budget-suspend + SLO auto-disable so the admin choice sticks.
  const [current] = await db
    .select({ scheduledHealthTestEnabled: providers.scheduledHealthTestEnabled })
    .from(providers)
    .where(and(eq(providers.id, providerId), isNull(providers.deletedAt)))
    .limit(1);
  if (!current) return false;

  const wasEnabled = current.scheduledHealthTestEnabled ?? true;

  const result = await db
    .update(providers)
    .set({
      scheduledHealthTestEnabled: enabled,
      healthTestBudgetSuspendedDay: null,
      healthTestSloAutoDisabled: false,
      updatedAt: new Date(),
    })
    .where(and(eq(providers.id, providerId), isNull(providers.deletedAt)))
    .returning({ id: providers.id });

  if (result.length === 0) return false;

  // Turning off → drop stale window so re-open must re-accumulate probes.
  if (wasEnabled && !enabled) {
    try {
      await clearProviderHealthTestHistory(providerId);
    } catch (error) {
      logger.warn("[ProviderHealthTest] clear history on manual disable failed", {
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return true;
}

/**
 * Re-open providers that were auto-disabled by SLO rebalance (not budget).
 * Used when schedule mode switches to always_on.
 */
export async function reopenSloAutoDisabledScheduledHealthTests(): Promise<{
  reopened: number;
  providerIds: number[];
}> {
  const reopened = await db
    .update(providers)
    .set({
      scheduledHealthTestEnabled: true,
      healthTestSloAutoDisabled: false,
      updatedAt: new Date(),
    })
    .where(
      and(
        isNull(providers.deletedAt),
        eq(providers.isEnabled, true),
        eq(providers.healthTestSloAutoDisabled, true),
        // Budget-tagged offs stay off until budget day rollover / budget raise.
        sql`${providers.healthTestBudgetSuspendedDay} IS NULL`
      )
    )
    .returning({ id: providers.id });

  if (reopened.length > 0) {
    logger.info("[ProviderHealthTest] always_on reopened SLO auto-disabled", {
      count: reopened.length,
      providerIds: reopened.map((r) => r.id),
    });
    try {
      const { publishProviderCacheInvalidation } = await import("@/lib/cache/provider-cache");
      await publishProviderCacheInvalidation();
    } catch {
      // best-effort
    }
  }

  return { reopened: reopened.length, providerIds: reopened.map((r) => r.id) };
}

/**
 * Per-type-pool rebalance: keep top-2 SLO-qualified (priority then first-byte),
 * auto-disable the rest; if fewer than 2 qualify, re-open auto-disabled for exploration.
 */
export async function rebalanceScheduledHealthTestsBySlo(): Promise<{
  changed: number;
  pools: Array<{ pool: string; mode: string; keepIds: number[]; changed: number }>;
}> {
  const { planHealthTestSloRebalanceAll, filterRebalanceChanges } = await import(
    "@/lib/provider-health-test/slo-rebalance"
  );

  const rows = await db
    .select({
      id: providers.id,
      name: providers.name,
      providerType: providers.providerType,
      isEnabled: providers.isEnabled,
      priority: providers.priority,
      scheduledHealthTestEnabled: providers.scheduledHealthTestEnabled,
      healthTestBudgetSuspendedDay: providers.healthTestBudgetSuspendedDay,
      healthTestSloAutoDisabled: providers.healthTestSloAutoDisabled,
      healthTestOnlineRate: providers.healthTestOnlineRate,
      healthTestAvgFirstByteMs: providers.healthTestAvgFirstByteMs,
      healthTestRecentResults: providers.healthTestRecentResults,
    })
    .from(providers)
    .where(isNull(providers.deletedAt));

  const list: HealthRebalanceProvider[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    providerType: row.providerType,
    isEnabled: row.isEnabled,
    priority: row.priority ?? 0,
    scheduledHealthTestEnabled: row.scheduledHealthTestEnabled ?? true,
    healthTestBudgetSuspendedDay: row.healthTestBudgetSuspendedDay ?? null,
    healthTestSloAutoDisabled: row.healthTestSloAutoDisabled ?? false,
    healthTestOnlineRate:
      row.healthTestOnlineRate == null ? null : Number.parseFloat(String(row.healthTestOnlineRate)),
    healthTestAvgFirstByteMs: row.healthTestAvgFirstByteMs ?? null,
    healthTestRecentResults: row.healthTestRecentResults ?? null,
  }));

  const settings = await getCachedSystemSettings();
  const thresholds: HealthTestSloThresholds = {
    minOnlineRate: settings.healthTestMinOnlineRatePercent / 100,
    maxAvgLatencyMs: settings.healthTestMaxAvgLatencySeconds * 1000,
    minSampleCount: 1,
  };
  const plans = planHealthTestSloRebalanceAll(list, undefined, thresholds);
  const poolSummaries: Array<{ pool: string; mode: string; keepIds: number[]; changed: number }> =
    [];
  let changed = 0;

  for (const plan of plans) {
    const changes = filterRebalanceChanges(list, plan.decisions);
    for (const d of changes) {
      const prev = list.find((p) => p.id === d.providerId);
      const turningOff =
        (prev?.scheduledHealthTestEnabled ?? true) && !d.scheduledHealthTestEnabled;

      await db
        .update(providers)
        .set({
          scheduledHealthTestEnabled: d.scheduledHealthTestEnabled,
          healthTestSloAutoDisabled: d.healthTestSloAutoDisabled,
          // Clearing auto-off is not a budget resume; leave budget day alone.
          updatedAt: new Date(),
        })
        .where(and(eq(providers.id, d.providerId), isNull(providers.deletedAt)));

      // Auto-disable must wipe SLO window so stale metrics cannot keep ranking.
      if (turningOff) {
        try {
          await clearProviderHealthTestHistory(d.providerId);
        } catch (error) {
          logger.warn("[ProviderHealthTest] clear history on SLO disable failed", {
            providerId: d.providerId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      changed += 1;
    }
    poolSummaries.push({
      pool: plan.pool,
      mode: plan.mode,
      keepIds: plan.keepIds,
      changed: changes.length,
    });
  }

  if (changed > 0) {
    logger.info("[ProviderHealthTest] SLO rebalance applied", {
      changed,
      pools: poolSummaries,
    });
    try {
      const { publishProviderCacheInvalidation } = await import("@/lib/cache/provider-cache");
      await publishProviderCacheInvalidation();
    } catch {
      // best-effort
    }
  }

  return { changed, pools: poolSummaries };
}
