/**
 * Exported function: startBoostExpiryCleanup
 *
 * Starts a recurring 60-second interval that hard-deletes expired quota_boost_grants
 * rows (valid_to <= now()). Uses a globalThis idempotency guard (__CCH_BOOST_EXPIRY_CLEANUP_STARTED__)
 * to prevent duplicate timers on hot-reload in development.
 *
 * Caller (instrumentation.ts) is responsible for invoking this function at startup.
 */

import "server-only";

import { logger } from "@/lib/logger";
import { deleteExpiredQuotaBoostGrants } from "@/repository/quota-boost";

const state = globalThis as unknown as {
  __CCH_BOOST_EXPIRY_CLEANUP_STARTED__?: boolean;
};

const INTERVAL_MS = 60_000;

export function startBoostExpiryCleanup(): void {
  if (state.__CCH_BOOST_EXPIRY_CLEANUP_STARTED__) {
    return;
  }

  state.__CCH_BOOST_EXPIRY_CLEANUP_STARTED__ = true;

  setInterval(() => {
    deleteExpiredQuotaBoostGrants()
      .then((count) => {
        if (count > 0) {
          logger.info("[BoostCleanup] Deleted expired quota boost grants", { count });
        }
      })
      .catch((error) => {
        logger.warn("[BoostCleanup] Failed to delete expired quota boost grants", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, INTERVAL_MS);

  logger.info("[BoostCleanup] Quota boost expiry cleanup scheduler started", {
    intervalSeconds: INTERVAL_MS / 1000,
  });
}
