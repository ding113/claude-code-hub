import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/drizzle/db";
import { vendorBalanceChecks, vendorKeys, vendors } from "@/drizzle/schema-v2";
import { logger } from "@/lib/logger";
import type { ProviderType } from "@/types/provider";

import type { BalanceCheckerStore } from "./balance-checker";
import { runBalanceCheckCycle } from "./balance-checker";

const DEFAULT_BALANCE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_BALANCE_CHECK_TIMEOUT_MS = 10000;

let intervalId: NodeJS.Timeout | null = null;
let isRunning = false;

function createDrizzleStore(): BalanceCheckerStore {
  return {
    async listBalanceCheckTargets() {
      const rows = await db
        .select({
          vendorKeyId: vendorKeys.id,
          vendorId: vendorKeys.vendorId,
          endpointId: vendorKeys.endpointId,
          providerType: vendorKeys.providerType,
          baseUrl: vendorKeys.url,
          apiKey: vendorKeys.key,
          balanceCheckEndpoint: vendors.balanceCheckEndpoint,
          balanceCheckJsonpath: vendors.balanceCheckJsonpath,
          lowThresholdUsd: vendors.balanceCheckLowThresholdUsd,
        })
        .from(vendorKeys)
        .innerJoin(vendors, eq(vendorKeys.vendorId, vendors.id))
        .where(
          and(
            eq(vendorKeys.isEnabled, true),
            isNull(vendorKeys.deletedAt),
            eq(vendors.isEnabled, true),
            isNull(vendors.deletedAt),
            eq(vendors.balanceCheckEnabled, true),
            isNotNull(vendors.balanceCheckEndpoint),
            isNotNull(vendors.balanceCheckJsonpath)
          )
        );

      return rows.flatMap((row) => {
        if (!row.balanceCheckEndpoint || !row.balanceCheckJsonpath) {
          return [];
        }

        return [
          {
            vendorKeyId: row.vendorKeyId,
            vendorId: row.vendorId,
            endpointId: row.endpointId,
            providerType: row.providerType as ProviderType,
            baseUrl: row.baseUrl,
            apiKey: row.apiKey,
            balanceCheckEndpoint: row.balanceCheckEndpoint,
            balanceCheckJsonpath: row.balanceCheckJsonpath,
            lowThresholdUsd: row.lowThresholdUsd != null ? parseFloat(row.lowThresholdUsd) : null,
          },
        ];
      });
    },

    async recordBalanceCheck(data) {
      await db.insert(vendorBalanceChecks).values({
        vendorKeyId: data.vendorKeyId,
        vendorId: data.vendorId,
        endpointId: data.endpointId,
        checkedAt: data.checkedAt,
        durationMs: data.durationMs,
        statusCode: data.statusCode,
        isSuccess: data.isSuccess,
        balanceUsd: data.balanceUsd != null ? data.balanceUsd.toString() : null,
        rawResponse: data.rawResponse ?? null,
        errorMessage: data.errorMessage ?? null,
      });
    },

    async updateVendorKeyBalance(vendorKeyId, balanceUsd) {
      await db
        .update(vendorKeys)
        .set({
          balanceUsd: balanceUsd.toString(),
          balanceUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(vendorKeys.id, vendorKeyId), isNull(vendorKeys.deletedAt)));
    },

    async disableVendorKey(vendorKeyId) {
      await db
        .update(vendorKeys)
        .set({
          isEnabled: false,
          updatedAt: new Date(),
        })
        .where(and(eq(vendorKeys.id, vendorKeyId), isNull(vendorKeys.deletedAt)));
    },
  };
}

async function runCycle(timeoutMs: number): Promise<void> {
  if (isRunning) {
    logger.debug("[VendorBalance] Skipping cycle, previous cycle still running");
    return;
  }

  isRunning = true;
  try {
    const results = await runBalanceCheckCycle({
      store: createDrizzleStore(),
      timeoutMs,
    });

    const ok = results.filter((r) => r.ok).length;
    const failed = results.length - ok;
    const disabled = results.filter((r) => r.disabled).length;

    logger.info("[VendorBalance] Balance check cycle completed", {
      total: results.length,
      ok,
      failed,
      disabled,
    });
  } catch (error) {
    logger.error("[VendorBalance] Balance check cycle failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    isRunning = false;
  }
}

export function startBalanceScheduler(options?: { intervalMs?: number; timeoutMs?: number }): void {
  if (intervalId) {
    logger.warn("[VendorBalance] Scheduler already running");
    return;
  }

  const intervalMs =
    options?.intervalMs != null && Number.isFinite(options.intervalMs) && options.intervalMs > 0
      ? options.intervalMs
      : DEFAULT_BALANCE_CHECK_INTERVAL_MS;
  const timeoutMs =
    options?.timeoutMs != null && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_BALANCE_CHECK_TIMEOUT_MS;

  logger.info("[VendorBalance] Starting balance scheduler", {
    intervalMs,
    timeoutMs,
  });

  void runCycle(timeoutMs);

  intervalId = setInterval(() => {
    void runCycle(timeoutMs);
  }, intervalMs);

  process.on("SIGTERM", stopBalanceScheduler);
  process.on("SIGINT", stopBalanceScheduler);
}

export function stopBalanceScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info("[VendorBalance] Balance scheduler stopped");
  }
}

export function getBalanceSchedulerStatus(): { running: boolean } {
  return { running: intervalId !== null };
}
